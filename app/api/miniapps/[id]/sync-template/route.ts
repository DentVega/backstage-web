import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { dispatchMiniappWorkflow } from "@/lib/git/miniapp-dispatch";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * POST /api/miniapps/:id/sync-template — trigger the miniapp's `template-sync.yml`
 * (`workflow_dispatch`) to 3-way merge the current template and open a PR. Auth: an
 * allowlisted session (same as deploy). No secrets — the workflow uses GITHUB_TOKEN.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const { id } = await params;
    const { actionsUrl } = await dispatchMiniappWorkflow(id, "template-sync.yml");
    return NextResponse.json({ dispatched: true, actionsUrl }, { status: 202 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
