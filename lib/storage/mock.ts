import type { ChunkStorage, StorageFile } from "./types";

/** In-memory storage for tests: records uploads, returns a deterministic base URL. */
export function mockStorage(sink?: { prefix: string; files: StorageFile[] }[]): ChunkStorage {
  return {
    async putMany(prefix, files) {
      sink?.push({ prefix, files: [...files] });
      return { baseUrl: `https://mock.blob/${prefix}` };
    },
  };
}
