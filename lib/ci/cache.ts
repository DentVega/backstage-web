import type { CiStatus, CiStatusProvider } from "./types";

interface CacheOptions {
  /** Time-to-live per repo, ms. Default 60s. */
  ttlMs?: number;
  /** Clock, injected for deterministic tests. Default Date.now. */
  now?: () => number;
}

interface Entry {
  status: CiStatus;
  expiresAt: number;
}

/**
 * Decorate a provider with a short per-repo cache (ADR-020). Avoids hitting
 * GitHub on every catalog render. Only the public `status` is cached — never
 * the token. A miss/expiry delegates and re-caches. `unknown` is cached too
 * (it means "couldn't determine right now"), so a transient failure isn't
 * retried on every render within the TTL.
 */
export function withCache(
  provider: CiStatusProvider,
  { ttlMs = 60_000, now = Date.now }: CacheOptions = {},
): CiStatusProvider {
  const cache = new Map<string, Entry>();
  return {
    async getStatus(repoFullName: string, token: string): Promise<{ status: CiStatus }> {
      const t = now();
      const hit = cache.get(repoFullName);
      if (hit !== undefined && hit.expiresAt > t) {
        return { status: hit.status };
      }
      const { status } = await provider.getStatus(repoFullName, token);
      cache.set(repoFullName, { status, expiresAt: t + ttlMs });
      return { status };
    },
  };
}
