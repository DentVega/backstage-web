import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { githubProvider } from "@/lib/git/github";
import { parseRepo } from "@/lib/git/miniapp-dispatch";
import { githubToken, scaffoldAllowedLogins } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * POST /api/admin/sync-all — dispara `template-sync.yml` (workflow_dispatch) en TODOS
 * los repos del registry (fan-out de Capa 2). Auth: sesión allowlisted (canScaffold).
 * Best-effort por repo → { dispatched, failed }. El repo real sale del `repoUrl`.
 */
export async function POST(): Promise<NextResponse> {
  try {
    // Lazy (evita el crash de next-auth/Next-16 al importarse en el grafo de tests).
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }

    const reg = await getStore().load();
    const provider = githubProvider(githubToken());
    const dispatched: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const rec of Object.values(reg)) {
      const repo = parseRepo(rec.repoUrl);
      if (repo === null) {
        failed.push({ id: rec.id, error: "sin repoUrl válido" });
        continue;
      }
      try {
        await provider.dispatchWorkflow({
          owner: repo.owner,
          repo: repo.repo,
          workflow: "template-sync.yml",
          ref: "main",
        });
        dispatched.push(rec.id);
      } catch (err) {
        failed.push({ id: rec.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return NextResponse.json({ dispatched, failed }, { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
