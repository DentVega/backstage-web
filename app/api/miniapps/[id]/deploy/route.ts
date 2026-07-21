import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getStore } from "@/lib/registry/store";
import { getMiniappDetail } from "@/lib/registry/registry";
import { MiniappNotFoundError } from "@/lib/registry/types";
import { githubProvider } from "@/lib/git/github";
import { githubToken, scaffoldAllowedLogins } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/** Parse `owner/repo` from a GitHub repo URL (https or ssh, optional `.git`). */
export function parseRepo(
  url: string | undefined,
): { owner: string; repo: string } | null {
  if (url === undefined) return null;
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

/**
 * POST /api/miniapps/:id/deploy — trigger the miniapp's CI (`ci.yml`,
 * `workflow_dispatch`) to build the chunk and publish a new version. Auth: an
 * allowlisted session (same as scaffold). The CI itself publishes back to
 * Backstage using the repo's BACKSTAGE_URL + PUBLISH_TOKEN secrets.
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

    const reg = await getStore().load();
    let detail;
    try {
      detail = getMiniappDetail(reg, id);
    } catch (err) {
      if (err instanceof MiniappNotFoundError) {
        return NextResponse.json({ error: `miniapp "${id}" not found` }, { status: 404 });
      }
      throw err;
    }

    const repo = parseRepo(detail.repoUrl);
    if (repo === null) {
      return NextResponse.json(
        { error: "miniapp has no valid GitHub repo URL" },
        { status: 400 },
      );
    }

    await githubProvider(githubToken()).dispatchWorkflow({
      owner: repo.owner,
      repo: repo.repo,
      workflow: "ci.yml",
      ref: "main",
    });

    return NextResponse.json(
      { dispatched: true, actionsUrl: `${detail.repoUrl}/actions` },
      { status: 202 },
    );
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
