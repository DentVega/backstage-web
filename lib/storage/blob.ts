import { put } from "@vercel/blob";
import { StorageError, type ChunkStorage, type StorageFile } from "./types";

/**
 * Vercel Blob storage: uploads each file under `prefix/<path>` (public, no random
 * suffix → deterministic URLs). Returns the base URL for the prefix.
 */
export function blobStorage(token = process.env.BLOB_READ_WRITE_TOKEN): ChunkStorage {
  return {
    async putMany(prefix, files): Promise<{ baseUrl: string }> {
      if (files.length === 0) throw new StorageError("no files to upload");
      try {
        let baseUrl = "";
        for (const file of files) {
          const { url } = await put(`${prefix}/${file.path}`, Buffer.from(file.data), {
            access: "public",
            addRandomSuffix: false,
            token,
          });
          // Derive the prefix base URL from any file's URL (strip "/<path>").
          if (baseUrl === "") {
            baseUrl = url.slice(0, url.length - file.path.length - 1);
          }
        }
        return { baseUrl };
      } catch (err) {
        throw new StorageError(err instanceof Error ? err.message : "blob upload failed");
      }
    },
  };
}
