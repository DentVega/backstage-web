/**
 * View-model puro para la página `/estado` (estado operativo de la plataforma).
 * Toda la lógica no-trivial vive acá para poder testearla sin renderizar.
 */
import type { CatalogEntry, Registry } from "@/lib/registry/types";
import type { HostContract } from "@/lib/host-contract/types";
import type { StorageProvider } from "@/lib/storage/provider";

export type Platform = "android" | "ios";

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
  };
  readonly contract: ContractSummary;
  readonly gate: "warn" | "enforce";
  readonly storage: StorageState;
}

/**
 * Arma el summary a partir de los datos crudos. `entries` viene de `listCatalog`
 * (served/latest/count ya resueltos); `reg` se usa solo para derivar el soporte iOS
 * por miniapp (las view-models no exponen `iosUrl`).
 */
export function buildEstadoSummary(
  entries: readonly CatalogEntry[],
  reg: Registry,
  contract: HostContract | null,
  gateEnforce: boolean,
  storage: StorageState,
): EstadoSummary {
  const fleet: FleetItem[] = entries.map((e) => {
    const versions = reg[e.id]?.versions ?? [];
    const platforms: Platform[] = [];
    if (e.versionCount > 0) {
      platforms.push("android");
      if (versions.some((v) => Boolean(v.iosUrl))) platforms.push("ios");
    }
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
      repoUrl: e.repoUrl,
    };
  });

  const totals = {
    miniapps: fleet.length,
    versions: fleet.reduce((n, f) => n + f.versionCount, 0),
    iosAndAndroid: fleet.filter(
      (f) => f.platforms.includes("ios") && f.platforms.includes("android"),
    ).length,
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
