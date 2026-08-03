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

/** Storage selected by saved preference (if valid) else env-order (R2 → Blob → fs). */
export async function getStorage(): Promise<ChunkStorage> {
  const { active } = await getStorageProviderState();
  return buildStorage(active);
}
