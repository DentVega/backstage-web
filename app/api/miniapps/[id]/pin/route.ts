import { NextResponse } from "next/server";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { getStore } from "@/lib/registry/store";
import { setMiniappPin, getMiniappDetail } from "@/lib/registry/registry";
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
    // Lazy (evita el crash de next-auth/Next-16 al importarse en el grafo de tests).
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { version?: unknown } | null;
    const version = body?.version ?? null;
    if (version !== null && typeof version !== "string") {
      return NextResponse.json({ error: "version must be a string or null" }, { status: 400 });
    }
    const reg = await getStore().load();
    const next = setMiniappPin(reg, id, version); // InvalidManifestError→400, MiniappNotFoundError→404
    await getStore().save(next);
    return NextResponse.json(getMiniappDetail(next, id), { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
