import type { DriftProvider } from "./types";

interface CacheOptions {
  /** TTL, ms. Default 60s. */
  ttlMs?: number;
  /** Clock, injected for tests. Default Date.now. */
  now?: () => number;
}

/**
 * Decorate a DriftProvider with a short cache: the template HEAD (single value)
 * and each repo's baseSha (per-repo), so repeated catalog renders don't re-hit
 * GitHub. Only successful values are cached; a thrown error is not cached (so a
 * transient failure is retried on the next render).
 */
export function withCache(
  provider: DriftProvider,
  { ttlMs = 60_000, now = Date.now }: CacheOptions = {},
): DriftProvider {
  let headEntry: { value: string; expiresAt: number } | undefined;
  const baseCache = new Map<string, { value: string | null; expiresAt: number }>();
  return {
    async getTemplateHead(): Promise<string> {
      const t = now();
      if (headEntry !== undefined && headEntry.expiresAt > t) return headEntry.value;
      const value = await provider.getTemplateHead();
      headEntry = { value, expiresAt: t + ttlMs };
      return value;
    },
    async getBaseSha(repoFullName: string): Promise<string | null> {
      const t = now();
      const hit = baseCache.get(repoFullName);
      if (hit !== undefined && hit.expiresAt > t) return hit.value;
      const value = await provider.getBaseSha(repoFullName);
      baseCache.set(repoFullName, { value, expiresAt: t + ttlMs });
      return value;
    },
  };
}
