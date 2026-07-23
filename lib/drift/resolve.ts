import { repoFullNameFor } from "@/lib/ci";
import { getDriftProvider } from "./index";
import type { DriftProvider, DriftStatus } from "./types";

interface DriftTarget {
  id: string;
  owner: string;
  repoUrl?: string;
}

/**
 * Resolve drift status for a set of miniapps into an `id → DriftStatus` map.
 * Fetches the template HEAD once, then each miniapp's baseSha, and compares.
 * Fail-soft: a per-item error → `unknown`; a HEAD fetch failure → all `unknown`.
 * The provider is injectable for tests; defaults to the cached GitHub provider.
 */
export async function resolveDriftStatuses(
  items: readonly DriftTarget[],
  provider: DriftProvider = getDriftProvider(),
): Promise<Record<string, DriftStatus>> {
  let head: string;
  try {
    head = await provider.getTemplateHead();
  } catch {
    return Object.fromEntries(items.map((i) => [i.id, "unknown" as DriftStatus]));
  }
  const pairs = await Promise.all(
    items.map(async (i) => {
      try {
        const base = await provider.getBaseSha(repoFullNameFor(i));
        const status: DriftStatus =
          base === null ? "untracked" : base === head ? "up_to_date" : "drift";
        return [i.id, status] as const;
      } catch {
        return [i.id, "unknown" as DriftStatus] as const;
      }
    }),
  );
  return Object.fromEntries(pairs);
}
