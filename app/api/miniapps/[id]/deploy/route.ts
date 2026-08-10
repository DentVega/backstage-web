import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { dispatchMiniappWorkflow } from "@/lib/git/miniapp-dispatch";
import { getStore } from "@/lib/registry/store";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canManageMiniapp, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

// Re-exported for existing tests that import parseRepo from here.
export { parseRepo } from "@/lib/git/miniapp-dispatch";

/**
 * POST /api/miniapps/:id/deploy — trigger the miniapp's CI (`ci.yml`,
 * `workflow_dispatch`) to build the chunk and publish a new version. Auth: an
 * allowlisted session. The CI publishes back using the repo's BACKSTAGE_URL +
 * PUBLISH_TOKEN secrets.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const reg = await getStore().load();
    const session = await auth();
    if (!canManageMiniapp(session?.githubLogin, reg[id]?.maintainers, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const { actionsUrl } = await dispatchMiniappWorkflow(id, "ci.yml");
    return NextResponse.json({ dispatched: true, actionsUrl }, { status: 202 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
