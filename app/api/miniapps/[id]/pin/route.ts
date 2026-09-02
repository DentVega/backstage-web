import { NextResponse } from "next/server";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canManageMiniapp, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { getStore } from "@/lib/registry/store";
import { setMiniappPin, getMiniappDetail, asRecordMutation } from "@/lib/registry/registry";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * PUT /api/miniapps/:id/pin — fija (o despina con `version: null`) la versión que el
 * host sirve por defecto para esta miniapp (rollback/freeze). Admin (canScaffold).
 * 400 si la versión no existe / no es string; 404 si la miniapp no existe.
 * Devuelve el MiniappDetail actualizado.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const store = getStore();
    const rec = await store.getApp(id);
    // Lazy (evita el crash de next-auth/Next-16 al importarse en el grafo de tests).
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canManageMiniapp(session?.githubLogin, rec?.maintainers, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const body = (await req.json().catch(() => null)) as { version?: unknown } | null;
    const version = body?.version ?? null;
    if (version !== null && typeof version !== "string") {
      return NextResponse.json({ error: "version must be a string or null" }, { status: 400 });
    }
    // CAS por-miniapp. setMiniappPin valida (InvalidManifestError→400, MiniappNotFoundError→404).
    const next = await store.mutateApp(id, asRecordMutation(id, (reg) => setMiniappPin(reg, id, version)));
    return NextResponse.json(getMiniappDetail(next ? { [id]: next } : {}, id), { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
