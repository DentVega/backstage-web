/** Pure validation / parsing for the contract. Unit-tested in Bolt 1. */
import type { Manifest, MiniappId, SemVer } from "./types.js";
/** Parse & validate a semver string; returns null when malformed. */
export declare function parseSemVer(value: string): SemVer | null;
/** Validate a miniapp id; returns null when malformed. */
export declare function parseMiniappId(value: string): MiniappId | null;
/** Structural type guard for a Manifest coming from an untrusted source. */
export declare function isManifest(x: unknown): x is Manifest;
//# sourceMappingURL=guards.d.ts.map