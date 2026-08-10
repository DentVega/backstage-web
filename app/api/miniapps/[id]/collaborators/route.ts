import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canManageMiniapp, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { repoCollaboratorLogins } from "@/lib/git/collaborators";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * GET /api/miniapps/:id/collaborators — logins con acceso al repo de la miniapp.
 * Alimenta el autocompletado de maintainers (solo se sugiere gente con acceso al proyecto).
 * Auth: platform-admin O un maintainer actual (mismos que gestionan la miniapp).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const reg = await getStore().load();
    const record = reg[id];
    if (record === undefined) {
      return NextResponse.json({ error: "miniapp no encontrada" }, { status: 404 });
    }
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canManageMiniapp(session?.githubLogin, record.maintainers, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const collaborators = await repoCollaboratorLogins(record.repoUrl);
    return NextResponse.json({ collaborators }, { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
