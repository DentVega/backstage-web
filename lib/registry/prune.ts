import type { Registry } from "./types";
import type { SemVer } from "@dentvega/miniapp-contract";
import type { ChunkStorage } from "@/lib/storage/types";
import { versionsToPrune } from "./registry";

/**
 * Prunea una miniapp: borra del storage el chunk de cada versión fuera de la ventana
 * (best-effort — un borrado que falla no rompe nada) y las saca del registry. La
 * versión servida/pinneada nunca entra a `versionsToPrune`. Devuelve el reg nuevo.
 */
export async function pruneMiniapp(
  reg: Registry,
  storage: ChunkStorage,
  id: string,
  keepN: number,
): Promise<{ reg: Registry; pruned: SemVer[] }> {
  const record = reg[id];
  if (record === undefined) return { reg, pruned: [] };

  const toPrune = versionsToPrune(record, keepN);
  for (const v of toPrune) {
    try {
      await storage.deletePrefix(`${id}/${v}`);
    } catch {
      // best-effort: si el chunk no se pudo borrar, igual limpiamos el registry.
    }
  }
  if (toPrune.length === 0) return { reg, pruned: [] };

  const gone = new Set<string>(toPrune);
  const kept = record.versions.filter((pv) => !gone.has(pv.version));
  return { reg: { ...reg, [id]: { ...record, versions: kept } }, pruned: toPrune };
}
