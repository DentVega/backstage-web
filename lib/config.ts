/** Scaffolder config from env. Never hardcode tokens. */

/** Template repo the scaffolder generates from. Replace `org` with your GitHub org. */
export const TEMPLATE_REPO = process.env.MINIAPP_TEMPLATE_REPO ?? "org/miniapp-template";

/** GitHub token with `repo` scope (create repos). */
export function githubToken(): string {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("GITHUB_TOKEN is not set");
  return t;
}
