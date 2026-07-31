/**
 * Abre pedidos de capability nativa (GitHub issues, con dedup) contra el repo del
 * host — uno por lib que la miniapp necesita y el host no provee. Best-effort.
 */
import type { GitProvider } from "@/lib/git/types";

export async function openCapabilityRequests(
  gitProvider: GitProvider,
  hostRepo: string,
  libraries: readonly string[],
  context: { miniappId: string; version: string },
): Promise<{ requested: string[]; failed: { library: string; error: string }[] }> {
  const [owner, repo] = hostRepo.split("/");
  const requested: string[] = [];
  const failed: { library: string; error: string }[] = [];
  for (const library of libraries) {
    try {
      await gitProvider.ensureIssue({
        owner,
        repo,
        title: `capability request: native module \`${library}\``,
        body:
          `La miniapp \`${context.miniappId}\` v${context.version} necesita el módulo nativo ` +
          `\`${library}\`, que el binario del host no provee.\n\n` +
          `Para habilitarlo: agregar la dependencia nativa al host, sacar una release nueva ` +
          `del binario, y regenerar el host contract (que ahora incluirá \`${library}\`).`,
        labels: ["capability-request"],
      });
      requested.push(library);
    } catch (err) {
      failed.push({ library, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { requested, failed };
}
