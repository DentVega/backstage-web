import { githubCiProvider } from "./github";
import { mockCiProvider } from "./mock";
import { withCache } from "./cache";
import type { CiStatusProvider } from "./types";

export type { CiStatus, CiStatusProvider } from "./types";
export { repoFullNameFor } from "./types";

let cached: CiStatusProvider | null = null;

/**
 * Select the CI provider (ADR-020). With CI reads enabled we use the GitHub
 * provider wrapped in a ~60s cache. Without it (no session/token available in
 * this deployment), we degrade safely to a mock that reports `unknown` so the
 * UI still renders. The session token is passed per call, not captured here.
 */
export function getCiProvider(): CiStatusProvider {
  if (cached) return cached;
  cached =
    process.env.CI_STATUS_ENABLED === "false"
      ? mockCiProvider()
      : withCache(githubCiProvider());
  return cached;
}
