import { r2ConfigFromEnv } from "./r2";

export type StorageProvider = "r2" | "blob" | "fs";

const ALL: readonly StorageProvider[] = ["r2", "blob", "fs"];

export function isStorageProvider(v: unknown): v is StorageProvider {
  return typeof v === "string" && (ALL as readonly string[]).includes(v);
}

/** Providers configured by env, in precedence order. `fs` is always available. */
export function availableProviders(): StorageProvider[] {
  const out: StorageProvider[] = [];
  if (r2ConfigFromEnv() !== null) out.push("r2");
  if (process.env.BLOB_READ_WRITE_TOKEN) out.push("blob");
  out.push("fs");
  return out;
}
