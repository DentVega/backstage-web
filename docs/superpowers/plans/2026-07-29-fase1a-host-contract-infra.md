# Fase 1-A — Infraestructura del Host Contract en Backstage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El cimiento control-plane de la Fase 1: Backstage puede recibir, guardar y servir el Host Contract, y usarlo como fuente de verdad para el `shared` por defecto + un gate de compatibilidad en `/upload` **en modo warn** (loguea, no rechaza).

**Architecture:** Espeja `lib/registry` (store env-selected KV/JSON). Un endpoint `GET/PUT /api/host-contract` guardado por un `HOST_CONTRACT_TOKEN` dedicado (auth con el `safeEqual` timing-safe que ya existe en `lib/auth.ts`). `lib/manifest.ts` deriva su `shared` por defecto del contract guardado. El `/upload` corre `satisfiesShared` y **solo loguea** el resultado (rollout §8.2 del spec).

**Tech Stack:** Next.js 16 (route handlers `runtime = "nodejs"`), TypeScript, Vitest, `@dentvega/miniapp-contract` (ya instalado: `satisfiesShared`, `SharedDepSpec`, `Manifest`), Upstash KV (reusa `upstashClient`/`KvClient` de `lib/registry/kv`).

## Global Constraints

- **Owner:** DentVega. **Sin dependencias nuevas** (la lib `semver` entra en el plan del contract package, no acá; el warn-mode usa el `satisfiesShared` ya publicado).
- **Modo warn:** el gate de `/upload` **loguea pero NUNCA rechaza** en este plan (el 422 se activa en un plan posterior, §8.5 del spec).
- **`HostContract` type** se define local en `lib/host-contract/types.ts` (el contract package lo adopta después; no bloquear en un publish de paquete).
- **Regla at-risk (§2.7):** un `manifest.shared` vacío/ausente se loguea como *at-risk*, no como compatible.
- Commits con **paths explícitos** (no `git add -A`); **no** commitear `data/registry.json` ni `data/host-contract.json`. Trailer en cada commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```
- Tests que importan `@/lib/auth` (transitivo a `@/auth`) deben `vi.mock("@/auth", ...)`.
- Commits **locales**; push tras la review final.

---

### Task 1: Tipo `HostContract` + store (KV/JSON)

**Files:**
- Create: `lib/host-contract/types.ts`
- Create: `lib/host-contract/store.ts`
- Test: `lib/host-contract/__tests__/store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface HostContract {
    contractVersion: string;
    reactNative: string;
    shared: Readonly<Record<string, string>>;   // name → concrete version
    nativeModules: readonly string[];
  }
  export function isHostContract(v: unknown): v is HostContract;
  export interface HostContractStore {
    load(): Promise<HostContract | null>;
    save(c: HostContract): Promise<void>;
  }
  export function getHostContractStore(): HostContractStore;
  ```
- Consumes: `KvClient`, `upstashClient` de `@/lib/registry/kv`.

- [ ] **Step 1: Test que falla** — `lib/host-contract/__tests__/store.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { isHostContract } from "@/lib/host-contract/types";
import { kvHostContractStore, jsonHostContractStore } from "@/lib/host-contract/store";
import type { KvClient } from "@/lib/registry/kv";

const VALID = {
  contractVersion: "1.0.0",
  reactNative: "0.76.6",
  shared: { react: "18.3.1", "react-native": "0.76.6" },
  nativeModules: ["react-native-screens"],
};

describe("isHostContract", () => {
  it("acepta un contract válido", () => expect(isHostContract(VALID)).toBe(true));
  it("rechaza objetos incompletos / mal tipados", () => {
    expect(isHostContract(null)).toBe(false);
    expect(isHostContract({ ...VALID, shared: "x" })).toBe(false);
    expect(isHostContract({ ...VALID, nativeModules: "x" })).toBe(false);
    expect(isHostContract({ contractVersion: "1.0.0" })).toBe(false);
  });
});

function memKv(): KvClient {
  const m = new Map<string, string>();
  return {
    async get(k) { return m.get(k) ?? null; },
    async set(k, v) { m.set(k, v); },
  };
}

describe("kvHostContractStore", () => {
  it("load null cuando no hay contract", async () => {
    expect(await kvHostContractStore(memKv()).load()).toBeNull();
  });
  it("save + load roundtrip", async () => {
    const store = kvHostContractStore(memKv());
    await store.save(VALID as never);
    expect(await store.load()).toEqual(VALID);
  });
});
```

- [ ] **Step 2: Correr — falla** (`npx vitest run lib/host-contract/__tests__/store.test.ts`) → módulos no existen.

- [ ] **Step 3: `lib/host-contract/types.ts`**

```ts
/** El Host Platform Contract: fuente de verdad de lo que el host provee. */
export interface HostContract {
  /** SemVer que bumpea cuando cambia la plataforma. */
  contractVersion: string;
  /** Versión de react-native del host. */
  reactNative: string;
  /** Singletons que provee el host: name → versión concreta. */
  shared: Readonly<Record<string, string>>;
  /** Módulos nativos sin API JS compilados en el binario (presencia only). */
  nativeModules: readonly string[];
}

export function isHostContract(v: unknown): v is HostContract {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.contractVersion === "string" &&
    typeof c.reactNative === "string" &&
    typeof c.shared === "object" && c.shared !== null && !Array.isArray(c.shared) &&
    Array.isArray(c.nativeModules) &&
    c.nativeModules.every((n) => typeof n === "string")
  );
}
```

- [ ] **Step 4: `lib/host-contract/store.ts`**

```ts
/** Host Contract store — un solo valor bajo una key (espeja lib/registry). */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { KvClient } from "@/lib/registry/kv";
import { upstashClient } from "@/lib/registry/kv";
import type { HostContract } from "./types";

const DATA_FILE = path.join(process.cwd(), "data", "host-contract.json");
const KEY = "host-contract";

export interface HostContractStore {
  load(): Promise<HostContract | null>;
  save(c: HostContract): Promise<void>;
}

export const jsonHostContractStore: HostContractStore = {
  async load(): Promise<HostContract | null> {
    try {
      return JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as HostContract;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  },
  async save(c: HostContract): Promise<void> {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, `${JSON.stringify(c, null, 2)}\n`, "utf8");
  },
};

export function kvHostContractStore(client: KvClient): HostContractStore {
  return {
    async load(): Promise<HostContract | null> {
      const raw = await client.get(KEY);
      return raw ? (JSON.parse(raw) as HostContract) : null;
    },
    async save(c: HostContract): Promise<void> {
      await client.set(KEY, JSON.stringify(c));
    },
  };
}

/** Env-selected: Upstash KV en prod, JSON fs en dev (espeja getStore). */
export function getHostContractStore(): HostContractStore {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return kvHostContractStore(upstashClient());
  }
  return jsonHostContractStore;
}
```

- [ ] **Step 5: Correr — pasa** (`npx vitest run lib/host-contract/__tests__/store.test.ts`).
- [ ] **Step 6: `npx tsc --noEmit`** limpio.
- [ ] **Step 7: Commit**

```bash
git add lib/host-contract/types.ts lib/host-contract/store.ts lib/host-contract/__tests__/store.test.ts
git commit  # feat(host-contract): HostContract type + KV/JSON store  (+ trailer)
```

---

### Task 2: `HOST_CONTRACT_TOKEN` auth + `GET/PUT /api/host-contract`

**Files:**
- Modify: `lib/auth.ts` (agrega `requireHostContractToken`)
- Create: `app/api/host-contract/route.ts`
- Test: `app/api/__tests__/host-contract-route.test.ts`

**Interfaces:**
- Consumes: `getHostContractStore` (Task 1), `isHostContract` (Task 1), `safeEqual` (ya en `lib/auth.ts`, privado — la nueva función vive en el mismo archivo), `errorBody`/`statusForError` (`@/lib/http`).
- Produces: `requireHostContractToken(req: Request): void` — lanza `AuthError` salvo Bearer `HOST_CONTRACT_TOKEN` válido (timing-safe). `GET` → 200 contract | 404; `PUT` → 200 | 401 | 400.

- [ ] **Step 1: Test que falla** — `app/api/__tests__/host-contract-route.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostContract } from "@/lib/host-contract/types";

const state = vi.hoisted(() => ({ contract: null as HostContract | null }));
vi.mock("@/lib/host-contract/store", () => ({
  getHostContractStore: () => ({
    load: async () => state.contract,
    save: async (c: HostContract) => { state.contract = c; },
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/host-contract/route";

const VALID: HostContract = {
  contractVersion: "1.0.0",
  reactNative: "0.76.6",
  shared: { react: "18.3.1", "react-native": "0.76.6" },
  nativeModules: [],
};

function putReq(body: unknown, auth?: string): Request {
  return new Request("http://x/api/host-contract", {
    method: "PUT",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.contract = null;
  process.env.HOST_CONTRACT_TOKEN = "contract-secret";
});
afterEach(() => { delete process.env.HOST_CONTRACT_TOKEN; vi.restoreAllMocks(); });

describe("GET /api/host-contract", () => {
  it("404 cuando no hay contract", async () => {
    expect((await GET()).status).toBe(404);
  });
  it("200 con el contract guardado", async () => {
    state.contract = VALID;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(VALID);
  });
});

describe("PUT /api/host-contract", () => {
  it("401 sin token", async () => {
    expect((await PUT(putReq(VALID))).status).toBe(401);
  });
  it("401 con token equivocado", async () => {
    expect((await PUT(putReq(VALID, "Bearer nope"))).status).toBe(401);
  });
  it("400 con body inválido", async () => {
    const res = await PUT(putReq({ contractVersion: "1.0.0" }, "Bearer contract-secret"));
    expect(res.status).toBe(400);
    expect(state.contract).toBeNull();
  });
  it("200 y persiste con token + body válido", async () => {
    const res = await PUT(putReq(VALID, "Bearer contract-secret"));
    expect(res.status).toBe(200);
    expect(state.contract).toEqual(VALID);
  });
});
```

- [ ] **Step 2: Correr — falla** (no existe la ruta).

- [ ] **Step 3: `lib/auth.ts` — agregar `requireHostContractToken`** (después de `requirePublishToken`, reusa el `safeEqual` privado del archivo)

```ts
/** Lanza AuthError salvo que el request traiga el HOST_CONTRACT_TOKEN como Bearer.
 * Token dedicado (solo el CI del host lo tiene) — separado del PUBLISH_TOKEN. */
export function requireHostContractToken(req: Request): void {
  const expected = process.env.HOST_CONTRACT_TOKEN ?? "";
  if (expected.length === 0) throw new AuthError("HOST_CONTRACT_TOKEN not configured");
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!safeEqual(token, expected)) throw new AuthError();
}
```

- [ ] **Step 4: `app/api/host-contract/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getHostContractStore } from "@/lib/host-contract/store";
import { isHostContract } from "@/lib/host-contract/types";
import { requireHostContractToken } from "@/lib/auth";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/** GET /api/host-contract — el contract vigente (404 si no hay). */
export async function GET(): Promise<NextResponse> {
  const contract = await getHostContractStore().load();
  if (contract === null) {
    return NextResponse.json({ error: "no host contract published" }, { status: 404 });
  }
  return NextResponse.json(contract, { status: 200 });
}

/** PUT /api/host-contract — publica el contract (solo el CI del host, HOST_CONTRACT_TOKEN). */
export async function PUT(req: Request): Promise<NextResponse> {
  try {
    requireHostContractToken(req);
    const body = (await req.json()) as unknown;
    if (!isHostContract(body)) {
      return NextResponse.json({ error: "invalid host contract" }, { status: 400 });
    }
    await getHostContractStore().save(body);
    return NextResponse.json({ ok: true, contractVersion: body.contractVersion }, { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
```

- [ ] **Step 5: Correr — pasa** (`npx vitest run app/api/__tests__/host-contract-route.test.ts`).
- [ ] **Step 6: `npx tsc --noEmit`** limpio.
- [ ] **Step 7: Commit**

```bash
git add lib/auth.ts app/api/host-contract/route.ts app/api/__tests__/host-contract-route.test.ts
git commit  # feat(host-contract): GET/PUT endpoint guarded by HOST_CONTRACT_TOKEN  (+ trailer)
```

---

### Task 3: `resolveDefaultShared` — el `shared` por defecto sale del contract

**Files:**
- Modify: `lib/manifest.ts`
- Test: `lib/__tests__/manifest.test.ts` (crear si no existe; si existe, agregar el describe)

**Interfaces:**
- Produces: `resolveDefaultShared(): Promise<readonly SharedDepSpec[]>` — mapea el `contract.shared` guardado a `{ name, requiredRange: "^"+version, singleton: true }`; fallback al `DEFAULT_SHARED` hardcodeado si no hay contract. `defaultManifest(id, version, capabilities, shared?)` acepta un `shared` opcional (default `DEFAULT_SHARED`).
- Consumes: `getHostContractStore` (Task 1).

- [ ] **Step 1: Test que falla** — `lib/__tests__/manifest.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostContract } from "@/lib/host-contract/types";

const state = vi.hoisted(() => ({ contract: null as HostContract | null }));
vi.mock("@/lib/host-contract/store", () => ({
  getHostContractStore: () => ({ load: async () => state.contract, save: async () => {} }),
}));

import { resolveDefaultShared } from "@/lib/manifest";

afterEach(() => { state.contract = null; });

describe("resolveDefaultShared", () => {
  it("deriva del contract guardado (^version)", async () => {
    state.contract = {
      contractVersion: "1.0.0", reactNative: "0.76.6",
      shared: { react: "18.3.1", "react-native": "0.76.6" }, nativeModules: [],
    };
    const shared = await resolveDefaultShared();
    expect(shared).toContainEqual({ name: "react-native", requiredRange: "^0.76.6", singleton: true });
    expect(shared).toContainEqual({ name: "react", requiredRange: "^18.3.1", singleton: true });
  });
  it("fallback al hardcodeado si no hay contract", async () => {
    state.contract = null;
    const shared = await resolveDefaultShared();
    expect(shared.some((s) => s.name === "react-native")).toBe(true);
  });
});
```

- [ ] **Step 2: Correr — falla** (`resolveDefaultShared` no existe).

- [ ] **Step 3: `lib/manifest.ts`** — agregar el import + la función, y `shared?` a `defaultManifest`

Import arriba:
```ts
import type { SharedDepSpec } from "@dentvega/miniapp-contract";
import { getHostContractStore } from "@/lib/host-contract/store";
```
Agregar tras `DEFAULT_SHARED`:
```ts
/**
 * El `shared` por defecto: derivado del Host Contract guardado (fuente de verdad),
 * con fallback al hardcodeado si todavía no se publicó ninguno. Cada singleton del
 * host se vuelve `{ name, requiredRange: "^"+version, singleton: true }`.
 */
export async function resolveDefaultShared(): Promise<readonly SharedDepSpec[]> {
  const contract = await getHostContractStore().load();
  if (contract === null) return DEFAULT_SHARED;
  return Object.entries(contract.shared).map(([name, version]) => ({
    name,
    requiredRange: `^${version}`,
    singleton: true,
  }));
}
```
Cambiar la firma de `defaultManifest` para aceptar `shared`:
```ts
export function defaultManifest(
  id: string,
  version: string,
  capabilities: readonly Capability[],
  shared: readonly SharedDepSpec[] = DEFAULT_SHARED,
): Manifest {
  return { id: id as Manifest["id"], version: version as Manifest["version"],
    entry: "./Entry", shared, capabilities };
}
```
(Ajustar el objeto retornado real para que use `shared` en vez de `DEFAULT_SHARED` — mantener el resto de campos como estaban.)

- [ ] **Step 4: Correr — pasa** (`npx vitest run lib/__tests__/manifest.test.ts`).
- [ ] **Step 5: `npx tsc --noEmit`** limpio (verificar que los callers actuales de `defaultManifest` siguen compilando — el 4º arg es opcional).
- [ ] **Step 6: Commit**

```bash
git add lib/manifest.ts lib/__tests__/manifest.test.ts
git commit  # feat(host-contract): default shared derives from stored contract  (+ trailer)
```

---

### Task 4: Gate de compatibilidad en `/upload` — modo WARN

**Files:**
- Modify: `app/api/miniapps/[id]/upload/route.ts`
- Test: `app/api/__tests__/upload-route.test.ts` (agregar casos)

**Interfaces:**
- Consumes: `resolveDefaultShared` (Task 3), `getHostContractStore` (Task 1), `satisfiesShared` (`@dentvega/miniapp-contract`).

- [ ] **Step 1: Test que falla** — agregar a `app/api/__tests__/upload-route.test.ts`

Un test que verifica que un upload con `shared` incompatible **igual devuelve 201** (warn mode) y **loguea** un warning. Espeja el setup existente del archivo (mock de store/auth/storage). Estructura:
```ts
it("modo warn: loguea incompatibilidad pero NO rechaza (201)", async () => {
  // contract guardado con react-native 0.76.6; manifest declara ^0.99 (incompatible)
  // → satisfiesShared incompatible → console.warn llamado, status 201
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  // ...armar el form con un manifest JSON que tenga shared: [{name:"react-native",requiredRange:"^0.99.0",singleton:true}]
  // ...(seguir el patrón del test existente para construir el multipart + auth)
  const res = await POST(req, params);
  expect(res.status).toBe(201);
  expect(warn).toHaveBeenCalled();
});
```
(El implementer completa el armado del multipart siguiendo los tests ya existentes en el archivo — mismo helper de auth/form. Debe mockear el `getHostContractStore` para devolver un contract con `react-native: "0.76.6"`.)

- [ ] **Step 2: Correr — falla** (aún no hay warning/gate).

- [ ] **Step 3: Wire en `app/api/miniapps/[id]/upload/route.ts`**

1. Imports:
```ts
import { resolveDefaultShared } from "@/lib/manifest";
import { getHostContractStore } from "@/lib/host-contract/store";
import { satisfiesShared } from "@dentvega/miniapp-contract";
```
2. En la rama UI (sin manifest explícito), usar el shared derivado:
```ts
const caps = parseCapabilities(typeof capsRaw === "string" ? capsRaw : "");
manifest = defaultManifest(id, version, caps, await resolveDefaultShared());
```
3. Tras finalizar el `manifest` (después de setear `integrity`), el gate en modo warn — antes de `putMany`:
```ts
// Gate de compatibilidad (MODO WARN — loguea, no rechaza; el 422 se activa después).
try {
  const contract = await getHostContractStore().load();
  const m = manifest as { shared?: { name: string; requiredRange: string; singleton: boolean }[] };
  if (contract === null) {
    console.warn(`compat[${id}@${version}]: no host contract published — skipping check`);
  } else if (!m.shared || m.shared.length === 0) {
    console.warn(`compat[${id}@${version}]: manifest has empty 'shared' — treated as at-risk`);
  } else {
    const skew = satisfiesShared(contract.shared, m.shared);
    if (!skew.compatible) {
      const bad = skew.entries.filter((e) => e.status !== "ok")
        .map((e) => `${e.name} (${e.status}, needs ${e.requiredRange})`).join(", ");
      console.warn(`compat[${id}@${version}]: INCOMPATIBLE with host — ${bad} [warn mode, not blocking]`);
    }
  }
} catch (err) {
  console.warn(`compat[${id}@${version}]: check errored (ignored in warn mode):`, err);
}
```

- [ ] **Step 4: Correr — pasa** (`npx vitest run app/api/__tests__/upload-route.test.ts`).
- [ ] **Step 5: `npx tsc --noEmit && npx vitest run`** — suite completa verde.
- [ ] **Step 6: Commit**

```bash
git add app/api/miniapps/[id]/upload/route.ts app/api/__tests__/upload-route.test.ts
git commit  # feat(host-contract): warn-mode compat gate on /upload  (+ trailer)
```

---

## Cierre (post-tasks, controller)

1. Review final whole-branch (base = commit previo a Task 1) en el modelo más capaz.
2. `npx tsc --noEmit && npx vitest run && npx next build` — todo verde.
3. **Push a `main`.**
4. Operacional (fuera de este plan): setear `HOST_CONTRACT_TOKEN` en Vercel; el host publicará su contract (plan del generador). El gate queda en warn hasta el plan que lo activa a 422.

## Nota de alcance
Este plan es **Fase 1-A** (Backstage). Faltan, como planes siguientes de Fase 1:
`gen-host-contract.mjs` + natives-as-singletons en el host; `satisfiesShared`→semver +
`minHostContract` en el contract package (republish); `gen-manifest-shared.mjs` +
`check-compat.mjs` + wiring en el workflow reutilizable del template; y el **backfill**
de la flota (§8.3 del spec).
