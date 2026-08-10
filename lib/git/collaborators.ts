import { githubProvider } from "@/lib/git/github";
import { githubToken } from "@/lib/config";
import { parseRepo } from "@/lib/git/miniapp-dispatch";

/**
 * Logins (lowercased) con acceso al repo de una miniapp = sus collaborators de GitHub.
 * Fuente de verdad para "quién puede ser maintainer": solo gente con acceso al proyecto.
 * Devuelve [] si no hay repoUrl o la API no responde (best-effort).
 */
export async function repoCollaboratorLogins(repoUrl: string | undefined): Promise<string[]> {
  const repo = parseRepo(repoUrl);
  if (repo === null) return [];
  const cols = await githubProvider(githubToken()).listCollaborators(repo);
  return cols.map((c) => c.login.toLowerCase());
}
