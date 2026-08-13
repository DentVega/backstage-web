# Selector de storage provider (Fase B) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un admin de Backstage elige qué storage provider está activo (R2 / Blob) desde el catálogo; la preferencia vive en KV y `getStorage()` la respeta, con fallback seguro al orden por env.

**Architecture:** Preferencia = valor único en KV (espeja `lib/host-contract/store.ts`). `getStorage()` pasa a async y lee la preferencia; si el provider elegido no tiene creds en env, cae al orden por env (R2 → Blob → fs). Endpoint `GET/PUT /api/storage-provider` (PUT con guard `canScaffold`). Control client-side montado en el catálogo solo para admins.

**Tech Stack:** TypeScript, Next.js 16, Vitest, @testing-library/react, Upstash KV (`KvClient`).

## Global Constraints

- **Owner:** <owner>. **Repo:** `backstage-web`. Commits **locales** (push tras la review final). Directo a `main` (patrón de la sesión).
- **Providers:** `StorageProvider = "r2" | "blob" | "fs"`. Orden por env: R2 → Blob → fs. `fs` siempre disponible (fallback dev).
- **Fallback seguro:** una preferencia solo se aplica si su provider está en `availableProviders()`; si no, se usa `availableProviders()[0]`. Nunca se queda sin storage.
- **Auth:** el **PUT** exige `canScaffold(session?.githubLogin, scaffoldAllowedLogins())` → si no, `ScaffoldForbiddenError` (mapea a 403 vía `statusForError`). El **GET** no lleva guard (no expone secretos). Guard con `await import("@/auth")` **lazy** (como `app/api/miniapps/[id]/route.ts`).
- **KV:** persistir la string cruda (`"r2"`), no JSON-wrapped, en la key `storage-provider` (el `KvClient.get` devuelve `string | null`). Validar al leer con `isStorageProvider`.
- Errores de ruta → `errorBody(err)` + `statusForError(err)` (de `@/lib/http`).
- Commits con **paths explícitos**; trailer en cada commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```

---

### Task 1: `lib/storage/provider.ts` — tipos + disponibilidad

**Files:**
- Create: `lib/storage/provider.ts`
- Test: `lib/storage/__tests__/provider.test.ts`

**Interfaces:**
- Produces: `type StorageProvider = "r2" | "blob" | "fs"`, `availableProviders(): StorageProvider[]`, `isStorageProvider(v: unknown): v is StorageProvider`.
- Consumes: `r2ConfigFromEnv` de `./r2` (Task de Fase A, ya existe).

- [ ] **Step 1: Test que falla** — `lib/storage/__tests__/provider.test.ts`

```ts
import { afterEach, describe, expect, it } from "vitest";
import { availableProviders, isStorageProvider } from "@/lib/storage/provider";

const R2_VARS = {
  R2_ACCOUNT_ID: "a",
  R2_ACCESS_KEY_ID: "b",
  R2_SECRET_ACCESS_KEY: "c",
  R2_BUCKET: "d",
  R2_PUBLIC_BASE_URL: "e",
};

afterEach(() => {
  for (const k of Object.keys(R2_VARS)) delete process.env[k];
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

describe("availableProviders", () => {
  it("solo fs cuando no hay nada configurado", () => {
    expect(availableProviders()).toEqual(["fs"]);
  });
  it("incluye r2 cuando están las 5 vars, en orden r2,fs", () => {
    Object.assign(process.env, R2_VARS);
    expect(availableProviders()).toEqual(["r2", "fs"]);
  });
  it("incluye blob con el token, en orden blob,fs", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    expect(availableProviders()).toEqual(["blob", "fs"]);
  });
  it("orden r2,blob,fs con todo configurado", () => {
    Object.assign(process.env, R2_VARS);
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    expect(availableProviders()).toEqual(["r2", "blob", "fs"]);
  });
});

describe("isStorageProvider", () => {
  it("acepta los tres", () => {
    expect(isStorageProvider("r2")).toBe(true);
    expect(isStorageProvider("blob")).toBe(true);
    expect(isStorageProvider("fs")).toBe(true);
  });
  it("rechaza otros valores", () => {
    expect(isStorageProvider("s3")).toBe(false);
    expect(isStorageProvider(null)).toBe(false);
    expect(isStorageProvider(undefined)).toBe(false);
    expect(isStorageProvider(3)).toBe(false);
  });
});
```

- [ ] **Step 2: Correr — falla** (`npx vitest run lib/storage/__tests__/provider.test.ts`).

- [ ] **Step 3: `lib/storage/provider.ts`**

```ts
import { r2ConfigFromEnv } from "./r2";

export type StorageProvider = "r2" | "blob" | "fs";

const ALL: readonly StorageProvider[] = ["r2", "blob", "fs"];

export function isStorageProvider(v: unknown): v is StorageProvider {
  return typeof v === "string" && (ALL as readonly string[]).includes(v);
}

/** Providers configured by env, in precedence order. `fs` is always available. */
export function availableProviders(): StorageProvider[] {
  const out: StorageProvider[] = [];
  if (r2ConfigFromEnv() !== null) out.push("r2");
  if (process.env.BLOB_READ_WRITE_TOKEN) out.push("blob");
  out.push("fs");
  return out;
}
```

- [ ] **Step 4: Correr — pasa** + `npx tsc --noEmit` limpio.
- [ ] **Step 5: Commit**

```bash
git add lib/storage/provider.ts lib/storage/__tests__/provider.test.ts
git commit  # feat(storage): StorageProvider type + availableProviders/isStorageProvider  (+ trailer)
```

---

### Task 2: `lib/storage/preference.ts` — preferencia en KV

**Files:**
- Create: `lib/storage/preference.ts`
- Test: `lib/storage/__tests__/preference.test.ts`

**Interfaces:**
- Consumes: `KvClient`, `upstashClient` de `@/lib/registry/kv`; `isStorageProvider`, `StorageProvider` de `./provider`.
- Produces: `interface StoragePreferenceStore { load(): Promise<StorageProvider | null>; save(p: StorageProvider): Promise<void> }`, `kvStoragePreferenceStore(client)`, `jsonStoragePreferenceStore`, `getStoragePreferenceStore()`.

- [ ] **Step 1: Test que falla** — `lib/storage/__tests__/preference.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { kvStoragePreferenceStore } from "@/lib/storage/preference";
import type { KvClient } from "@/lib/registry/kv";

function memClient(): KvClient & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    async get(k) {
      return data.get(k) ?? null;
    },
    async set(k, v) {
      data.set(k, v);
    },
  };
}

describe("kvStoragePreferenceStore", () => {
  it("save + load round-trip (string cruda bajo 'storage-provider')", async () => {
    const c = memClient();
    const store = kvStoragePreferenceStore(c);
    await store.save("r2");
    expect(c.data.get("storage-provider")).toBe("r2"); // raw, no JSON wrap
    expect(await store.load()).toBe("r2");
  });
  it("load sin valor → null", async () => {
    expect(await kvStoragePreferenceStore(memClient()).load()).toBeNull();
  });
  it("load de un valor inválido → null (defensivo)", async () => {
    const c = memClient();
    await c.set("storage-provider", "s3");
    expect(await kvStoragePreferenceStore(c).load()).toBeNull();
  });
});
```

- [ ] **Step 2: Correr — falla.**

- [ ] **Step 3: `lib/storage/preference.ts`**

```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import type { KvClient } from "@/lib/registry/kv";
import { upstashClient } from "@/lib/registry/kv";
import { isStorageProvider, type StorageProvider } from "./provider";

const DATA_FILE = path.join(process.cwd(), "data", "storage-provider.json");
const KEY = "storage-provider";

export interface StoragePreferenceStore {
  load(): Promise<StorageProvider | null>;
  save(p: StorageProvider): Promise<void>;
}

/** Dev store: JSON on fs. `{ "provider": "r2" }`. null si no existe o inválido. */
export const jsonStoragePreferenceStore: StoragePreferenceStore = {
  async load(): Promise<StorageProvider | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as { provider?: unknown };
      return isStorageProvider(parsed.provider) ? parsed.provider : null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  },
  async save(p: StorageProvider): Promise<void> {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, `${JSON.stringify({ provider: p }, null, 2)}\n`, "utf8");
  },
};

/** KV store: raw string under `storage-provider`. Validated on read. */
export function kvStoragePreferenceStore(client: KvClient): StoragePreferenceStore {
  return {
    async load(): Promise<StorageProvider | null> {
      const raw = await client.get(KEY);
      return isStorageProvider(raw) ? raw : null;
    },
    async save(p: StorageProvider): Promise<void> {
      await client.set(KEY, p);
    },
  };
}

/** Env-selected: Upstash KV en prod, JSON fs en dev (espeja getStore). */
export function getStoragePreferenceStore(): StoragePreferenceStore {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return kvStoragePreferenceStore(upstashClient());
  }
  return jsonStoragePreferenceStore;
}
```

- [ ] **Step 4: Correr — pasa** + `npx tsc --noEmit` limpio.
- [ ] **Step 5: Commit**

```bash
git add lib/storage/preference.ts lib/storage/__tests__/preference.test.ts
git commit  # feat(storage): KV-backed storage provider preference store  (+ trailer)
```

---

### Task 3: `getStorage()` async + estado del provider

**Files:**
- Modify: `lib/storage/index.ts`
- Modify: `app/api/miniapps/[id]/upload/route.ts:143` (el único caller — ya awaitea)
- Modify: `lib/storage/__tests__/select.test.ts` (getStorage ahora async + lee preferencia)

**Interfaces:**
- Consumes: `availableProviders`, `StorageProvider` de `./provider`; `getStoragePreferenceStore` de `./preference`; `r2ConfigFromEnv`, `r2Storage` de `./r2`; `blobStorage`, `fsStorage`.
- Produces: `getStorage(): Promise<ChunkStorage>` (antes sync), `getStorageProviderState(): Promise<{ available: StorageProvider[]; active: StorageProvider; source: "preference" | "env" }>`.

- [ ] **Step 1: Reescribir el test** — `lib/storage/__tests__/select.test.ts` (reemplaza el contenido entero)

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pref: null as string | null }));

vi.mock("@/lib/storage/r2", () => ({
  r2ConfigFromEnv: () => (process.env.R2_ACCOUNT_ID ? { accountId: "a" } : null),
  r2Storage: () => ({ __kind: "r2" }),
}));
vi.mock("@/lib/storage/blob", () => ({ blobStorage: () => ({ __kind: "blob" }) }));
vi.mock("@/lib/storage/fs", () => ({ fsStorage: () => ({ __kind: "fs" }) }));
vi.mock("@/lib/storage/preference", () => ({
  getStoragePreferenceStore: () => ({ load: async () => state.pref }),
}));

import { getStorage, getStorageProviderState } from "@/lib/storage";

const kind = (s: unknown) => (s as { __kind: string }).__kind;

beforeEach(() => {
  state.pref = null;
});
afterEach(() => {
  delete process.env.R2_ACCOUNT_ID;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  vi.restoreAllMocks();
});

describe("getStorage — env-order sin preferencia", () => {
  it("R2 si está configurado", async () => {
    process.env.R2_ACCOUNT_ID = "a";
    expect(kind(await getStorage())).toBe("r2");
  });
  it("Blob si no hay R2 pero hay token", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    expect(kind(await getStorage())).toBe("blob");
  });
  it("fs si no hay nada", async () => {
    expect(kind(await getStorage())).toBe("fs");
  });
});

describe("getStorage — con preferencia", () => {
  it("la preferencia gana si está disponible", async () => {
    process.env.R2_ACCOUNT_ID = "a";
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    state.pref = "blob";
    expect(kind(await getStorage())).toBe("blob");
  });
  it("preferencia no disponible → fallback env-order[0]", async () => {
    process.env.R2_ACCOUNT_ID = "a"; // blob NO configurado
    state.pref = "blob";
    expect(kind(await getStorage())).toBe("r2");
  });
});

describe("getStorageProviderState", () => {
  it("source 'preference' cuando la pref se aplica", async () => {
    process.env.R2_ACCOUNT_ID = "a";
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    state.pref = "blob";
    expect(await getStorageProviderState()).toEqual({
      available: ["r2", "blob", "fs"],
      active: "blob",
      source: "preference",
    });
  });
  it("source 'env' cuando no hay pref aplicable", async () => {
    process.env.R2_ACCOUNT_ID = "a";
    expect(await getStorageProviderState()).toEqual({
      available: ["r2", "fs"],
      active: "r2",
      source: "env",
    });
  });
});
```
> Nota: el test NO mockea `@/lib/storage/provider` — usa el real, que llama al `r2ConfigFromEnv` mockeado y lee `BLOB_READ_WRITE_TOKEN` del env. Así `availableProviders()` refleja el env del test.

- [ ] **Step 2: Correr — falla** (getStorage aún es sync y no exporta `getStorageProviderState`).

- [ ] **Step 3: `lib/storage/index.ts`** (reemplaza el contenido entero)

```ts
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
```

- [ ] **Step 4: Actualizar el caller** — `app/api/miniapps/[id]/upload/route.ts` (línea ~143). Reemplazar:

```ts
    const { baseUrl } = await getStorage().putMany(`${id}/${version}`, files);
```
por:
```ts
    const storage = await getStorage();
    const { baseUrl } = await storage.putMany(`${id}/${version}`, files);
```

- [ ] **Step 5: Correr — pasa** (`npx vitest run lib/storage/__tests__/select.test.ts`) + suite completa (`npx vitest run`) + `npx tsc --noEmit` + `npx next build`.
- [ ] **Step 6: Commit**

```bash
git add lib/storage/index.ts app/api/miniapps/\[id\]/upload/route.ts lib/storage/__tests__/select.test.ts
git commit  # feat(storage): getStorage reads saved preference (async) + getStorageProviderState  (+ trailer)
```

---

### Task 4: Endpoint `GET/PUT /api/storage-provider`

**Files:**
- Create: `app/api/storage-provider/route.ts`
- Test: `app/api/__tests__/storage-provider-route.test.ts`

**Interfaces:**
- Consumes: `getStorageProviderState` de `@/lib/storage`; `getStoragePreferenceStore` de `@/lib/storage/preference`; `availableProviders`, `isStorageProvider` de `@/lib/storage/provider`; `canScaffold`, `ScaffoldForbiddenError` de `@/lib/scaffold-authz`; `scaffoldAllowedLogins` de `@/lib/config`; `errorBody`, `statusForError` de `@/lib/http`; `auth` (lazy).
- Produces: `GET`, `PUT` handlers.

- [ ] **Step 1: Test que falla** — `app/api/__tests__/storage-provider-route.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ saved: null as string | null }));

vi.mock("@/lib/storage", () => ({
  getStorageProviderState: async () => ({
    available: ["r2", "blob", "fs"],
    active: state.saved ?? "r2",
    source: state.saved ? "preference" : "env",
  }),
}));
vi.mock("@/lib/storage/preference", () => ({
  getStoragePreferenceStore: () => ({
    save: async (p: string) => {
      state.saved = p;
    },
  }),
}));
vi.mock("@/lib/storage/provider", () => ({
  availableProviders: () => ["r2", "blob", "fs"],
  isStorageProvider: (v: unknown) => v === "r2" || v === "blob" || v === "fs",
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/storage-provider/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "<owner>";

function putReq(body: unknown): Request {
  return new Request("http://x/api/storage-provider", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.saved = null;
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  authMock.mockResolvedValue({ githubLogin: ADMIN });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("GET /api/storage-provider", () => {
  it("devuelve available/active/source", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      available: ["r2", "blob", "fs"],
      active: "r2",
      source: "env",
    });
  });
});

describe("PUT /api/storage-provider", () => {
  it("200 y persiste (admin)", async () => {
    const res = await PUT(putReq({ provider: "blob" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ provider: "blob", active: "blob", source: "preference" });
    expect(state.saved).toBe("blob");
  });
  it("403 sin admin (no persiste)", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    const res = await PUT(putReq({ provider: "blob" }));
    expect(res.status).toBe(403);
    expect(state.saved).toBeNull();
  });
  it("400 provider inválido / no disponible", async () => {
    const res = await PUT(putReq({ provider: "s3" }));
    expect(res.status).toBe(400);
    expect(state.saved).toBeNull();
  });
});
```

- [ ] **Step 2: Correr — falla.**

- [ ] **Step 3: `app/api/storage-provider/route.ts`**

```ts
import { NextResponse } from "next/server";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { getStorageProviderState } from "@/lib/storage";
import { getStoragePreferenceStore } from "@/lib/storage/preference";
import { availableProviders, isStorageProvider } from "@/lib/storage/provider";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * GET /api/storage-provider — current storage selection (no secrets).
 * Returns { available, active, source }. Público (solo estado).
 */
export async function GET(): Promise<NextResponse> {
  try {
    return NextResponse.json(await getStorageProviderState(), { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}

/**
 * PUT /api/storage-provider — set the active provider (admin, canScaffold).
 * Body { provider }. 400 si no es un provider disponible (sin creds → no se activa).
 */
export async function PUT(req: Request): Promise<NextResponse> {
  try {
    // Lazy (evita el crash de next-auth/Next-16 al importarse en el grafo de tests).
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const body = (await req.json().catch(() => null)) as { provider?: unknown } | null;
    const provider = body?.provider;
    if (!isStorageProvider(provider) || !availableProviders().includes(provider)) {
      return NextResponse.json({ error: "provider not available" }, { status: 400 });
    }
    await getStoragePreferenceStore().save(provider);
    return NextResponse.json(
      { provider, active: provider, source: "preference" },
      { status: 200 },
    );
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
```

- [ ] **Step 4: Correr — pasa** + suite completa + `npx tsc --noEmit`.
- [ ] **Step 5: Commit**

```bash
git add app/api/storage-provider/route.ts app/api/__tests__/storage-provider-route.test.ts
git commit  # feat(api): GET/PUT /api/storage-provider (admin sets active storage)  (+ trailer)
```

---

### Task 5: UI — control en el catálogo (solo admin)

**Files:**
- Create: `app/components/StorageProviderControl.tsx`
- Modify: `app/catalog/page.tsx` (montar el control si `canScaffold`)
- Modify: `app/globals.css` (estilos `.storage-control*` — buscar el archivo de CSS global; si el nombre difiere, usar el que importa `app/layout.tsx`)
- Test: `app/components/__tests__/StorageProviderControl.test.tsx`

**Interfaces:**
- Consumes: `getStorageProviderState` de `@/lib/storage`; `canScaffold` de `@/lib/scaffold-authz`; `scaffoldAllowedLogins` de `@/lib/config`; `auth` (ya importado en la page).
- Produces: `StorageProviderControl({ available, active, source })` (client component).

- [ ] **Step 1: Test que falla** — `app/components/__tests__/StorageProviderControl.test.tsx`

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { StorageProviderControl } from "@/app/components/StorageProviderControl";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

describe("StorageProviderControl", () => {
  it("renderiza un radio por provider disponible con labels legibles", () => {
    render(<StorageProviderControl available={["r2", "blob"]} active="r2" source="env" />);
    expect(screen.getByLabelText("Cloudflare R2")).toBeInTheDocument();
    expect(screen.getByLabelText("Vercel Blob")).toBeInTheDocument();
  });
  it("el radio del activo arranca seleccionado", () => {
    render(<StorageProviderControl available={["r2", "blob"]} active="blob" source="preference" />);
    expect(screen.getByLabelText("Vercel Blob")).toBeChecked();
  });
  it("Guardar arranca deshabilitado (elegido == activo)", () => {
    render(<StorageProviderControl available={["r2", "blob"]} active="r2" source="env" />);
    expect(screen.getByRole("button", { name: /Guardar/ })).toBeDisabled();
  });
});
```

- [ ] **Step 2: Correr — falla.**

- [ ] **Step 3: `app/components/StorageProviderControl.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const LABELS: Record<string, string> = {
  r2: "Cloudflare R2",
  blob: "Vercel Blob",
  fs: "Local (dev)",
};

export function StorageProviderControl({
  available,
  active,
  source,
}: {
  available: string[];
  active: string;
  source: string;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState(active);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(): Promise<void> {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/storage-provider", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: choice }),
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="storage-control">
      <span className="storage-control-label">Storage:</span>
      {available.map((p) => (
        <label key={p} className="storage-radio">
          <input
            type="radio"
            name="storage-provider"
            value={p}
            checked={choice === p}
            onChange={() => {
              setChoice(p);
              setSaved(false);
            }}
          />
          {LABELS[p] ?? p}
        </label>
      ))}
      <button
        type="button"
        className="btn btn-sm"
        onClick={save}
        disabled={saving || choice === active}
      >
        {saving ? "Guardando…" : "Guardar"}
      </button>
      {saved && <span className="storage-saved">Guardado ✓</span>}
      <span className="storage-source">{source === "preference" ? "(override)" : "(por env)"}</span>
    </div>
  );
}
```

- [ ] **Step 4: Montar en `app/catalog/page.tsx`** — agregar imports y render.

Imports (junto a los existentes):
```ts
import { canScaffold } from "@/lib/scaffold-authz";
import { scaffoldAllowedLogins } from "@/lib/config";
import { getStorageProviderState } from "@/lib/storage";
import { StorageProviderControl } from "@/app/components/StorageProviderControl";
```
En el cuerpo, después de `const session = await auth();`:
```ts
  const canAdmin = canScaffold(session?.githubLogin, scaffoldAllowedLogins());
  const storageState = canAdmin ? await getStorageProviderState() : null;
```
Dentro del `<div className="console">`, justo arriba de `<div className="console-top">`, o dentro del bloque de padding — renderizar el control encima del `CatalogList`:
```tsx
        <div style={{ padding: "6px 0" }}>
          {storageState !== null && (
            <div style={{ padding: "0 0 10px" }}>
              <StorageProviderControl {...storageState} />
            </div>
          )}
          <CatalogList entries={entries} statusById={statusById} driftById={driftById} />
        </div>
```

- [ ] **Step 5: Estilos** — agregar al CSS global (el que importa `app/layout.tsx`):

```css
.storage-control {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  font-size: 13px;
  color: var(--muted, #94a3b8);
}
.storage-control-label {
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  font-size: 11px;
}
.storage-radio {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  cursor: pointer;
}
.btn-sm {
  padding: 3px 12px;
  font-size: 12px;
}
.storage-saved {
  color: var(--ok, #22c55e);
}
.storage-source {
  opacity: 0.7;
  font-size: 11px;
}
```
> Si `app/globals.css` no existe, buscá el CSS que importa `app/layout.tsx` y agregalo ahí. Reutilizá las variables de color existentes si tienen otro nombre (mirá cómo `.drift-badge` referencia colores).

- [ ] **Step 6: Correr — pasa** (`npx vitest run app/components/__tests__/StorageProviderControl.test.tsx`) + suite completa + `npx tsc --noEmit` + `npx next build`.
- [ ] **Step 7: Commit**

```bash
git add app/components/StorageProviderControl.tsx app/catalog/page.tsx app/components/__tests__/StorageProviderControl.test.tsx
git add -A   # incluir el CSS global modificado
git commit  # feat(ui): admin storage provider selector on the catalog  (+ trailer)
```

---

## Cierre (post-tasks, controller)

1. Review final whole-branch (base = commit previo a Task 1).
2. `npx tsc --noEmit && npx vitest run && npx next build` — todo verde.
3. **Push.**

## Operacional (fuera del plan)
- No requiere env vars nuevas. Con R2 y Blob ambos configurados, el admin puede cortar
  entre ellos desde el catálogo. Sin preferencia guardada, sigue el env-order (R2 primero) —
  idéntico a hoy.
- Probar en prod: abrir `/catalog` como admin → cambiar a Blob → Guardar → el próximo publish
  usa Blob (si Blob está activo/no suspendido). Volver a R2 igual.
