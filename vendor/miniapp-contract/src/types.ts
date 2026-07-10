/**
 * Value objects of the miniapp federation contract.
 * Framework-free, no runtime deps — this is the ubiquitous language shared by
 * the mobile host, the miniapps, and the Backstage registry (see model.md).
 */

/** Branded miniapp identifier (non-empty kebab/snake string). */
export type MiniappId = string & { readonly __brand: "MiniappId" };

/** Branded semantic version string "MAJOR.MINOR.PATCH". */
export type SemVer = string & { readonly __brand: "SemVer" };

/** A shared dependency the host provides or a miniapp requires. */
export interface SharedDepSpec {
  /** Package name, e.g. "react-native" or "zustand". */
  readonly name: string;
  /** Semver range the consumer requires, e.g. "^18.3.0". */
  readonly requiredRange: string;
  /** Whether the dependency must be a single shared instance across chunks. */
  readonly singleton: boolean;
}

/**
 * Scoped, revocable permissions the host grants a miniapp.
 * NEVER a raw credential. Seed set — extend as real miniapps land (Bolt 3+).
 */
export type Capability = "accounts:read" | "session:whoami";

/** A capability grant handed to a mounted miniapp entry. */
export interface CapabilityGrant {
  readonly granted: readonly Capability[];
  /** True once the host has revoked the grant (miniapp must stop using it). */
  readonly isRevoked: () => boolean;
}

/** Metadata describing one published version of a miniapp. */
export interface Manifest {
  readonly id: MiniappId;
  readonly version: SemVer;
  /** Module Federation exposed entry, e.g. "./Entry". */
  readonly entry: string;
  readonly shared: readonly SharedDepSpec[];
  readonly capabilities: readonly Capability[];
  /**
   * Integrity descriptor (hash or signature). The verification MECHANISM is
   * decided by ADR-001 in Bolt 4; in Bolt 1 the field is optional and its
   * content is not validated.
   */
  readonly integrity?: string;
}

/** Host → Backstage resolve request. */
export interface ResolveRequest {
  readonly id: MiniappId;
  readonly hostVersion?: SemVer;
}

/** Backstage → host resolve response. */
export interface ResolveResponse {
  readonly id: MiniappId;
  readonly version: SemVer;
  /** URL of the federated chunk to download. */
  readonly url: string;
  readonly manifest: Manifest;
}

/** Props the host injects into a miniapp's exposed `./Entry` component. */
export interface MiniappEntryProps {
  readonly capabilities: CapabilityGrant;
}
