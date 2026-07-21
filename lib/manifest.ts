/** Build a default version manifest so the UI publish flow doesn't need raw JSON. */
import type { Capability, Manifest } from "@dentvega/miniapp-contract";

/**
 * Shared singletons the mobile host provides. A version's manifest declares the
 * ranges it's compatible with; these mirror what the host bundles (react,
 * react-native, react-query, flash-list). Keep in sync with the host's MF config.
 */
const DEFAULT_SHARED = [
  { name: "react", requiredRange: "^18.3.0", singleton: true },
  { name: "react-native", requiredRange: "^0.76.0", singleton: true },
  { name: "@tanstack/react-query", requiredRange: "^5.0.0", singleton: true },
  { name: "@shopify/flash-list", requiredRange: "^1.7.0", singleton: true },
] as const;

const KNOWN_CAPABILITIES: readonly Capability[] = ["accounts:read", "session:whoami"];

/** Parse a CSV capabilities string, keeping only known capability values. */
export function parseCapabilities(csv: string | null | undefined): Capability[] {
  if (!csv) return [];
  return csv
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is Capability => (KNOWN_CAPABILITIES as readonly string[]).includes(s));
}

/**
 * Default manifest for a published version. `entry` is the Module Federation
 * exposed module (always `./Entry`); `shared` mirrors the host singletons.
 * Integrity is left unset (verification is activation-pending — ADR-008/001).
 */
export function defaultManifest(
  id: string,
  version: string,
  capabilities: readonly Capability[],
): Manifest {
  return {
    id: id as Manifest["id"],
    version: version as Manifest["version"],
    entry: "./Entry",
    shared: DEFAULT_SHARED,
    capabilities,
  };
}
