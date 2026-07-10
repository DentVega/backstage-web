import { getCiProvider } from "./index";
import { repoFullNameFor, type CiStatus } from "./types";

interface CiTarget {
  id: string;
  owner: string;
  repoUrl?: string;
}

/**
 * Resolve CI status for a set of miniapps into an `id → CiStatus` map. The token
 * (session token, read server-side by the caller) is passed in — this stays
 * decoupled from auth. Without a token every entry is `unknown`. Uses the cached
 * provider (ADR-020), so repeated renders don't re-hit GitHub.
 */
export async function resolveCiStatuses(
  items: readonly CiTarget[],
  token: string | undefined,
): Promise<Record<string, CiStatus>> {
  if (!token) {
    return Object.fromEntries(items.map((i) => [i.id, "unknown" as CiStatus]));
  }
  const provider = getCiProvider();
  const pairs = await Promise.all(
    items.map(
      async (i) =>
        [i.id, (await provider.getStatus(repoFullNameFor(i), token)).status] as const,
    ),
  );
  return Object.fromEntries(pairs);
}
