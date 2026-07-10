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
/** Does a concrete version satisfy a (minimal) range? */
export declare function satisfiesRange(version: string, range: string): boolean;
/**
 * Compare what the host provides (name → concrete version) against what a
 * miniapp requires. Compatible only when every required dep is present and in range.
 */
export declare function satisfiesShared(hostProvided: Readonly<Record<string, SemVer>>, miniappShared: readonly SharedDepSpec[]): SkewResult;
//# sourceMappingURL=shared.d.ts.map