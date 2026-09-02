/** Migración del registry: del blob único `registry` a keys por-miniapp + índice. */
import type { KvClient } from "./kv";
import type { MiniappRecord } from "./types";

export const APP_PREFIX = "registry:app:";
export const INDEX_KEY = "registry:index";
export const LEGACY_KEY = "registry";

export const appKey = (id: string): string => `${APP_PREFIX}${id}`;

/**
 * Migra el blob único `registry` a `registry:app:<id>` + el set `registry:index`.
 * Idempotente: no-op si no hay blob; usa casSet(null) para no pisar si ya migró
 * concurrentemente; borra el blob solo si sigue igual (casDel con expected).
 */
export async function migrateBlobToPerApp(kv: KvClient): Promise<{ migrated: number }> {
  const raw = await kv.get(LEGACY_KEY);
  if (raw === null) return { migrated: 0 };
  const reg = JSON.parse(raw) as Record<string, MiniappRecord>;
  const ids = Object.keys(reg);
  for (const id of ids) {
    await kv.casSet(appKey(id), null, JSON.stringify(reg[id]));
    await kv.sadd(INDEX_KEY, id);
  }
  await kv.casDel(LEGACY_KEY, raw);
  return { migrated: ids.length };
}
