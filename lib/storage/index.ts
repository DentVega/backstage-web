import { blobStorage } from "./blob";
import { fsStorage } from "./fs";
import type { ChunkStorage } from "./types";

/** Storage selected by env: Vercel Blob in prod, fs (public/chunks) in dev. */
export function getStorage(): ChunkStorage {
  return process.env.BLOB_READ_WRITE_TOKEN ? blobStorage() : fsStorage();
}
