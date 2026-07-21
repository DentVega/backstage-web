import { getStore } from "@/lib/registry/store";
import { getMiniappDetail } from "@/lib/registry/registry";
import { InvalidRepoUrlError } from "@/lib/registry/types";
import { githubProvider } from "@/lib/git/github";
import { githubToken } from "@/lib/config";

/** Parse `owner/repo` from a GitHub repo URL (https or ssh, optional `.git`). */
export function parseRepo(
  url: string | undefined,
): { owner: string; repo: string } | null {
  if (url === undefined) return null;
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

/**
 * Resolve a miniapp's repo and dispatch one of its workflows on `main`.
 * Shared by the deploy (ci.yml) and sync-template (template-sync.yml) routes.
 * Throws MiniappNotFoundError (404) or InvalidRepoUrlError (400).
 */
export async function dispatchMiniappWorkflow(
  id: string,
  workflow: string,
): Promise<{ actionsUrl: string }> {
  const reg = await getStore().load();
  const detail = getMiniappDetail(reg, id); // throws MiniappNotFoundError
  const repo = parseRepo(detail.repoUrl);
  if (repo === null) throw new InvalidRepoUrlError(id);

  await githubProvider(githubToken()).dispatchWorkflow({
    owner: repo.owner,
    repo: repo.repo,
    workflow,
    ref: "main",
  });
  return { actionsUrl: `${detail.repoUrl}/actions` };
}
