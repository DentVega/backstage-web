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
} from "@org/miniapp-contract";
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

export function publishVersion(
  reg: Registry,
  rawId: string,
  input: { version: string; url: string; manifest: unknown },
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
  if (record.versions.some((v) => v.version === version)) {
    throw new VersionExistsError(id, version);
  }

  const published: PublishedVersion = {
    version,
    url: input.url,
    manifest,
    publishedAt: now,
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
  } else {
    chosen = selectLatest(record.versions);
  }

  // selectLatest returns non-null here (versions.length > 0 checked above).
  const version = chosen as PublishedVersion;
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
    latestVersion: latest?.version ?? null,
    versionCount: record.versions.length,
    versions,
    capabilities: latest?.manifest.capabilities ?? [],
  };
}
