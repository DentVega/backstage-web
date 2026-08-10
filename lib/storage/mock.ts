import type { ChunkStorage, StorageFile } from "./types";

/** In-memory storage for tests: records uploads (y deletes), base URL determinística. */
export function mockStorage(
  sink?: { prefix: string; files: StorageFile[] }[],
  deletes?: string[],
): ChunkStorage {
  return {
    async putMany(prefix, files) {
      sink?.push({ prefix, files: [...files] });
      return { baseUrl: `https://mock.blob/${prefix}` };
    },
    async deletePrefix(prefix) {
      deletes?.push(prefix);
    },
  };
}
