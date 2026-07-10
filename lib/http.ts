/** Map typed domain errors to HTTP status codes. */
import {
  InvalidManifestError,
  MiniappExistsError,
  MiniappNotFoundError,
  NoCompatibleVersionError,
  VersionExistsError,
} from "./registry/types";
import { GitProviderError } from "./git/types";
import { StorageError } from "./storage/types";
import { AuthError } from "./auth";

export function statusForError(err: unknown): number {
  if (err instanceof AuthError) return 401;
  if (err instanceof MiniappNotFoundError) return 404;
  if (err instanceof NoCompatibleVersionError) return 404;
  if (err instanceof MiniappExistsError) return 409;
  if (err instanceof VersionExistsError) return 409;
  if (err instanceof InvalidManifestError) return 400;
  if (err instanceof GitProviderError) return 502;
  if (err instanceof StorageError) return 502;
  return 500;
}

export function errorBody(err: unknown): { error: string; code?: string } {
  if (err instanceof Error) {
    const code = (err as { code?: string }).code;
    return code !== undefined ? { error: err.message, code } : { error: err.message };
  }
  return { error: "Unknown error" };
}
