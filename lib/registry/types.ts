import type { Manifest, MiniappId, SemVer } from "@org/miniapp-contract";

export interface PublishedVersion {
  readonly version: SemVer;
  /** URL of the federated chunk (dev server for now; CDN in Operations). */
  readonly url: string;
  readonly manifest: Manifest;
  readonly publishedAt: string; // ISO
}

export interface MiniappRecord {
  readonly id: MiniappId;
  readonly name: string;
  readonly owner: string;
  readonly versions: readonly PublishedVersion[];
  /** ISO date when the miniapp was registered. Optional for records predating this field. */
  readonly createdAt?: string;
  /** URL of the miniapp's git repo (set by the scaffolder). */
  readonly repoUrl?: string;
}

export type Registry = Readonly<Record<string, MiniappRecord>>;

export interface CatalogEntry {
  readonly id: MiniappId;
  readonly name: string;
  readonly owner: string;
  readonly latestVersion: SemVer | null;
  readonly versionCount: number;
  readonly createdAt?: string;
  readonly repoUrl?: string;
}

/** A single published version, shaped for the detail UI. */
export interface VersionView {
  readonly version: SemVer;
  readonly url: string;
  readonly publishedAt: string;
  readonly capabilities: readonly string[];
}

/** Full miniapp detail view-model (pure projection of a MiniappRecord). */
export interface MiniappDetail {
  readonly id: MiniappId;
  readonly name: string;
  readonly owner: string;
  readonly createdAt?: string;
  readonly repoUrl?: string;
  readonly latestVersion: SemVer | null;
  readonly versionCount: number;
  /** Versions, newest first. */
  readonly versions: readonly VersionView[];
  /** Capabilities of the latest version (or [] when none published). */
  readonly capabilities: readonly string[];
}

// --- Typed domain errors (mapped to HTTP status by the route handlers) ---

export class MiniappExistsError extends Error {
  readonly code = "MINIAPP_EXISTS";
  constructor(id: string) {
    super(`Miniapp "${id}" is already registered.`);
    this.name = "MiniappExistsError";
  }
}

export class MiniappNotFoundError extends Error {
  readonly code = "MINIAPP_NOT_FOUND";
  constructor(id: string) {
    super(`Miniapp "${id}" is not registered.`);
    this.name = "MiniappNotFoundError";
  }
}

export class VersionExistsError extends Error {
  readonly code = "VERSION_EXISTS";
  constructor(id: string, version: string) {
    super(`Miniapp "${id}" already has version ${version}.`);
    this.name = "VersionExistsError";
  }
}

export class InvalidManifestError extends Error {
  readonly code = "INVALID_MANIFEST";
  constructor(reason: string) {
    super(`Invalid manifest: ${reason}`);
    this.name = "InvalidManifestError";
  }
}

export class NoCompatibleVersionError extends Error {
  readonly code = "NO_COMPATIBLE_VERSION";
  constructor(id: string, detail: string) {
    super(`No compatible version for "${id}": ${detail}`);
    this.name = "NoCompatibleVersionError";
  }
}
