# Registry por-miniapp keys + CAS (fix del lost-update)

**Fecha:** 2026-09-02
**Estado:** Diseño aprobado — listo para plan
**Motivación:** bug de concurrencia (lost update) en el registry; ver `platform-roadmap` y
`docs/SETUP.md` §7.6. Reproducido: cards_wallet perdió su chunk iOS por 3 publishes encimados.

## Problema

El registry (fuente de verdad: miniapps, versiones, pins, maintainers, pubkeys…) se guarda como
**un solo blob JSON** bajo la key KV `registry`. Cada mutación hace `load(blob) → modifica →
save(blob)` sin control de concurrencia. Dos operaciones concurrentes leen el mismo blob, cada una
guarda su copia, y **la última pisa a la otra** (lost update silencioso, pérdida de datos).

**Objetivo real:** la plataforma apunta a **muchos equipos publicando miniapps distintas en
paralelo**. Con un blob único, todo write compite por la misma key → contención + retry storms +
blast radius global (un write malo daña todo). El fix debe **aislar por miniapp**.

## Diseño: una key KV por miniapp + índice + CAS optimista

- **Key por miniapp:** `registry:app:<id>` → JSON de un `MiniappRecord`.
- **Índice:** `registry:index` → JSON array de ids. Se toca **solo** al crear/borrar una miniapp.
- **CAS por-key:** las escrituras usan compare-and-set sobre la key de esa miniapp (Lua en
  Upstash). Equipos en miniapps **distintas nunca chocan** (keys distintas). Dos writes a la
  **misma** miniapp: el CAS detecta el choque y **reintenta** (recarga + re-aplica).

Esto elimina el lost-update **y** la contención entre miniapps, y contiene el blast radius por
miniapp.

## Restricciones del entorno (confirmadas contra el código)

- `@upstash/redis` 1.38.0 (REST, stateless): **soporta `eval` (Lua) y `SET NX`**; **NO soporta
  `WATCH`**. → el CAS se hace por **Lua `eval`** (compare-and-set atómico), no por WATCH/MULTI.
- `KvClient` (`lib/registry/kv.ts`) hoy expone solo `get`/`set`/`incr`. Hay **3 copias** del
  cliente in-memory a mantener sincronizadas (`kv.ts`, el inline de `kv.test.ts`, y el que reusa
  el trust store).
- Los 9 mutadores del dominio (`lib/registry/registry.ts`) son **puros y sincrónicos**; ya
  reciben un `id` e indexan `reg[id]`. `pruneMiniapp` (`lib/registry/prune.ts`) es la excepción
  (async, con I/O de storage).

## Nuevo primitivo: `casSet`

En `KvClient`:

```ts
/** Compare-and-set: setea `value` SOLO si el valor actual de `key` sigue siendo `expected`
 *  (o si `expected` es null y la key no existe). Devuelve true si commiteó, false si cambió. */
casSet(key: string, expected: string | null, value: string): Promise<boolean>;
```

- **Upstash:** script Lua (atómico en Redis):
  ```lua
  -- KEYS[1]=key, ARGV[1]=expected ("" sentinela para null), ARGV[2]=value, ARGV[3]=hasExpected("0"|"1")
  local cur = redis.call('GET', KEYS[1])
  if (ARGV[3] == '0' and cur == false) or (ARGV[3] == '1' and cur == ARGV[1]) then
    redis.call('SET', KEYS[1], ARGV[2]); return 1
  else return 0 end
  ```
  (Se maneja null-vs-string para distinguir "no existe" de "existe con valor X".)
- **inMemory:** compare-and-set directo sobre el Map.
- **Borrado** (record → null): un `casDel(key, expected)` análogo, o `casSet` a un tombstone; el
  plan elige — para el registry, borrar = quitar la key + sacar del índice.

## Capa de store — `RegistryStore` v2

`lib/registry/store.ts` + `kv.ts`. La interfaz gana métodos por-app y mantiene un `getAll()`
compatible para los reads que hoy esperan un `Registry` entero:

```ts
export interface RegistryStore {
  /** Un record por id (lee `registry:app:<id>`). */
  getApp(id: string): Promise<MiniappRecord | undefined>;
  /** Todo el registry (índice + MGET) — misma forma `Registry` de siempre. */
  getAll(): Promise<Registry>;
  /**
   * Muta UNA miniapp con CAS+retry. `fn` recibe el record actual (o undefined si no existe) y
   * devuelve el nuevo (o null para borrar). Mantiene `registry:index` al crear/borrar.
   * Reintenta ante conflicto (N veces, backoff); tira ConflictError si se agota.
   */
  mutateApp(id: string, fn: (record: MiniappRecord | undefined) => MiniappRecord | null): Promise<MiniappRecord | null>;
  // load()/save() legacy quedan deprecados/removidos una vez migrados todos los call-sites.
}
```

- `jsonStore` (fs, dev) y el in-memory implementan la misma interfaz (sin concurrencia real, pero
  consistentes).
- **Retry:** `mutateApp` hace `expected = getRaw(key); rec = parse; next = fn(rec); ok =
  casSet(key, expected, stringify(next))`; si `!ok`, recarga y reintenta (default 5, backoff ~50ms).

## Refactor del dominio (writes → por-record)

Los 9 mutadores pasan de `(reg: Registry, rawId, ...) => Registry` a operar sobre **un record**:

```ts
// antes: publishVersion(reg, rawId, input, now): Registry
// después: publishVersionRecord(record: MiniappRecord | undefined, rawId, input, now): MiniappRecord
```

Aplica a: `registerMiniapp` (record undefined → nuevo), `removeMiniapp` (→ null via mutateApp),
`updateMiniappMeta`, `setMiniappStorageProvider`, `setMiniappPin`, `setMaintainers`,
`setMiniappPublicKey`, `removeVersion`, `publishVersion`. Conservan sus validaciones/errores
(`MiniappNotFoundError` cuando el record es undefined y la op requiere existente, etc.).

> Para no romper todo de golpe: los mutadores viejos `(reg)=>reg` pueden quedar como wrappers
> finos sobre los por-record durante la transición, o migrarse de una. El plan lo define.

## Reads

- `resolveMiniapp` y `getMiniappDetail`: pasan a tomar **un record** (`getApp(id)`) → leen 1 key,
  más rápido. (Hot-path del host: `resolve`.)
- `listCatalog` y las páginas (catálogo, estado): usan `getAll()` (índice + MGET) → sin cambios
  en la función, solo el call-site le pasa el `Registry` que arma el store.

## Call-sites (12 mutantes) — conversión

- **9 limpios** → `store.mutateApp(id, rec => fn(rec, ...))`.
- **upload** (`publishVersion` + `pruneMiniapp`): `storage.put` (I/O) afuera → `mutateApp(id,
  publishVersion)`; el prune calcula `versionsToPrune` del record fresco, borra chunks en storage
  (I/O, best-effort) afuera, y hace un `mutateApp(id, removeThoseVersions)`.
- **scaffold**: crea el repo (I/O) afuera → `mutateApp(id, () => registerRecord(...))`.
- **seed** (`seedRegistry`): reescribe para usar `mutateApp` por cada entrada semilla (idempotente:
  el fn no pisa un record existente).

## Migración

`registry` (blob viejo) → keys por-id + índice. **Lazy + script:**
- **Lazy:** al primer `getAll()`/`getApp`, si existe la key `registry` y no existe `registry:index`,
  migrar: por cada id del blob, `SET registry:app:<id>`, poblar `registry:index`, y marcar migrado
  (borrar `registry` o setear un flag `registry:migrated`). Idempotente y una sola vez.
- **Script explícito:** `scripts/migrate-registry-per-app.mjs` para correrlo a mano contra prod
  antes/independiente del deploy.

## Otros stores (single-document → solo CAS, sin split)

trust-bundle (`lib/trust/store.ts`), host-contract, storage-preference **no son colecciones** —
son un documento único. No se parten por-id; solo se les agrega **CAS** (reusan `casSet`) con un
`mutate(fn)` simple para no pisarse (last-write-wins → CAS+retry). Menor riesgo; entran por
completitud.

## Errores

- CAS agotado (N reintentos) → `ConflictError` tipado (`lib/registry/types.ts`) → `statusForError`
  lo mapea a **409**. Las rutas ya usan `errorBody`/`statusForError`.
- (Opcional) `publish.mjs` del template reintenta 1 vez ante 409 — robustez del CI.

## Testing

- **`casSet`**: setea si coincide `expected`; rechaza si cambió; maneja null (no-existe).
- **Regresión (el test que prueba el fix):**
  - Dos `mutateApp` a **miniapps distintas** → ambos commitean, cero conflicto.
  - Dos `mutateApp` a la **misma** miniapp con un KvClient que inyecta un write entre load y
    casSet → el segundo **reintenta y ninguno se pierde** (vs el bug actual donde se perdía).
- **Migración**: blob viejo → per-app + índice; idempotente; getAll equivalente pre/post.
- **Dominio por-record**: portar los tests existentes (`registry.test.ts`, `pin.test.ts`,
  `prune.test.ts`, `maintainers.test.ts`, `public-key.test.ts`, `storage-provider.test.ts`,
  `update-meta.test.ts`) al modelo por-record.
- **Mocks de rutas**: los tests de rutas mockean `getStore()` como `{load, save}`. Se actualizan a
  `{getApp, getAll, mutateApp}` (o un mock helper que implemente `mutateApp` sobre un Map).

## Fases (para el plan)

1. **Primitivo + store v2 + migración** (sin cambiar call-sites): `casSet`, `getApp/getAll/mutateApp`,
   migración lazy + script. Todo verde con `getAll()` alimentando los reads/mutadores viejos.
2. **Dominio por-record + convertir los writes** a `mutateApp` (los 9 + los 3 con I/O). Acá se gana
   el aislamiento.
3. **Optimizar reads** (`resolve`/`detail` → `getApp`) + **otros stores** (CAS) + **409** + docs.

## Fuera de alcance

- Redis Set nativo para el índice (uso JSON array; simple y el volumen es bajo — se puede migrar a
  SADD/SMEMBERS luego si el índice crece).
- Locks/leases (no hacen falta con CAS).
- Sharding/particionado más allá de por-miniapp.
