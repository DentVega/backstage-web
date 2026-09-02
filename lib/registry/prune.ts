import type { MiniappRecord } from "./types";
import type { SemVer } from "@dentvega/miniapp-contract";
import type { ChunkStorage } from "@/lib/storage/types";

/**
 * Borra del storage el chunk de cada versión a prunear (best-effort — un borrado que falla
 * no rompe nada). Cálculo de `toPrune` con `versionsToPrune` (puro) por afuera; los borrados
 * de storage (I/O) van acá, FUERA del CAS del registry.
 */
export async function pruneChunks(
  storage: ChunkStorage,
  id: string,
  toPrune: readonly SemVer[],
): Promise<void> {
  for (const v of toPrune) {
    try {
      await storage.deletePrefix(`${id}/${v}`);
    } catch {
      // best-effort: si el chunk no se pudo borrar, igual limpiamos el registry.
    }
  }
}

/** Saca del record las versiones prunadas (puro). La servida nunca entra a `versionsToPrune`. */
export function removePrunedVersions(rec: MiniappRecord, toPrune: readonly SemVer[]): MiniappRecord {
  const gone = new Set<string>(toPrune.map(String));
  return { ...rec, versions: rec.versions.filter((pv) => !gone.has(pv.version)) };
}
