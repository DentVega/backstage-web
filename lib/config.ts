/** Scaffolder config from env. Never hardcode tokens. */

/** Template repo the scaffolder generates from. Replace `org` with your GitHub org. */
export const TEMPLATE_REPO = process.env.MINIAPP_TEMPLATE_REPO ?? "org/miniapp-template";

/** GitHub token with `repo` scope (create repos). */
export function githubToken(): string {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("GITHUB_TOKEN is not set");
  return t;
}

/**
 * Actions secrets to seed on a newly-scaffolded miniapp so its CI can publish on
 * first push — `BACKSTAGE_URL` (this Backstage's prod URL) + `PUBLISH_TOKEN` (the
 * upload service token Backstage validates). Only includes values that are set;
 * a missing one is simply skipped (best-effort scaffolding).
 */
export function scaffoldSecrets(): Record<string, string> {
  const secrets: Record<string, string> = {};
  const url = process.env.BACKSTAGE_URL;
  if (url) secrets.BACKSTAGE_URL = url;
  const publishToken = process.env.PUBLISH_TOKEN;
  if (publishToken) secrets.PUBLISH_TOKEN = publishToken;
  return secrets;
}

/**
 * GitHub usernames allowed to scaffold, from `SCAFFOLD_ALLOWED_LOGINS` (CSV).
 * Empty when unset → fail-closed (nobody can create). Set it in production
 * (e.g. "DentVega") so a public demo can't spam repos into the account.
 */
export function scaffoldAllowedLogins(): string[] {
  return (process.env.SCAFFOLD_ALLOWED_LOGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
