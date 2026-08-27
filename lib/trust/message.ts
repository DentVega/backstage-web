/** Mensajes canónicos que firman el CI (chunk) y el owner (bundle). Puros y
 *  determinísticos — el host reconstruye estos mismos strings para verificar. */
import type { TrustBundleBody } from "./types";

export function chunkSignatureMessage(
  id: string,
  platform: "android" | "ios",
  integrity: string,
): string {
  return `${id}:${platform}:${integrity}`;
}

export function canonicalBundleMessage(body: TrustBundleBody): string {
  const keys: Record<string, string> = {};
  for (const k of Object.keys(body.keys).sort()) keys[k] = body.keys[k];
  return JSON.stringify({ version: body.version, updatedAt: body.updatedAt, keys });
}
