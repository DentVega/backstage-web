import { githubDriftProvider } from "./github";
import { withCache } from "./cache";
import type { DriftProvider } from "./types";

export type { DriftStatus, DriftProvider } from "./types";
export { DriftProviderError } from "./types";

let cached: DriftProvider | null = null;

/** The GitHub drift provider wrapped in a ~60s cache (singleton). */
export function getDriftProvider(): DriftProvider {
  if (cached) return cached;
  cached = withCache(githubDriftProvider());
  return cached;
}
