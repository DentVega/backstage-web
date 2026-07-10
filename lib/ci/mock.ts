import type { CiStatus, CiStatusProvider } from "./types";

/**
 * No-network provider for tests/dev. Returns a fixed status per repo from `map`;
 * repos not in the map resolve to `fallback` (default "unknown").
 */
export function mockCiProvider(
  map: Record<string, CiStatus> = {},
  fallback: CiStatus = "unknown",
): CiStatusProvider {
  return {
    async getStatus(repoFullName: string): Promise<{ status: CiStatus }> {
      return { status: map[repoFullName] ?? fallback };
    },
  };
}
