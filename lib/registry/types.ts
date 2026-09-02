import type { Manifest, MiniappId, SemVer } from "@dentvega/miniapp-contract";
import type { StorageProvider } from "@/lib/storage/provider";

export interface PublishedVersion {
  readonly version: SemVer;
  /** URL of the federated chunk (dev server for now; CDN in Operations). */
  readonly url: string;
  readonly manifest: Manifest;
  readonly publishedAt: string; // ISO
  /** URL del chunk iOS (opcional; aditivo — Android sigue en `url`). */
  readonly iosUrl?: string;
  /** sha256 del chunk iOS ("sha256-…"); el resolve iOS lo pisa en manifest.integrity. */
  readonly iosIntegrity?: string;
  /** Firma Ed25519 (base64url) del chunk Android — el CI la produce; el host la verifica. */
  readonly signature?: string;
  /** Firma Ed25519 (base64url) del chunk iOS; el resolve iOS la inyecta en manifest.signature. */
  readonly iosSignature?: string;
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
  /** Provider de storage pinneado para esta miniapp; undefined = usa el default global. */
  readonly storageProvider?: StorageProvider;
  /** Versión fijada que el host sirve por defecto (rollback/freeze). undefined = última (auto). */
  readonly pinnedVersion?: SemVer;
  /** Logins de GitHub que pueden gestionar esta miniapp (además de los platform-admins). */
  readonly maintainers?: string[];
  /** Pubkey actual de la miniapp (raw base64url). SOLO conveniencia (UI + borrador del
   *  bundle). La autoridad es la tabla firmada por root, no este campo (vive en KV). */
  readonly publicKey?: string;
}

export type Registry = Readonly<Record<string, MiniappRecord>>;

export interface CatalogEntry {
  readonly id: MiniappId;
  readonly name: string;
  readonly owner: string;
  readonly latestVersion: SemVer | null;
  /** Versión que el host sirve (pinnedVersion ?? latest). null si no hay ninguna. */
  readonly servedVersion: SemVer | null;
  readonly versionCount: number;
  readonly createdAt?: string;
  readonly repoUrl?: string;
  /** Pubkey de firma (base64url) — la usa la CLI del trust bundle para armar la tabla. */
  readonly publicKey?: string;
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
  /** Per-miniapp storage override (undefined = global default). */
  readonly storageProvider?: StorageProvider;
  /** Versión fijada (undefined = automática/última). */
  readonly pinnedVersion?: SemVer;
  /** Versión que el host sirve HOY: pinnedVersion ?? latest. */
  readonly servedVersion: SemVer | null;
  /** Logins de GitHub que pueden gestionar esta miniapp. */
  readonly maintainers?: string[];
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

export class InvalidRepoUrlError extends Error {
  readonly code = "INVALID_REPO_URL";
  constructor(id: string) {
    super(`Miniapp "${id}" has no valid GitHub repo URL.`);
    this.name = "InvalidRepoUrlError";
  }
}

export class NoCompatibleVersionError extends Error {
  readonly code = "NO_COMPATIBLE_VERSION";
  constructor(id: string, detail: string) {
    super(`No compatible version for "${id}": ${detail}`);
    this.name = "NoCompatibleVersionError";
  }
}

/** Se agotaron los reintentos de CAS sobre una miniapp (escrituras concurrentes). Reintentable. */
export class ConflictError extends Error {
  readonly code = "CONFLICT";
  constructor(id: string) {
    super(`concurrent update conflict for "${id}" — retry`);
    this.name = "ConflictError";
  }
}
