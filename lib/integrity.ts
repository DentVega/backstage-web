/** Chunk integrity: an SRI-style `sha256-<hex>` descriptor over the container bytes. */
import { createHash } from "node:crypto";

/**
 * Compute the integrity descriptor for a chunk's bytes. Backstage sets this on
 * the manifest at publish from the ACTUAL uploaded bytes (never trusting a
 * client-supplied value), so the host can verify the download hasn't been
 * tampered with. Hex (not base64) to match the host's pure-JS verifier.
 */
export function sha256Integrity(bytes: Uint8Array): string {
  return `sha256-${createHash("sha256").update(bytes).digest("hex")}`;
}
