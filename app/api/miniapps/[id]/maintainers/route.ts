import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { setMaintainers, getMiniappDetail } from "@/lib/registry/registry";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canManageMiniapp, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * PUT /api/miniapps/:id/maintainers — setea los maintainers (logins de GitHub) de una
 * miniapp. Auth: platform-admin O un maintainer actual (auto-gobierno del equipo).
 * Body `{ maintainers: string[] }`. Devuelve el MiniappDetail actualizado.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const reg = await getStore().load();
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canManageMiniapp(session?.githubLogin, reg[id]?.maintainers, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const body = (await req.json().catch(() => null)) as { maintainers?: unknown } | null;
    const list = Array.isArray(body?.maintainers)
      ? body.maintainers.filter((x): x is string => typeof x === "string")
      : [];
    const next = setMaintainers(reg, id, list); // MiniappNotFoundError → 404
    await getStore().save(next);
    return NextResponse.json(getMiniappDetail(next, id), { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
