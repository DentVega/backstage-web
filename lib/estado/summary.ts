/**
 * View-model puro para la página `/estado` (estado operativo de la plataforma).
 * Toda la lógica no-trivial vive acá para poder testearla sin renderizar.
 */
import type { CatalogEntry, Registry } from "@/lib/registry/types";
import type { HostContract } from "@/lib/host-contract/types";
import type { StorageProvider } from "@/lib/storage/provider";

export type Platform = "android" | "ios";

const DAY_MS = 86_400_000;

export interface FleetItem {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly servedVersion: string | null;
  readonly latestVersion: string | null;
  /** La versión servida difiere de la última publicada (rollback/freeze activo). */
  readonly isRolledBack: boolean;
  readonly versionCount: number;
  /** Plataformas soportadas: siempre "android" si hay versiones, + "ios" si alguna trae chunk iOS. */
  readonly platforms: readonly Platform[];
  /** ISO de la publicación más reciente (cualquier versión), o null si no hay ninguna. */
  readonly lastPublishedAt: string | null;
  /** Días desde la última publicación (>= 0), o null si no hay ninguna. */
  readonly daysSincePublish: number | null;
  readonly repoUrl?: string;
}

export interface StorageState {
  readonly active: StorageProvider;
  readonly available: readonly StorageProvider[];
  readonly source: "preference" | "env";
}

export type ContractSummary =
  | { readonly published: false }
  | {
      readonly published: true;
      readonly contractVersion: string;
      readonly reactNative: string;
      readonly shared: readonly (readonly [string, string])[];
      readonly nativeModules: readonly string[];
    };

export interface EstadoSummary {
  readonly fleet: readonly FleetItem[];
  readonly totals: {
    readonly miniapps: number;
    readonly versions: number;
    readonly iosAndAndroid: number;
    /** Publicaciones (versiones) en los últimos 30 días, a lo largo de toda la flota. */
    readonly publishedLast30d: number;
  };
  readonly contract: ContractSummary;
  readonly gate: "warn" | "enforce";
  readonly storage: StorageState;
}

/**
 * Arma el summary a partir de los datos crudos. `entries` viene de `listCatalog`
 * (served/latest/count ya resueltos); `reg` se usa para derivar el soporte iOS y las
 * fechas de publicación por miniapp (las view-models no exponen `iosUrl`/`publishedAt`).
 * `now` (epoch ms) se inyecta para mantener la función pura/determinista.
 */
export function buildEstadoSummary(
  entries: readonly CatalogEntry[],
  reg: Registry,
  contract: HostContract | null,
  gateEnforce: boolean,
  storage: StorageState,
  now: number,
): EstadoSummary {
  const fleet: FleetItem[] = entries.map((e) => {
    const versions = reg[e.id]?.versions ?? [];
    const platforms: Platform[] = [];
    if (e.versionCount > 0) {
      platforms.push("android");
      if (versions.some((v) => Boolean(v.iosUrl))) platforms.push("ios");
    }
    let lastPublishedAt: string | null = null;
    for (const v of versions) {
      if (v.publishedAt && (lastPublishedAt === null || v.publishedAt > lastPublishedAt)) {
        lastPublishedAt = v.publishedAt;
      }
    }
    const daysSincePublish =
      lastPublishedAt !== null
        ? Math.max(0, Math.floor((now - Date.parse(lastPublishedAt)) / DAY_MS))
        : null;
    const isRolledBack =
      e.servedVersion !== null &&
      e.latestVersion !== null &&
      e.servedVersion !== e.latestVersion;
    return {
      id: e.id,
      name: e.name,
      owner: e.owner,
      servedVersion: e.servedVersion,
      latestVersion: e.latestVersion,
      isRolledBack,
      versionCount: e.versionCount,
      platforms,
      lastPublishedAt,
      daysSincePublish,
      repoUrl: e.repoUrl,
    };
  });

  const cutoff = now - 30 * DAY_MS;
  let publishedLast30d = 0;
  for (const e of entries) {
    for (const v of reg[e.id]?.versions ?? []) {
      if (v.publishedAt && Date.parse(v.publishedAt) >= cutoff) publishedLast30d++;
    }
  }

  const totals = {
    miniapps: fleet.length,
    versions: fleet.reduce((n, f) => n + f.versionCount, 0),
    iosAndAndroid: fleet.filter(
      (f) => f.platforms.includes("ios") && f.platforms.includes("android"),
    ).length,
    publishedLast30d,
  };

  const contractSummary: ContractSummary = contract
    ? {
        published: true,
        contractVersion: contract.contractVersion,
        reactNative: contract.reactNative,
        shared: Object.entries(contract.shared),
        nativeModules: [...contract.nativeModules],
      }
    : { published: false };

  return {
    fleet,
    totals,
    contract: contractSummary,
    gate: gateEnforce ? "enforce" : "warn",
    storage,
  };
}
