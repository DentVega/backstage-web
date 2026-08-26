/** Pure registry domain — no Next.js, no fs. Unit-tested (ADR-007, Vitest). */
import {
  isManifest,
  parseMiniappId,
  parseSemVer,
  satisfiesRange,
  type Manifest,
  type MiniappId,
  type ResolveResponse,
  type SemVer,
} from "@dentvega/miniapp-contract";
import type { StorageProvider } from "@/lib/storage/provider";
import {
  InvalidManifestError,
  MiniappExistsError,
  MiniappNotFoundError,
  NoCompatibleVersionError,
  VersionExistsError,
  type CatalogEntry,
  type MiniappDetail,
  type MiniappRecord,
  type PublishedVersion,
  type Registry,
  type VersionView,
} from "./types";

/** Compare two semvers; positive when a > b. */
function compareSemVer(a: SemVer, b: SemVer): number {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Highest-version published version, or null when empty. */
export function selectLatest(
  versions: readonly PublishedVersion[],
): PublishedVersion | null {
  if (versions.length === 0) return null;
  return versions.reduce((best, v) =>
    compareSemVer(v.version, best.version) > 0 ? v : best,
  );
}

/**
 * Versiones a prunear: las que quedan FUERA de {últimas keepN} ∪ {servida}. La versión
 * servida (pinnedVersion ?? latest) JAMÁS se prunea (su chunk se sigue montando).
 */
export function versionsToPrune(record: MiniappRecord, keepN: number): SemVer[] {
  const sorted = [...record.versions].sort((a, b) => compareSemVer(b.version, a.version)); // desc
  const served = record.pinnedVersion ?? sorted[0]?.version;
  const keep = new Set<string>(sorted.slice(0, keepN).map((v) => v.version));
  if (served !== undefined) keep.add(served);
  return sorted.filter((v) => !keep.has(v.version)).map((v) => v.version);
}

/**
 * Saca una versión puntual del registry (borrado manual). Rechaza la servida
 * (pinnedVersion ?? latest — se está montando) y las versiones inexistentes.
 */
export function removeVersion(reg: Registry, rawId: string, version: string): Registry {
  const id = parseMiniappId(rawId);
  if (id === null) throw new InvalidManifestError(`bad miniapp id "${rawId}"`);
  const record = reg[id];
  if (record === undefined) throw new MiniappNotFoundError(id);
  if (!record.versions.some((v) => v.version === version)) {
    throw new InvalidManifestError(`version ${version} not found for ${id}`);
  }
  const served = record.pinnedVersion ?? selectLatest(record.versions)?.version;
  if (version === served) {
    throw new InvalidManifestError(`no se puede borrar la versión servida (${version})`);
  }
  return {
    ...reg,
    [id]: { ...record, versions: record.versions.filter((v) => v.version !== version) },
  };
}

export function registerMiniapp(
  reg: Registry,
  input: { id: string; name: string; owner: string; repoUrl?: string },
  now: string,
): Registry {
  const id = parseMiniappId(input.id);
  if (id === null) throw new InvalidManifestError(`bad miniapp id "${input.id}"`);
  if (reg[id] !== undefined) throw new MiniappExistsError(id);

  const record: MiniappRecord = {
    id,
    name: input.name,
    owner: input.owner,
    versions: [],
    createdAt: now,
    ...(input.repoUrl !== undefined ? { repoUrl: input.repoUrl } : {}),
  };
  return { ...reg, [id]: record };
}

/** Remove a miniapp from the registry (admin cleanup). Throws if it doesn't exist. */
export function removeMiniapp(reg: Registry, rawId: string): Registry {
  const id = parseMiniappId(rawId);
  if (id === null) throw new InvalidManifestError(`bad miniapp id "${rawId}"`);
  if (reg[id] === undefined) throw new MiniappNotFoundError(id);
  const next = { ...reg };
  delete next[id];
  return next;
}

/** Update a miniapp's mutable metadata (repoUrl / owner). Throws if it doesn't exist. */
export function updateMiniappMeta(
  reg: Registry,
  rawId: string,
  patch: { repoUrl?: string; owner?: string },
): Registry {
  const id = parseMiniappId(rawId);
  if (id === null) throw new InvalidManifestError(`bad miniapp id "${rawId}"`);
  const record = reg[id];
  if (record === undefined) throw new MiniappNotFoundError(id);
  const next = {
    ...record,
    ...(patch.repoUrl !== undefined ? { repoUrl: patch.repoUrl } : {}),
    ...(patch.owner !== undefined ? { owner: patch.owner } : {}),
  };
  return { ...reg, [id]: next };
}

/** Set (or clear, with null) the per-miniapp storage provider override. Throws if it doesn't exist. */
export function setMiniappStorageProvider(
  reg: Registry,
  rawId: string,
  provider: StorageProvider | null,
): Registry {
  const id = parseMiniappId(rawId);
  if (id === null) throw new InvalidManifestError(`bad miniapp id "${rawId}"`);
  const record = reg[id];
  if (record === undefined) throw new MiniappNotFoundError(id);
  if (provider === null) {
    const next = { ...record };
    delete (next as { storageProvider?: StorageProvider }).storageProvider;
    return { ...reg, [id]: next };
  }
  return { ...reg, [id]: { ...record, storageProvider: provider } };
}

/**
 * Fija (o despina con null) la versión que el host sirve por defecto para una
 * miniapp (rollback/freeze). La versión debe existir (append-only, nunca borra).
 */
export function setMiniappPin(reg: Registry, rawId: string, version: string | null): Registry {
  const id = parseMiniappId(rawId);
  if (id === null) throw new InvalidManifestError(`bad miniapp id "${rawId}"`);
  const record = reg[id];
  if (record === undefined) throw new MiniappNotFoundError(id);
  if (version === null) {
    const next = { ...record };
    delete (next as { pinnedVersion?: SemVer }).pinnedVersion;
    return { ...reg, [id]: next };
  }
  if (!record.versions.some((v) => v.version === version)) {
    throw new InvalidManifestError(`version ${version} not published for ${id}`);
  }
  return { ...reg, [id]: { ...record, pinnedVersion: version as SemVer } };
}

/** Setea los maintainers (logins) de una miniapp. Normaliza (trim + dedup); vacío borra el campo. */
export function setMaintainers(reg: Registry, rawId: string, list: readonly string[]): Registry {
  const id = parseMiniappId(rawId);
  if (id === null) throw new InvalidManifestError(`bad miniapp id "${rawId}"`);
  const record = reg[id];
  if (record === undefined) throw new MiniappNotFoundError(id);
  const cleaned = [...new Set(list.map((s) => s.trim()).filter((s) => s.length > 0))];
  if (cleaned.length === 0) {
    const next = { ...record };
    delete (next as { maintainers?: string[] }).maintainers;
    return { ...reg, [id]: next };
  }
  return { ...reg, [id]: { ...record, maintainers: cleaned } };
}

export function publishVersion(
  reg: Registry,
  rawId: string,
  input: {
    version: string;
    url: string;
    manifest: unknown;
    platform?: "android" | "ios";
    integrity?: string;
    signature?: string;
  },
  now: string,
): Registry {
  const id = parseMiniappId(rawId);
  if (id === null) throw new InvalidManifestError(`bad miniapp id "${rawId}"`);

  const record = reg[id];
  if (record === undefined) throw new MiniappNotFoundError(id);

  const version = parseSemVer(input.version);
  if (version === null) throw new InvalidManifestError(`bad semver "${input.version}"`);

  if (!isManifest(input.manifest)) {
    throw new InvalidManifestError("does not satisfy the contract shape");
  }
  const manifest: Manifest = input.manifest;
  if (manifest.id !== id) {
    throw new InvalidManifestError(`manifest.id "${manifest.id}" !== "${id}"`);
  }
  if (manifest.version !== version) {
    throw new InvalidManifestError(
      `manifest.version "${manifest.version}" !== "${version}"`,
    );
  }
  if (typeof input.url !== "string" || input.url.length === 0) {
    throw new InvalidManifestError("missing chunk url");
  }

  const platform = input.platform ?? "android";
  const existing = record.versions.find((v) => v.version === version);

  if (platform === "ios") {
    // iOS se ADJUNTA a la versión de Android existente (no crea versión nueva).
    if (existing === undefined) {
      throw new InvalidManifestError(`publicá Android primero para la versión ${version}`);
    }
    if (existing.iosUrl !== undefined) {
      throw new VersionExistsError(id, `${version} (ios)`);
    }
    const attached: PublishedVersion = {
      ...existing,
      iosUrl: input.url,
      iosIntegrity: input.integrity,
      iosSignature: input.signature,
    };
    const updated: MiniappRecord = {
      ...record,
      versions: record.versions.map((v) => (v.version === version ? attached : v)),
    };
    return { ...reg, [id]: updated };
  }

  // Android (default) — comportamiento histórico.
  if (existing !== undefined) {
    throw new VersionExistsError(id, version);
  }
  const published: PublishedVersion = {
    version,
    url: input.url,
    manifest,
    publishedAt: now,
    ...(input.signature !== undefined ? { signature: input.signature } : {}),
  };
  const updated: MiniappRecord = {
    ...record,
    versions: [...record.versions, published],
  };
  return { ...reg, [id]: updated };
}

export interface ResolveOptions {
  /** Exact version to resolve. */
  version?: string;
  /** Semver range the host requires (host provides this compatibility window). */
  range?: string;
  /** Plataforma del host; "ios" sirve el chunk iOS. Default/ausente = Android. */
  platform?: "android" | "ios";
}

export function resolveMiniapp(
  reg: Registry,
  rawId: string,
  opts: ResolveOptions = {},
): ResolveResponse {
  const id = parseMiniappId(rawId);
  if (id === null) throw new MiniappNotFoundError(rawId);

  const record = reg[id];
  if (record === undefined) throw new MiniappNotFoundError(id);
  if (record.versions.length === 0) {
    throw new NoCompatibleVersionError(id, "no versions published");
  }

  let chosen: PublishedVersion | null;
  if (opts.version !== undefined) {
    chosen = record.versions.find((v) => v.version === opts.version) ?? null;
    if (chosen === null) {
      throw new NoCompatibleVersionError(id, `version ${opts.version} not found`);
    }
  } else if (opts.range !== undefined && opts.range !== "") {
    const compatible = record.versions.filter((v) =>
      satisfiesRange(v.version, opts.range as string),
    );
    chosen = selectLatest(compatible);
    if (chosen === null) {
      throw new NoCompatibleVersionError(id, `none satisfy ${opts.range}`);
    }
  } else if (record.pinnedVersion !== undefined) {
    // Pin/rollback: el host pide sin versión → servimos la fijada. Fallback
    // defensivo a la última (nunca debería faltar: las versiones son append-only).
    chosen =
      record.versions.find((v) => v.version === record.pinnedVersion) ??
      selectLatest(record.versions);
  } else {
    chosen = selectLatest(record.versions);
  }

  // selectLatest returns non-null here (versions.length > 0 checked above).
  const version = chosen as PublishedVersion;

  if (opts.platform === "ios") {
    if (version.iosUrl === undefined) {
      throw new NoCompatibleVersionError(id, `iOS no publicado para la versión ${version.version}`);
    }
    return {
      id,
      version: version.version,
      url: version.iosUrl,
      manifest: { ...version.manifest, integrity: version.iosIntegrity },
    };
  }

  return {
    id,
    version: version.version,
    url: version.url,
    manifest: version.manifest,
  };
}

export function listCatalog(reg: Registry): CatalogEntry[] {
  return Object.values(reg).map((record) => {
    const latest = selectLatest(record.versions);
    return {
      id: record.id as MiniappId,
      name: record.name,
      owner: record.owner,
      latestVersion: latest?.version ?? null,
      servedVersion: record.pinnedVersion ?? latest?.version ?? null,
      versionCount: record.versions.length,
      ...(record.createdAt !== undefined ? { createdAt: record.createdAt } : {}),
      ...(record.repoUrl !== undefined ? { repoUrl: record.repoUrl } : {}),
    };
  });
}

/** Full detail view-model for one miniapp. Pure — no network. */
export function getMiniappDetail(reg: Registry, rawId: string): MiniappDetail {
  const id = parseMiniappId(rawId);
  if (id === null) throw new MiniappNotFoundError(rawId);

  const record = reg[id];
  if (record === undefined) throw new MiniappNotFoundError(id);

  const latest = selectLatest(record.versions);
  const versions: VersionView[] = [...record.versions]
    .sort((a, b) => compareSemVer(b.version, a.version))
    .map((v) => ({
      version: v.version,
      url: v.url,
      publishedAt: v.publishedAt,
      capabilities: v.manifest.capabilities ?? [],
    }));

  return {
    id: record.id as MiniappId,
    name: record.name,
    owner: record.owner,
    ...(record.createdAt !== undefined ? { createdAt: record.createdAt } : {}),
    ...(record.repoUrl !== undefined ? { repoUrl: record.repoUrl } : {}),
    ...(record.storageProvider !== undefined ? { storageProvider: record.storageProvider } : {}),
    ...(record.pinnedVersion !== undefined ? { pinnedVersion: record.pinnedVersion } : {}),
    ...(record.maintainers !== undefined ? { maintainers: record.maintainers } : {}),
    latestVersion: latest?.version ?? null,
    servedVersion: record.pinnedVersion ?? latest?.version ?? null,
    versionCount: record.versions.length,
    versions,
    capabilities: latest?.manifest.capabilities ?? [],
  };
}
