import path from "node:path";
import {
  availableProviders,
  selectStorage,
  r2ConfigFromEnv,
  r2Storage,
  s3ConfigFromEnv,
  s3Storage,
  gcsConfigFromEnv,
  gcsStorage,
  azureConfigFromEnv,
  azureStorage,
  fsStorage,
  type ChunkStorage,
  type StorageProvider,
} from "@dentvega/miniapp-storage";
import { blobStorage } from "@dentvega/miniapp-storage/vercel-blob";
import { getStoragePreferenceStore } from "./preference";

function buildStorage(p: StorageProvider): ChunkStorage {
  if (p === "r2") {
    const cfg = r2ConfigFromEnv(process.env);
    if (cfg === null) throw new Error("R2 selected but not configured");
    return r2Storage(cfg);
  }
  if (p === "s3") {
    const cfg = s3ConfigFromEnv(process.env);
    if (cfg === null) throw new Error("S3 selected but not configured");
    return s3Storage(cfg);
  }
  if (p === "gcs") {
    const cfg = gcsConfigFromEnv(process.env);
    if (cfg === null) throw new Error("GCS selected but not configured");
    return gcsStorage(cfg);
  }
  if (p === "azure") {
    const cfg = azureConfigFromEnv(process.env);
    if (cfg === null) throw new Error("Azure selected but not configured");
    return azureStorage(cfg);
  }
  if (p === "blob") return blobStorage(process.env.BLOB_READ_WRITE_TOKEN);
  // El fs adapter de la librería no asume estructura de directorios: se la pasamos nosotros.
  return fsStorage(
    path.join(process.cwd(), "public", "chunks"),
    `${process.env.BACKSTAGE_PUBLIC_URL ?? "http://localhost:3999"}/chunks`,
  );
}

/** Provider activo + si vino de la preferencia guardada o del env-order. */
export async function getStorageProviderState(): Promise<{
  available: StorageProvider[];
  active: StorageProvider;
  source: "preference" | "env";
}> {
  const pref = await getStoragePreferenceStore().load();
  const available = availableProviders(process.env);
  const active = selectStorage(available, pref, null);
  return {
    available,
    active,
    source: pref !== null && available.includes(pref) ? "preference" : "env",
  };
}

/** Estado por-miniapp: override vs default global, con el provider efectivo. */
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

/** Storage para un publish: override de la miniapp → default global → env-order. */
export async function getStorage(
  miniappOverride: StorageProvider | null = null,
): Promise<ChunkStorage> {
  const { effective } = await getMiniappStorageState(miniappOverride);
  return buildStorage(effective);
}

export type { ChunkStorage, StorageProvider };
