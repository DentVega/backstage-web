import { r2ConfigFromEnv, r2Storage } from "./r2";
import { blobStorage } from "./blob";
import { fsStorage } from "./fs";
import { availableProviders, type StorageProvider } from "./provider";
import { getStoragePreferenceStore } from "./preference";
import type { ChunkStorage } from "./types";

function buildStorage(p: StorageProvider): ChunkStorage {
  if (p === "r2") {
    const cfg = r2ConfigFromEnv();
    if (cfg === null) throw new Error("R2 selected but not configured");
    return r2Storage(cfg);
  }
  if (p === "blob") return blobStorage();
  return fsStorage();
}

/** Active provider + whether it came from the saved preference or env-order. */
export async function getStorageProviderState(): Promise<{
  available: StorageProvider[];
  active: StorageProvider;
  source: "preference" | "env";
}> {
  const pref = await getStoragePreferenceStore().load();
  const available = availableProviders();
  const usePref = pref !== null && available.includes(pref);
  return {
    available,
    active: usePref ? pref : available[0],
    source: usePref ? "preference" : "env",
  };
}

/** Per-miniapp storage state: override vs global default, with the effective provider. */
export async function getMiniappStorageState(miniappOverride: StorageProvider | null): Promise<{
  available: StorageProvider[];
  override: StorageProvider | null;
  defaultProvider: StorageProvider;
  effective: StorageProvider;
  source: "miniapp" | "preference" | "env";
}> {
  const global = await getStorageProviderState();
  const useOverride = miniappOverride !== null && global.available.includes(miniappOverride);
  return {
    available: global.available,
    override: miniappOverride,
    defaultProvider: global.active,
    effective: useOverride ? miniappOverride : global.active,
    source: useOverride ? "miniapp" : global.source,
  };
}

/** Storage for a publish: miniapp override (if valid) → global default → env-order. */
export async function getStorage(
  miniappOverride: StorageProvider | null = null,
): Promise<ChunkStorage> {
  const { effective } = await getMiniappStorageState(miniappOverride);
  return buildStorage(effective);
}
