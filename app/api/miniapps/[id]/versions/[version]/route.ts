import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { removeVersion, getMiniappDetail } from "@/lib/registry/registry";
import { getStorage } from "@/lib/storage";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
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
    const { auth } = await import("@/auth"); // lazy (patrón del resto de las routes admin)
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const { id, version } = await params;
    const reg = await getStore().load();
    const storage = await getStorage(reg[id]?.storageProvider ?? null);
    // Valida (servida / existe) ANTES de tocar el storage.
    const next = removeVersion(reg, id, version);
    try {
      await storage.deletePrefix(`${id}/${version}`);
    } catch {
      /* best-effort: si el chunk no se borra, igual limpiamos el registry. */
    }
    await getStore().save(next);
    return NextResponse.json(getMiniappDetail(next, id), { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
