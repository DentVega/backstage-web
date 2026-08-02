import { AwsClient } from "aws4fetch";
import { StorageError, type ChunkStorage } from "./types";

export interface R2Config {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly publicBaseUrl: string;
}

/** R2 config from env; null if any of the 5 vars is missing. */
export function r2ConfigFromEnv(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return null;
  }
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

/** Minimal signed-fetch: prod wraps aws4fetch; tests pass a fake. */
export type SignedFetch = (
  url: string,
  init: { method: string; body: Uint8Array; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number }>;

function contentType(path: string): string {
  if (path.endsWith(".js") || path.endsWith(".bundle")) return "application/javascript";
  if (path.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

/** Default signed fetch — aws4fetch signs each request with SigV4 for R2 (S3). */
function defaultSignedFetch(config: R2Config): SignedFetch {
  const aws = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  return (url, init) => aws.fetch(url, init as RequestInit);
}

/**
 * Cloudflare R2 chunk storage (S3-compatible). WRITES are SigV4-signed to the R2 S3
 * endpoint; READS come from the bucket's PUBLIC base URL — two different hosts, so
 * putMany writes to one and returns the other as baseUrl. Idempotent (S3 PUT overwrites).
 */
export function r2Storage(config: R2Config, fetchImpl?: SignedFetch): ChunkStorage {
  const doFetch = fetchImpl ?? defaultSignedFetch(config);
  const s3 = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;
  const publicBase = config.publicBaseUrl.replace(/\/+$/, "");
  return {
    async putMany(prefix, files): Promise<{ baseUrl: string }> {
      if (files.length === 0) throw new StorageError("no files to upload");
      try {
        for (const file of files) {
          const res = await doFetch(`${s3}/${prefix}/${file.path}`, {
            method: "PUT",
            body: file.data,
            headers: { "content-type": contentType(file.path) },
          });
          if (!res.ok) throw new StorageError(`R2 PUT failed: HTTP ${res.status}`);
        }
      } catch (err) {
        if (err instanceof StorageError) throw err;
        throw new StorageError(err instanceof Error ? err.message : "R2 upload failed");
      }
      return { baseUrl: `${publicBase}/${prefix}` };
    },
  };
}
