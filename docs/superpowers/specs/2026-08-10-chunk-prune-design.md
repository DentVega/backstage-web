# Prune de chunks viejos (#11) — Design

**Fecha:** 2026-08-10
**Estado:** Aprobado (listo para plan)
**Repo:** `backstage-web`
**Owner:** <owner>
**Roadmap:** #11.

---

## Goal

No acumular chunks para siempre en el storage. Al publicar, prunear las versiones fuera de una ventana (mantener las **últimas 5** + **siempre la servida/pinneada**), borrando su chunk del storage y su entrada del registry. **Automático al publicar**, best-effort (nunca rompe el publish).

## Background

- Cada publish sube un chunk a `storage.putMany(`${id}/${version}`, files)` → prefijo `{id}/{version}/`. El registry guarda `PublishedVersion.url`.
- El `ChunkStorage` es **write-only** (`putMany`) — no hay borrado.
- 4 adapters: `r2` (activo, S3 SigV4), `blob` (`@vercel/blob`), `fs` (dev), `mock` (tests).
- **Pin/rollback (#10):** la versión servida (`pinnedVersion ?? latest`) **jamás** debe prunearse (su chunk se sigue montando).

## Approach

`ChunkStorage` += `deletePrefix`. Lógica pura `versionsToPrune` (qué borrar) + `pruneMiniapp` (borra chunks best-effort + saca del registry). Disparo en la upload route tras el publish, best-effort. Retención `PRUNE_KEEP` (default 5).

## Diseño detallado

### 1. `lib/storage/types.ts` — `ChunkStorage` += `deletePrefix`
```ts
/** Borra todos los objetos bajo `prefix/`. Best-effort (para prune). */
deletePrefix(prefix: string): Promise<void>;
```

### 2. Adapters

**r2.ts** — extender `SignedFetch` para GET/DELETE sin body + leer la respuesta:
```ts
export type SignedFetch = (
  url: string,
  init: { method: string; body?: Uint8Array; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;
```
`deletePrefix`: `ListObjectsV2` (`GET ?list-type=2&prefix={prefix}/`) → parsear keys (`/<Key>([^<]+)<\/Key>/g`) → `DELETE` cada una. Best-effort (si el list no da ok, return). El `defaultSignedFetch` (aws.fetch) ya devuelve un Response con `.text()/.ok/.status`.

**blob.ts** — `import { list, del } from "@vercel/blob"`:
```ts
async deletePrefix(prefix) {
  const { blobs } = await list({ prefix: `${prefix}/`, token });
  if (blobs.length > 0) await del(blobs.map((b) => b.url), { token });
}
```

**fs.ts**: `await fs.rm(path.join(process.cwd(), "public", "chunks", prefix), { recursive: true, force: true });`

**mock.ts**: `mockStorage(uploads?, deletes?: string[])` → `deletePrefix` pushea el prefix a `deletes` (para asertar en tests). Backward-compat (param opcional).

### 3. `lib/registry/registry.ts` — `versionsToPrune` (pura)
```ts
/** Versiones a borrar: fuera de {últimas keepN} ∪ {servida = pinnedVersion ?? latest}. */
export function versionsToPrune(record: MiniappRecord, keepN: number): SemVer[] {
  const sorted = [...record.versions].sort((a, b) => compareSemVer(b.version, a.version)); // desc
  const served = record.pinnedVersion ?? sorted[0]?.version;
  const keep = new Set<string>(sorted.slice(0, keepN).map((v) => v.version));
  if (served) keep.add(served);
  return sorted.filter((v) => !keep.has(v.version)).map((v) => v.version);
}
```

### 4. `lib/registry/prune.ts` (nuevo) — `pruneMiniapp` (orquesta)
```ts
export async function pruneMiniapp(
  reg: Registry, storage: ChunkStorage, id: string, keepN: number,
): Promise<{ reg: Registry; pruned: SemVer[] }> {
  const record = reg[id];
  if (record === undefined) return { reg, pruned: [] };
  const toPrune = versionsToPrune(record, keepN);
  for (const v of toPrune) {
    try { await storage.deletePrefix(`${id}/${v}`); } catch { /* best-effort */ }
  }
  if (toPrune.length === 0) return { reg, pruned: [] };
  const gone = new Set<string>(toPrune);
  const kept = record.versions.filter((pv) => !gone.has(pv.version));
  return { reg: { ...reg, [id]: { ...record, versions: kept } }, pruned: toPrune };
}
```

### 5. `lib/config.ts` — `pruneKeep()`
```ts
export function pruneKeep(): number {
  const n = Number(process.env.PRUNE_KEEP);
  return Number.isFinite(n) && n > 0 ? n : 5;
}
```

### 6. Disparo — `app/api/miniapps/[id]/upload/route.ts`
Tras `publishVersion` + `save`, best-effort:
```ts
try {
  const { reg: prunedReg, pruned } = await pruneMiniapp(savedReg, storage, id, pruneKeep());
  if (pruned.length > 0) await getStore().save(prunedReg);
} catch { /* best-effort: el publish ya se guardó */ }
```
(`storage` es el adapter ya resuelto para esta miniapp en la route; `savedReg` = el reg con la versión nueva.)

## Verificación

- **`versionsToPrune`:** con 7 versiones y keepN=5 → prunea las 2 más viejas; **una versión pinneada vieja se MANTIENE** aunque quede fuera de la ventana; ≤ keepN → prunea nada.
- **`pruneMiniapp`:** borra los prefijos correctos (mock `deletes`), saca las versiones del reg, deja las keep; error del storage → best-effort (igual saca del reg / no rompe); nada que prunear → no-op.
- **`deletePrefix` r2:** fake SignedFetch devuelve XML con 2 keys → hace 1 GET (list) + 2 DELETE; list no-ok → no borra.
- **`deletePrefix` fs:** crea archivos en un tmpdir, deletePrefix los borra.
- **upload route:** publicar la 6ª versión → prune deja 5 + borra la 1ª (mock storage lo registra). Ajustar los tests existentes de la route/r2 al nuevo `SignedFetch`.

## Qué NO cambia

- El resolve/pin/cache. La versión servida nunca se prunea.
- `putMany` — igual.

## Fuera de alcance

- Botón manual de prune (elegimos automático).
- Prunear la flota retroactivamente de una (lo acumulado se va limpiando a medida que cada miniapp publica; se puede sumar un endpoint admin después).
- Borrar por-archivo selectivo (borramos el prefijo entero de la versión).

## Archivos afectados

- **backstage-web:** `lib/storage/types.ts` (+deletePrefix), `lib/storage/{r2,blob,fs,mock}.ts` (impl), `lib/registry/registry.ts` (+versionsToPrune), `lib/registry/prune.ts` (nuevo), `lib/config.ts` (+pruneKeep), `app/api/miniapps/[id]/upload/route.ts` (disparo) + tests. Push directo a main. **Nuevo env opcional `PRUNE_KEEP`** (default 5).
