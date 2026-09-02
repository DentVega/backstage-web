import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { removeVersion, getMiniappDetail, asRecordMutation } from "@/lib/registry/registry";
import { getStorage } from "@/lib/storage";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canManageMiniapp, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * DELETE /api/miniapps/:id/versions/:version — borra una versión puntual (chunk +
 * entrada del registry). Admin (canScaffold). Rechaza la versión servida (400).
 * El borrado del chunk es best-effort; la versión se saca del registry igual.
 */
export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string; version: string }> },
): Promise<NextResponse> {
  try {
    const { id, version } = await params;
    const store = getStore();
    const record = await store.getApp(id);
    const { auth } = await import("@/auth"); // lazy (patrón del resto de las routes admin)
    const session = await auth();
    if (!canManageMiniapp(session?.githubLogin, record?.maintainers, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const storage = await getStorage(record?.storageProvider ?? null);
    // Valida (servida / existe) ANTES de tocar el storage (throw → 400/404).
    removeVersion(record ? { [id]: record } : {}, id, version);
    try {
      await storage.deletePrefix(`${id}/${version}`);
    } catch {
      /* best-effort: si el chunk no se borra, igual limpiamos el registry. */
    }
    const next = await store.mutateApp(id, asRecordMutation(id, (reg) => removeVersion(reg, id, version)));
    return NextResponse.json(getMiniappDetail(next ? { [id]: next } : {}, id), { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
