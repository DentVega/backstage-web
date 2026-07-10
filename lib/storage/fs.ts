/** Dev-only chunk storage: writes to public/chunks/ so Next serves them locally.
 * NOT for serverless (fs is ephemeral) — prod uses Vercel Blob. */
import { promises as fs } from "node:fs";
import path from "node:path";
import { StorageError, type ChunkStorage } from "./types";

export function fsStorage(
  baseOrigin = process.env.BACKSTAGE_PUBLIC_URL ?? "http://localhost:3999",
): ChunkStorage {
  return {
    async putMany(prefix, files) {
      if (files.length === 0) throw new StorageError("no files to upload");
      const root = path.join(process.cwd(), "public", "chunks", prefix);
      await fs.mkdir(root, { recursive: true });
      for (const file of files) {
        const dest = path.join(root, file.path);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, file.data);
      }
      return { baseUrl: `${baseOrigin}/chunks/${prefix}` };
    },
  };
}
