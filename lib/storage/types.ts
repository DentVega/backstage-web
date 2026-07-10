/** Abstraction over chunk artifact storage (ADR-015). Impl: Vercel Blob. */

export interface StorageFile {
  /** Path within the versioned prefix, e.g. "account_dashboard.container.js.bundle". */
  readonly path: string;
  readonly data: Uint8Array;
}

export interface ChunkStorage {
  /** Upload all files under `prefix/`; returns the base URL for that prefix. */
  putMany(prefix: string, files: readonly StorageFile[]): Promise<{ baseUrl: string }>;
}

export class StorageError extends Error {
  readonly code = "STORAGE_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}
