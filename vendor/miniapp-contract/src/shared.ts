/**
 * Version-skew detection for shared singletons.
 * Pure, no runtime deps. Reused by the host loader (Bolt 4) AND by Backstage
 * to validate compatibility at publish time.
 *
 * NOTE: this is a *minimal* range satisfier (exact | caret ^ | tilde ~ | any *).
 * It is intentionally small for the MVP; swap for a full semver lib if ranges
 * grow more complex.
 */
import type { SemVer, SharedDepSpec } from "./types.js";

export type SkewStatus = "ok" | "missing" | "incompatible";

export interface SkewEntry {
  readonly name: string;
  readonly status: SkewStatus;
  readonly requiredRange: string;
  readonly providedVersion?: SemVer;
}

export interface SkewResult {
  readonly compatible: boolean;
  readonly entries: readonly SkewEntry[];
}

type Triple = readonly [number, number, number];

function parseTriple(version: string): Triple | null {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (m === null) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Does a concrete version satisfy a (minimal) range? */
export function satisfiesRange(version: string, range: string): boolean {
  const trimmed = range.trim();
  if (trimmed === "" || trimmed === "*") return true;

  const provided = parseTriple(version);
  if (provided === null) return false;

  const operator = trimmed[0];
  const bare = operator === "^" || operator === "~" ? trimmed.slice(1) : trimmed;
  const required = parseTriple(bare);
  if (required === null) return false;

  const [pMajor, pMinor, pPatch] = provided;
  const [rMajor, rMinor, rPatch] = required;

  // provided must be >= required within the allowed window
  const gte =
    pMajor > rMajor ||
    (pMajor === rMajor && pMinor > rMinor) ||
    (pMajor === rMajor && pMinor === rMinor && pPatch >= rPatch);
  if (!gte) return false;

  if (operator === "^") return pMajor === rMajor;
  if (operator === "~") return pMajor === rMajor && pMinor === rMinor;
  // exact
  return pMajor === rMajor && pMinor === rMinor && pPatch === rPatch;
}

/**
 * Compare what the host provides (name → concrete version) against what a
 * miniapp requires. Compatible only when every required dep is present and in range.
 */
export function satisfiesShared(
  hostProvided: Readonly<Record<string, SemVer>>,
  miniappShared: readonly SharedDepSpec[],
): SkewResult {
  const entries: SkewEntry[] = miniappShared.map((dep) => {
    const providedVersion = hostProvided[dep.name];
    if (providedVersion === undefined) {
      return { name: dep.name, status: "missing", requiredRange: dep.requiredRange };
    }
    const status: SkewStatus = satisfiesRange(providedVersion, dep.requiredRange)
      ? "ok"
      : "incompatible";
    return { name: dep.name, status, requiredRange: dep.requiredRange, providedVersion };
  });

  return { compatible: entries.every((e) => e.status === "ok"), entries };
}
