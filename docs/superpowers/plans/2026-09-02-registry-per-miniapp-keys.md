# Registry por-miniapp keys + CAS — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar el lost-update del registry guardando **una key KV por miniapp** (+ un índice como Redis set) y escribiendo con **compare-and-set** (Lua), de modo que equipos en miniapps distintas nunca choquen y writes a la misma miniapp reintenten sin perder datos.

**Architecture:** `KvClient` gana primitivos atómicos (`casSet`, `casDel`, `sadd`/`srem`/`smembers`, `mget`). El store expone `getApp(id)` / `getAll()` / `mutateApp(id, fn)` sobre keys `registry:app:<id>` + índice `registry:index`. Los mutadores del dominio pasan a operar por-record. Migración lazy del blob viejo + script. Los stores single-document (trust-bundle, host-contract, storage-preference) reusan `casSet`.

**Tech Stack:** TypeScript, `@upstash/redis` 1.38 (`eval` Lua, sets), Vitest.

## Global Constraints

- **Repo:** `/Volumes/SSDExterno/prodproyects/backstage-web`. Comandos: `pnpm test`, `pnpm typecheck`, `pnpm build`.
- **Sin `WATCH`** (Upstash REST) → CAS por **Lua `eval`**. En Redis Lua, `GET` de una key inexistente devuelve `false`.
- **3 copias del cliente in-memory** a mantener sincronizadas: `lib/registry/kv.ts` (`inMemoryKvClient`), el inline `inMemoryKv()` en `lib/registry/__tests__/kv.test.ts`, y cualquier mock de test que implemente `KvClient`.
- **Keys:** `registry:app:<id>` (un `MiniappRecord` JSON por miniapp), `registry:index` (Redis set de ids). Legacy: `registry` (blob) → migrar.
- **Mutadores del dominio** son puros `(...) => MiniappRecord`. `pruneMiniapp` es async con I/O (excepción).
- **Aditivo/green:** cada task deja `pnpm test` + `pnpm typecheck` en verde.

## File Structure

- `lib/registry/kv.ts` (modificar) — `KvClient` += `casSet/casDel/sadd/srem/smembers/mget`; impls Upstash (Lua) + inMemory.
- `lib/registry/store.ts` (modificar) — `RegistryStore` v2 (`getApp/getAll/mutateApp`), keys por-app + índice + migración; `jsonStore` (fs) adaptado.
- `lib/registry/migrate.ts` (nuevo) — migración blob→per-app (pura sobre KvClient), usada lazy y por el script.
- `lib/registry/registry.ts` (modificar) — mutadores por-record.
- `lib/registry/prune.ts` (modificar) — `pruneMiniapp` split I/O vs mutación.
- `lib/registry/types.ts` (modificar) — `ConflictError`.
- `lib/http.ts` (modificar) — `ConflictError` → 409.
- `app/api/**` (modificar) — 12 call-sites → `mutateApp`.
- `lib/trust/store.ts`, host-contract store, storage-preference store (modificar) — CAS.
- `scripts/migrate-registry-per-app.mjs` (nuevo) — migración explícita.
- Tests: `lib/registry/__tests__/{kv,store,migrate,concurrency}.test.ts` + portar los existentes.

---

## FASE 1 — Primitivos atómicos + store v2 + migración

### Task 1: `KvClient` primitivos atómicos (`casSet`, `casDel`, sets, `mget`)

**Files:**
- Modify: `lib/registry/kv.ts` (interface + `upstashClient` + `inMemoryKvClient`)
- Test: `lib/registry/__tests__/kv.test.ts` (extender el `inMemoryKv` inline + casos)

**Interfaces:**
- Produces (en `KvClient`):
  - `casSet(key, expected: string | null, value: string): Promise<boolean>` — set si `GET(key)===expected` (o si `expected===null` y no existe).
  - `casDel(key, expected: string | null): Promise<boolean>` — del si coincide.
  - `sadd(key, member): Promise<void>`, `srem(key, member): Promise<void>`, `smembers(key): Promise<string[]>`.
  - `mget(keys: string[]): Promise<(string | null)[]>`.

- [ ] **Step 1: Write failing tests** — agregar a `kv.test.ts`. Primero, el `inMemoryKv()` inline del archivo debe ganar los métodos nuevos (si el test usa el inline, extenderlo; preferible: importar `inMemoryKvClient` de `../kv` y testear ESE). Usar `inMemoryKvClient`:

```ts
import { inMemoryKvClient } from "../kv";

describe("KvClient — casSet / casDel", () => {
  it("casSet setea cuando expected coincide", async () => {
    const kv = inMemoryKvClient();
    await kv.set("k", "v1");
    expect(await kv.casSet("k", "v1", "v2")).toBe(true);
    expect(await kv.get("k")).toBe("v2");
  });
  it("casSet rechaza cuando el valor cambió", async () => {
    const kv = inMemoryKvClient();
    await kv.set("k", "v1");
    expect(await kv.casSet("k", "OTRO", "v2")).toBe(false);
    expect(await kv.get("k")).toBe("v1");
  });
  it("casSet con expected=null crea si no existe / rechaza si existe", async () => {
    const kv = inMemoryKvClient();
    expect(await kv.casSet("k", null, "v1")).toBe(true);
    expect(await kv.casSet("k", null, "v2")).toBe(false);
    expect(await kv.get("k")).toBe("v1");
  });
  it("casDel borra si coincide", async () => {
    const kv = inMemoryKvClient();
    await kv.set("k", "v1");
    expect(await kv.casDel("k", "v1")).toBe(true);
    expect(await kv.get("k")).toBeNull();
  });
});

describe("KvClient — sets + mget", () => {
  it("sadd/srem/smembers", async () => {
    const kv = inMemoryKvClient();
    await kv.sadd("s", "a"); await kv.sadd("s", "b"); await kv.sadd("s", "a");
    expect((await kv.smembers("s")).sort()).toEqual(["a", "b"]);
    await kv.srem("s", "a");
    expect(await kv.smembers("s")).toEqual(["b"]);
  });
  it("mget devuelve valores/nulls en orden", async () => {
    const kv = inMemoryKvClient();
    await kv.set("a", "1"); await kv.set("c", "3");
    expect(await kv.mget(["a", "b", "c"])).toEqual(["1", null, "3"]);
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `pnpm test lib/registry/__tests__/kv.test.ts`
Expected: FAIL (métodos inexistentes).

- [ ] **Step 3: Implement in `lib/registry/kv.ts`**

Extender la interface `KvClient`:
```ts
export interface KvClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  incr(key: string): Promise<number>;
  /** Compare-and-set: setea SOLO si GET(key)===expected (o expected===null y no existe). */
  casSet(key: string, expected: string | null, value: string): Promise<boolean>;
  /** Compare-and-del: borra SOLO si coincide. */
  casDel(key: string, expected: string | null): Promise<boolean>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  mget(keys: string[]): Promise<(string | null)[]>;
}
```

En `upstashClient()` (Lua para CAS; el resto nativo):
```ts
const CAS_SET = `local cur = redis.call('GET', KEYS[1])
if ARGV[3] == '0' then
  if cur == false then redis.call('SET', KEYS[1], ARGV[2]); return 1 end
else
  if cur == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2]); return 1 end
end
return 0`;
const CAS_DEL = `local cur = redis.call('GET', KEYS[1])
if ARGV[2] == '1' and cur == ARGV[1] then redis.call('DEL', KEYS[1]); return 1 end
return 0`;
// ...dentro del objeto devuelto:
    async casSet(key, expected, value) {
      const r = await redis.eval(CAS_SET, [key], [expected ?? "", value, expected === null ? "0" : "1"]);
      return r === 1;
    },
    async casDel(key, expected) {
      if (expected === null) return true; // borrar algo inexistente = no-op ok
      const r = await redis.eval(CAS_DEL, [key], [expected, "1"]);
      return r === 1;
    },
    async sadd(key, member) { await redis.sadd(key, member); },
    async srem(key, member) { await redis.srem(key, member); },
    async smembers(key) { return (await redis.smembers<string[]>(key)) ?? []; },
    async mget(keys) { return keys.length ? await redis.mget<(string | null)[]>(...keys) : []; },
```

En `inMemoryKvClient()` (sobre el `Map` + un `Map<string, Set<string>>` para sets):
```ts
export function inMemoryKvClient(): KvClient {
  const map = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  return {
    async get(key) { return map.get(key) ?? null; },
    async set(key, value) { map.set(key, value); },
    async incr(key) { const n = Number(map.get(key) ?? 0) + 1; map.set(key, String(n)); return n; },
    async casSet(key, expected, value) {
      const cur = map.has(key) ? map.get(key)! : null;
      if (cur === expected) { map.set(key, value); return true; }
      return false;
    },
    async casDel(key, expected) {
      const cur = map.has(key) ? map.get(key)! : null;
      if (expected === null) return true;
      if (cur === expected) { map.delete(key); return true; }
      return false;
    },
    async sadd(key, member) { (sets.get(key) ?? sets.set(key, new Set()).get(key)!).add(member); },
    async srem(key, member) { sets.get(key)?.delete(member); },
    async smembers(key) { return [...(sets.get(key) ?? [])]; },
    async mget(keys) { return keys.map((k) => map.get(k) ?? null); },
  };
}
```

- [ ] **Step 4: Run — should pass**

Run: `pnpm test lib/registry/__tests__/kv.test.ts`
Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add lib/registry/kv.ts lib/registry/__tests__/kv.test.ts
git commit -m "feat(kv): primitivos atómicos casSet/casDel/sadd/srem/smembers/mget (Lua + inMemory)"
```

### Task 2: Migración blob → per-app (`lib/registry/migrate.ts`)

**Files:**
- Create: `lib/registry/migrate.ts`
- Test: `lib/registry/__tests__/migrate.test.ts`

**Interfaces:**
- Consumes: `KvClient` (Task 1).
- Produces: `migrateBlobToPerApp(kv: KvClient): Promise<{ migrated: number }>` — si existe la key `registry` (blob) y el índice está vacío, escribe `registry:app:<id>` por cada miniapp + `sadd registry:index` + borra el blob. Idempotente.
- Keys constants exportadas: `APP_PREFIX = "registry:app:"`, `INDEX_KEY = "registry:index"`, `LEGACY_KEY = "registry"`.

- [ ] **Step 1: Failing test** — `migrate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { inMemoryKvClient } from "../kv";
import { migrateBlobToPerApp, APP_PREFIX, INDEX_KEY, LEGACY_KEY } from "../migrate";

const blob = JSON.stringify({
  a: { id: "a", name: "A", owner: "o", versions: [] },
  b: { id: "b", name: "B", owner: "o", versions: [] },
});

describe("migrateBlobToPerApp", () => {
  it("divide el blob en keys por-app + índice y borra el blob", async () => {
    const kv = inMemoryKvClient();
    await kv.set(LEGACY_KEY, blob);
    const res = await migrateBlobToPerApp(kv);
    expect(res.migrated).toBe(2);
    expect(JSON.parse((await kv.get(`${APP_PREFIX}a`))!).id).toBe("a");
    expect((await kv.smembers(INDEX_KEY)).sort()).toEqual(["a", "b"]);
    expect(await kv.get(LEGACY_KEY)).toBeNull();
  });
  it("es idempotente (segunda corrida no hace nada)", async () => {
    const kv = inMemoryKvClient();
    await kv.set(LEGACY_KEY, blob);
    await migrateBlobToPerApp(kv);
    const res2 = await migrateBlobToPerApp(kv);
    expect(res2.migrated).toBe(0);
  });
  it("no hace nada si no hay blob", async () => {
    const kv = inMemoryKvClient();
    expect((await migrateBlobToPerApp(kv)).migrated).toBe(0);
  });
});
```

- [ ] **Step 2: Run — fail.** `pnpm test lib/registry/__tests__/migrate.test.ts` → FAIL.

- [ ] **Step 3: Implement `lib/registry/migrate.ts`**

```ts
import type { KvClient } from "./kv";
import type { MiniappRecord } from "./types";

export const APP_PREFIX = "registry:app:";
export const INDEX_KEY = "registry:index";
export const LEGACY_KEY = "registry";

export const appKey = (id: string): string => `${APP_PREFIX}${id}`;

/** Migra el blob único `registry` a keys por-app + índice. Idempotente (no-op sin blob). */
export async function migrateBlobToPerApp(kv: KvClient): Promise<{ migrated: number }> {
  const raw = await kv.get(LEGACY_KEY);
  if (raw === null) return { migrated: 0 };
  const reg = JSON.parse(raw) as Record<string, MiniappRecord>;
  const ids = Object.keys(reg);
  for (const id of ids) {
    // casSet(null) → no pisa si ya migró concurrentemente; idempotente.
    await kv.casSet(appKey(id), null, JSON.stringify(reg[id]));
    await kv.sadd(INDEX_KEY, id);
  }
  await kv.casDel(LEGACY_KEY, raw); // borra el blob solo si sigue igual
  return { migrated: ids.length };
}
```

- [ ] **Step 4: Run — pass.** Commit:
```bash
pnpm typecheck
git add lib/registry/migrate.ts lib/registry/__tests__/migrate.test.ts
git commit -m "feat(registry): migración blob→per-app (idempotente)"
```

### Task 3: `ConflictError` + mapeo a 409

**Files:**
- Modify: `lib/registry/types.ts` (nueva clase de error)
- Modify: `lib/http.ts` (`statusForError`)
- Test: existing `lib/__tests__/*` o un pequeño test inline en un test de store (Task 4)

- [ ] **Step 1: Add the error** — en `lib/registry/types.ts`, junto a los otros errores (`MiniappNotFoundError`, etc.):

```ts
export class ConflictError extends Error {
  readonly code = "CONFLICT";
  constructor(id: string) {
    super(`concurrent update conflict for "${id}" — retry`);
    this.name = "ConflictError";
  }
}
```

- [ ] **Step 2: Map to 409** — en `lib/http.ts`, importar `ConflictError` y agregar en `statusForError` (antes del `return 500`):

```ts
  if (err instanceof ConflictError) return 409;
```
(Sumar `ConflictError` al `import { ... } from "./registry/types"`.)

- [ ] **Step 3: Typecheck + commit**
```bash
pnpm typecheck
git add lib/registry/types.ts lib/http.ts
git commit -m "feat(registry): ConflictError → 409"
```

### Task 4: Store v2 — `getApp` / `getAll` / `mutateApp` + migración lazy

**Files:**
- Modify: `lib/registry/store.ts`
- Test: `lib/registry/__tests__/store.test.ts` (nuevo)
- Test: `lib/registry/__tests__/concurrency.test.ts` (nuevo — el test de regresión)

**Interfaces:**
- Consumes: `KvClient` (Task 1), `migrate` helpers (Task 2), `ConflictError` (Task 3).
- Produces: `RegistryStore` con:
  - `getApp(id): Promise<MiniappRecord | undefined>`
  - `getAll(): Promise<Registry>` (índice + mget; corre migración lazy primero)
  - `mutateApp(id, fn: (rec: MiniappRecord | undefined) => MiniappRecord | null): Promise<MiniappRecord | null>` (CAS + retry; mantiene índice)
  - Se conservan `load()`/`save()` como **shims** deprecados (`load = getAll`; `save` diffea y escribe per-app) hasta convertir todos los call-sites (Fase 2). Se remueven en la última task de Fase 2.

- [ ] **Step 1: Failing tests** — `store.test.ts` (comportamiento básico) + `concurrency.test.ts` (regresión). `concurrency.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { inMemoryKvClient, type KvClient } from "../kv";
import { kvStore } from "../store";
import type { MiniappRecord } from "../types";

const rec = (id: string, versions: unknown[] = []): MiniappRecord =>
  ({ id, name: id, owner: "o", versions } as unknown as MiniappRecord);

describe("mutateApp — concurrencia", () => {
  it("dos writes a miniapps DISTINTAS: ambos sobreviven", async () => {
    const kv = inMemoryKvClient();
    const s = kvStore(kv);
    await s.mutateApp("a", () => rec("a"));
    await s.mutateApp("b", () => rec("b"));
    const all = await s.getAll();
    expect(Object.keys(all).sort()).toEqual(["a", "b"]);
  });

  it("dos writes a la MISMA miniapp con interleave: reintenta, no se pierde", async () => {
    // KvClient que, la primera vez que se llama casSet para la key de "a", primero inyecta
    // OTRO write (simula un publish concurrente) y hace fallar el CAS → fuerza el retry.
    const base = inMemoryKvClient();
    let injected = false;
    const kv: KvClient = {
      ...base,
      async casSet(key, expected, value) {
        if (!injected && key.endsWith("a")) {
          injected = true;
          await base.set(key, JSON.stringify(rec("a", [{ version: "9.9.9" }]))); // otro escribió
        }
        return base.casSet(key, expected, value);
      },
    };
    const s = kvStore(kv);
    await base.set("registry:app:a", JSON.stringify(rec("a", [])));
    await base.sadd("registry:index", "a");
    // fn agrega una versión "1.0.0"; el interleave metió "9.9.9". Tras el retry, deben estar LAS DOS.
    await s.mutateApp("a", (r) => ({ ...(r as MiniappRecord), versions: [...(r?.versions ?? []), { version: "1.0.0" } as never] }));
    const got = await s.getApp("a");
    const vs = (got!.versions as { version: string }[]).map((v) => v.version).sort();
    expect(vs).toEqual(["1.0.0", "9.9.9"]); // ← con el bug viejo, "9.9.9" se perdía
  });
});
```

- [ ] **Step 2: Run — fail.** `pnpm test lib/registry/__tests__/concurrency.test.ts` → FAIL.

- [ ] **Step 3: Implement store v2** — reescribir `kvStore` en `lib/registry/store.ts`:

```ts
import type { MiniappRecord, Registry } from "./types";
import { ConflictError } from "./types";
import { kvStore as _legacyUnused } from "./kv"; // (no; ver abajo)
import { type KvClient, upstashClient } from "./kv";
import { migrateBlobToPerApp, appKey, INDEX_KEY } from "./migrate";

const MAX_RETRIES = 5;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface RegistryStore {
  getApp(id: string): Promise<MiniappRecord | undefined>;
  getAll(): Promise<Registry>;
  mutateApp(
    id: string,
    fn: (rec: MiniappRecord | undefined) => MiniappRecord | null,
  ): Promise<MiniappRecord | null>;
  // shims legacy (removidos al terminar Fase 2):
  load(): Promise<Registry>;
  save(reg: Registry): Promise<void>;
}

export function kvStore(client: KvClient): RegistryStore {
  const store: RegistryStore = {
    async getApp(id) {
      const raw = await client.get(appKey(id));
      return raw ? (JSON.parse(raw) as MiniappRecord) : undefined;
    },
    async getAll() {
      await migrateBlobToPerApp(client); // lazy, idempotente
      const ids = await client.smembers(INDEX_KEY);
      if (ids.length === 0) return {};
      const raws = await client.mget(ids.map(appKey));
      const reg: Record<string, MiniappRecord> = {};
      ids.forEach((id, i) => {
        const raw = raws[i];
        if (raw) reg[id] = JSON.parse(raw) as MiniappRecord; // orphan índice → skip
      });
      return reg;
    },
    async mutateApp(id, fn) {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const raw = await client.get(appKey(id));
        const rec = raw ? (JSON.parse(raw) as MiniappRecord) : undefined;
        const next = fn(rec);
        if (next === null) {
          if (rec === undefined) return null;
          if (await client.casDel(appKey(id), raw)) {
            await client.srem(INDEX_KEY, id);
            return null;
          }
        } else {
          if (await client.casSet(appKey(id), raw, JSON.stringify(next))) {
            if (rec === undefined) await client.sadd(INDEX_KEY, id);
            return next;
          }
        }
        await sleep(20 * (attempt + 1));
      }
      throw new ConflictError(id);
    },
    // --- shims legacy (compatibilidad Fase 1→2) ---
    async load() { return store.getAll(); },
    async save(reg) {
      const prevIds = await client.smembers(INDEX_KEY);
      for (const id of Object.keys(reg)) {
        await client.set(appKey(id), JSON.stringify(reg[id]));
        await client.sadd(INDEX_KEY, id);
      }
      for (const id of prevIds) {
        if (!(id in reg)) { await client.casDel(appKey(id), await client.get(appKey(id))); await client.srem(INDEX_KEY, id); }
      }
    },
  };
  return store;
}
```

(El `jsonStore` fs: adaptarlo a la misma interfaz — mantener un objeto JSON en `data/registry.json` y derivar `getApp/getAll/mutateApp` sobre él; sin concurrencia real. Ver Step 3b.)

- [ ] **Step 3b: Adaptar `jsonStore` (fs)** — reescribir `jsonStore` para implementar `getApp/getAll/mutateApp/load/save` leyendo/escribiendo el JSON entero de `data/registry.json` (dev, un proceso):

```ts
export const jsonStore: RegistryStore = {
  async getAll() { /* lee el file → Registry (o {}) */ },
  async getApp(id) { return (await this.getAll())[id]; },
  async mutateApp(id, fn) {
    const reg = await this.getAll();
    const next = fn(reg[id]);
    if (next === null) { const { [id]: _, ...rest } = reg; await writeFile(rest); return null; }
    await writeFile({ ...reg, [id]: next }); return next;
  },
  async load() { return this.getAll(); },
  async save(reg) { await writeFile(reg); },
};
```
(Completar `writeFile`/read con `fs.promises` como el `jsonStore` actual — mismo `DATA_FILE`.)

- [ ] **Step 4: Run — pass.** `pnpm test lib/registry/__tests__/` → verde (incluye concurrency).

- [ ] **Step 5: Typecheck + full suite + commit**
```bash
pnpm typecheck && pnpm test
git add lib/registry/store.ts lib/registry/__tests__/store.test.ts lib/registry/__tests__/concurrency.test.ts
git commit -m "feat(registry): store v2 por-app (getApp/getAll/mutateApp + CAS) + shims legacy"
```

> Al terminar Fase 1: todo sigue verde. Los call-sites viejos usan `load()/save()` (shims) sobre el storage per-app; la migración corre lazy. Todavía no hay ganancia de concurrencia — llega en Fase 2.

---

## FASE 2 — Dominio por-record + convertir los writes

### Task 5: Mutadores del dominio por-record

**Files:**
- Modify: `lib/registry/registry.ts` (los 9 mutadores)
- Test: portar `lib/registry/__tests__/{registry,pin,maintainers,public-key,storage-provider,update-meta}.test.ts`

**Interfaces:**
- Produces: variantes por-record de cada mutador. Firma nueva (ejemplos):
  - `publishVersionRecord(rec: MiniappRecord | undefined, rawId, input, now): MiniappRecord`
  - `setPinRecord(rec, version): MiniappRecord` (throw si `rec===undefined`)
  - `registerRecord(input, now): MiniappRecord` (crea; no recibe rec)
  - análogos: `setMaintainersRecord`, `setPublicKeyRecord`, `setStorageProviderRecord`, `updateMetaRecord`, `removeVersionRecord`. `removeMiniapp` no necesita fn (es `mutateApp(id, () => null)`).

> **Estrategia:** implementar los por-record y reexpresar los `(reg)=>reg` viejos como wrappers (`publishVersion(reg,id,...) = {...reg,[id]: publishVersionRecord(reg[id],id,...)}`) para no romper los tests/reads existentes de un saque. Los reads (`resolveMiniapp`, `getMiniappDetail`, `listCatalog`) NO cambian en esta task.

- [ ] **Step 1: Failing test** — agregar a `registry.test.ts` un bloque que pruebe una fn por-record, ej:
```ts
describe("publishVersionRecord (por-record)", () => {
  it("agrega la versión al record y valida id/manifest", () => {
    const rec = registerRecord({ id: "acc", name: "A", owner: "o" }, now);
    const next = publishVersionRecord(rec, "acc", { version: "0.1.0", url: "u", manifest: manifest("acc","0.1.0") }, now);
    expect(next.versions[0].version).toBe("0.1.0");
  });
  it("throw si el record no existe y la op lo requiere", () => {
    expect(() => publishVersionRecord(undefined, "acc", { version: "0.1.0", url: "u", manifest: manifest("acc","0.1.0") }, now)).toThrow(MiniappNotFoundError);
  });
});
```

- [ ] **Step 2: Run — fail.**

- [ ] **Step 3: Implement** — por cada mutador, extraer la lógica que hoy opera sobre `reg[id]` a una fn `(rec, ...) => rec`, mantener las validaciones (parse id, `MiniappNotFoundError` si `rec===undefined` cuando corresponde, `VersionExistsError`, etc.), y reexpresar el `(reg)=>reg` viejo como wrapper. Enumeración:

| `(reg)=>reg` viejo | nueva `(rec)=>rec` | notas |
|---|---|---|
| `registerMiniapp` | `registerRecord(input, now)` | crea; el wrapper chequea `reg[id]` existe → `MiniappExistsError` |
| `removeMiniapp` | — | `mutateApp(id, ()=>null)` |
| `updateMiniappMeta` | `updateMetaRecord(rec, patch)` | throw si undefined |
| `setMiniappStorageProvider` | `setStorageProviderRecord(rec, provider)` | |
| `setMiniappPin` | `setPinRecord(rec, version)` | valida versión existe |
| `setMaintainers` | `setMaintainersRecord(rec, list)` | |
| `setMiniappPublicKey` | `setPublicKeyRecord(rec, pubkey)` | |
| `removeVersion` | `removeVersionRecord(rec, version)` | rechaza servida |
| `publishVersion` | `publishVersionRecord(rec, rawId, input, now)` | android crea/ios adjunta |

- [ ] **Step 4: Run — pass** (tests viejos siguen verdes vía wrappers + nuevos por-record).

- [ ] **Step 5: Commit**
```bash
pnpm typecheck && pnpm test lib/registry/
git add lib/registry/registry.ts lib/registry/__tests__/
git commit -m "feat(registry): mutadores por-record (wrappers preservan la API vieja)"
```

### Task 6: Convertir los 9 call-sites limpios a `mutateApp`

**Files (una ruta por sub-paso; mismo patrón):**
- `app/api/miniapps/route.ts` (POST, register), `.../[id]/route.ts` (DELETE remove, PATCH meta), `.../maintainers/route.ts`, `.../storage-provider/route.ts`, `.../pin/route.ts`, `.../public-key/route.ts`, `.../versions/[version]/route.ts`, `.../publish/route.ts`
- Test: los `app/api/__tests__/*-route.test.ts` correspondientes — actualizar el mock de `getStore`.

**Interfaces:** consumen `store.mutateApp` (Task 4) + las fns por-record (Task 5).

**Patrón de conversión (idéntico en todas):**
```ts
// ANTES:
const reg = await getStore().load();
// ...validaciones/auth con reg[id]...
const next = setMiniappPin(reg, id, version); // (reg)=>reg
await getStore().save(next);
return NextResponse.json(getMiniappDetail(next, id), { status: 200 });

// DESPUÉS:
const store = getStore();
const rec = await store.getApp(id);            // para auth/validación previa (maintainers, existencia)
if (rec === undefined) return 404...
// ...auth con rec.maintainers...
const nextRec = await store.mutateApp(id, (r) => setPinRecord(assertExists(r, id), version));
return NextResponse.json(getMiniappDetailFromRecord(nextRec!, id), { status: 200 });
```

> Dos helpers a introducir para no repetir: `assertExists(rec, id)` (throw `MiniappNotFoundError` si undefined) y `getMiniappDetailFromRecord(rec, id)` (la proyección de detalle desde un record; hoy `getMiniappDetail(reg, id)` toma el reg — agregar la variante por-record o adaptar). El mock de `getStore` en cada test gana `getApp`/`mutateApp` (implementados sobre un `Map` local del test).

**Mock helper para los tests de rutas** (reutilizable — definir una vez y copiar):
```ts
const state = vi.hoisted(() => ({ apps: {} as Record<string, any> }));
vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({
    getApp: async (id: string) => state.apps[id],
    getAll: async () => state.apps,
    mutateApp: async (id: string, fn: (r: any) => any) => {
      const next = fn(state.apps[id]);
      if (next === null) { delete state.apps[id]; return null; }
      state.apps[id] = next; return next;
    },
  }),
}));
```

- [ ] **Sub-pasos (uno por ruta):** para CADA ruta de la lista, en orden: (1) actualizar su test — cambiar el mock de `getStore` al helper de arriba y ajustar asserts si hace falta; correr → debería fallar (la ruta aún usa `load/save`); (2) convertir la ruta al patrón; (3) correr el test → verde; (4) commit `refactor(<ruta>): usa mutateApp (CAS por-miniapp)`.

  Correr por ruta: `pnpm test app/api/__tests__/<ruta>-route.test.ts`.

### Task 7: Convertir upload (publish + prune) y scaffold + seed

**Files:**
- Modify: `app/api/miniapps/[id]/upload/route.ts`
- Modify: `lib/registry/prune.ts` (split I/O vs mutación)
- Modify: `app/api/scaffold/route.ts` + `lib/scaffold.ts`
- Modify: `lib/registry/seed.ts` + `app/api/seed/route.ts`
- Test: `upload-route.test.ts`, `prune.test.ts`, `scaffold-route.test.ts`, `seed-route.test.ts`

**Interfaces:** `store.mutateApp`, `publishVersionRecord`, `registerRecord`, `versionsToPrune` (ya existe, puro).

- [ ] **Step 1: `pruneMiniapp` split** — separar el cálculo+I/O de la mutación. Nueva forma:
```ts
// prune.ts
export async function pruneChunks(storage, id, toPrune: SemVer[]): Promise<void> {
  for (const v of toPrune) { try { await storage.deletePrefix(`${id}/${v}`); } catch {} }
}
export function removePrunedVersions(rec: MiniappRecord, toPrune: SemVer[]): MiniappRecord {
  const gone = new Set(toPrune.map(String));
  return { ...rec, versions: rec.versions.filter((pv) => !gone.has(pv.version)) };
}
```
Test `prune.test.ts`: portar a estas dos fns (una pura, una I/O).

- [ ] **Step 2: upload route** — reemplazar `load → publishVersion → save → (prune) save` por:
```ts
const store = getStore();
// storage.put(...) YA está afuera (I/O) — sin cambios.
const nextRec = await store.mutateApp(id, (r) => publishVersionRecord(r, id, { version, url, manifest, platform, integrity, signature }, new Date().toISOString()));
// prune best-effort, afuera del CAS:
try {
  const toPrune = versionsToPrune(nextRec!, pruneKeep());
  if (toPrune.length > 0) {
    await pruneChunks(storage, id, toPrune);
    await store.mutateApp(id, (r) => (r ? removePrunedVersions(r, toPrune) : r));
  }
} catch { /* el prune nunca rompe el publish */ }
```
Actualizar `upload-route.test.ts` (mock helper con `mutateApp`).

- [ ] **Step 3: scaffold** — en `lib/scaffold.ts`/route, el `registerMiniapp(reg,...)+save` pasa a: crear repo (I/O, sin cambios) → `store.mutateApp(id, (r) => { if (r) throw new MiniappExistsError(id); return registerRecord(input, now); })`.

- [ ] **Step 4: seed** — reescribir `seedRegistry(store)` para no hacer `load/save` del todo:
```ts
export async function seedRegistry(store: RegistryStore): Promise<Registry> {
  for (const [id, seedRec] of Object.entries(SEED_REGISTRY)) {
    await store.mutateApp(id, (r) => r ?? seedRec); // idempotente: no pisa existentes
  }
  return store.getAll();
}
```
Actualizar `seed-route.test.ts`.

- [ ] **Step 5: Run todo + commit**
```bash
pnpm typecheck && pnpm test
git add app/api/miniapps/[id]/upload/route.ts lib/registry/prune.ts app/api/scaffold/route.ts lib/scaffold.ts lib/registry/seed.ts app/api/seed/route.ts app/api/__tests__/
git commit -m "refactor(upload/scaffold/seed): mutateApp con I/O afuera del CAS"
```

### Task 8: Remover los shims `load()`/`save()`

**Files:** `lib/registry/store.ts`, cualquier import residual.

- [ ] **Step 1:** grep `getStore().load(` / `getStore().save(` y `store.load(`/`store.save(` en `app/` y `lib/` — deben quedar SOLO reads que usan `getAll()`. Convertir los reads restantes a `getAll()`/`getApp()`. Verificar con `pnpm typecheck` tras quitar `load`/`save` de la interfaz.
- [ ] **Step 2:** quitar `load()`/`save()` de `RegistryStore` + de `kvStore`/`jsonStore`. Correr `pnpm test`.
- [ ] **Step 3: commit** `refactor(registry): remover shims load/save (todo por-app)`.

---

## FASE 3 — Reads optimizados + otros stores + docs

### Task 9: `resolve` / `detail` por `getApp`

**Files:** `app/api/resolve/route.ts`, `app/miniapp/[id]/page.tsx`, `lib/registry/registry.ts` (variante de resolve/detail por-record), tests.

- [ ] Adaptar `resolveMiniapp`/`getMiniappDetail` a tomar un `MiniappRecord` (o agregar `resolveRecord`) y que `resolve`/`detail` usen `store.getApp(id)` en vez de `getAll()`. Portar `resolve-route.test.ts`. Commit.

### Task 10: Otros stores (trust-bundle / host-contract / storage-preference) con CAS

**Files:** `lib/trust/store.ts`, host-contract store, storage-preference store + tests.

- [ ] A cada uno: agregar un `mutate(fn)` que hace `casSet(key, expected, value)` con retry (mismo patrón que `mutateApp` pero single-key, sin índice). Convertir su único call-site de escritura a `mutate`. Tests de round-trip + conflicto. Commit por store.

### Task 11: Script de migración + docs

**Files:** `scripts/migrate-registry-per-app.mjs` (nuevo), `docs/SETUP.md` §7.6, `docs/TROUBLESHOOTING.md`, `docs/CHANGELOG.md`.

- [ ] **Script:** `scripts/migrate-registry-per-app.mjs` — construye un `KvClient` desde env (Upstash) y llama `migrateBlobToPerApp`. Log del resultado. (Node puro; usa `@upstash/redis` directo.)
- [ ] **Docs:** SETUP §7.6 pasa de "deuda a saldar" → "**resuelto**: keys por-miniapp + CAS (ver spec `2026-09-02-registry-per-miniapp-keys`)"; actualizar la fila de TROUBLESHOOTING (el síntoma ya no debería ocurrir; dejar la explicación histórica + "resuelto en …"); hito en CHANGELOG.
- [ ] `pnpm build` + commit.

## Self-review notes

- Cobertura del spec: Fase 1 (primitivos/store/migración) → Tasks 1-4; Fase 2 (dominio+writes) → Tasks 5-8; Fase 3 (reads+otros+docs) → Tasks 9-11. ✓
- Riesgo mayor: los **mocks de rutas** (Task 6/7) — cada test de ruta necesita el mock con `mutateApp`. Enumerado como sub-paso por ruta.
- El `getMiniappDetail(reg,id)` toma `reg` hoy; se necesita variante por-record (`getMiniappDetailFromRecord`) — marcado en Task 6.
- `pruneMiniapp` async/I-O → split en Task 7 (I/O afuera del CAS).
- Rollout: la migración lazy corre en el primer `getAll()` post-deploy; el script permite correrla explícita antes. Backward-safe (idempotente).
