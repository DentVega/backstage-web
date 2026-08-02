import { r2ConfigFromEnv, r2Storage } from "./r2";
import { blobStorage } from "./blob";
import { fsStorage } from "./fs";
import type { ChunkStorage } from "./types";

/** Storage selected by env: R2 (if configured) → Vercel Blob → fs (dev). */
export function getStorage(): ChunkStorage {
  const r2 = r2ConfigFromEnv();
  if (r2 !== null) return r2Storage(r2);
  if (process.env.BLOB_READ_WRITE_TOKEN) return blobStorage();
  return fsStorage();
}
