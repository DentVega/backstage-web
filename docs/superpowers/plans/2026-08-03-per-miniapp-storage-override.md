# Override de storage por miniapp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada miniapp puede pinnear su propio storage provider (o usar el default global); al publicar se resuelve override → default global → env.

**Architecture:** El override vive en el `MiniappRecord` del registry (`storageProvider?`). `getStorage(override?)` y `getMiniappStorageState(override)` reutilizan el estado global de la Fase B. Endpoint `PUT /api/miniapps/[id]/storage-provider` (admin) setea/limpia el campo. Control en la página de detalle.

**Tech Stack:** TypeScript, Next.js 16, Vitest, @testing-library/react, registry KV/JSON store.

## Global Constraints

- **Owner:** DentVega. **Repo:** `backstage-web`. Commits **locales** (push tras la review final). Directo a `main`.
- **Precedencia:** override de la miniapp (si su provider está en `availableProviders()`) → default global (`getStorageProviderState().active`) → env-order[0]. Fallback seguro en cada nivel.
- **`StorageProvider = "r2" | "blob" | "fs"`** (ya existe en `lib/storage/provider.ts`). En `registry` importarlo **type-only** (`import type`), sin acoplar runtime.
- **Auth:** el PUT exige `canScaffold(session?.githubLogin, scaffoldAllowedLogins())` (403 si no); lazy `await import("@/auth")`.
- **Limpiar override:** `provider: null` en el PUT borra el campo (vuelve al default).
- Errores de ruta → `errorBody`/`statusForError` (de `@/lib/http`). `MiniappNotFoundError` → 404.
- El estado que expone la UI se llama **`defaultProvider`** (no `default`: palabra reservada).
- Commits con **paths explícitos**; trailer en cada commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```

---

### Task 1: Registry — campo `storageProvider` + `setMiniappStorageProvider`

**Files:**
- Modify: `lib/registry/types.ts` (agregar `storageProvider?` a `MiniappRecord` y `MiniappDetail`)
- Modify: `lib/registry/registry.ts` (`setMiniappStorageProvider` + proyección en `getMiniappDetail`)
- Test: `lib/registry/__tests__/storage-provider.test.ts`

**Interfaces:**
- Consumes: `parseMiniappId`, `MiniappId` de `@dentvega/miniapp-contract`; `InvalidManifestError`, `MiniappNotFoundError` de `./types`; `type StorageProvider` de `@/lib/storage/provider`.
- Produces: `MiniappRecord.storageProvider?: StorageProvider`, `MiniappDetail.storageProvider?: StorageProvider`, `setMiniappStorageProvider(reg, rawId, provider: StorageProvider | null): Registry`.

- [ ] **Step 1: Test que falla** — `lib/registry/__tests__/storage-provider.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { setMiniappStorageProvider, getMiniappDetail } from "@/lib/registry/registry";
import { MiniappNotFoundError } from "@/lib/registry/types";
import type { Registry } from "@/lib/registry/types";

function baseReg(): Registry {
  return {
    cards_wallet: { id: "cards_wallet", name: "Cards", owner: "o", versions: [] },
    hellow_widget: { id: "hellow_widget", name: "Hi", owner: "o", versions: [] },
  } as unknown as Registry;
}

describe("setMiniappStorageProvider", () => {
  it("setea el provider en la miniapp", () => {
    const next = setMiniappStorageProvider(baseReg(), "cards_wallet", "blob");
    expect(next.cards_wallet.storageProvider).toBe("blob");
  });
  it("null limpia el override (borra el campo)", () => {
    const withPref = setMiniappStorageProvider(baseReg(), "cards_wallet", "blob");
    const cleared = setMiniappStorageProvider(withPref, "cards_wallet", null);
    expect(cleared.cards_wallet.storageProvider).toBeUndefined();
    expect("storageProvider" in cleared.cards_wallet).toBe(false);
  });
  it("no toca otras miniapps", () => {
    const next = setMiniappStorageProvider(baseReg(), "cards_wallet", "r2");
    expect(next.hellow_widget.storageProvider).toBeUndefined();
  });
  it("no muta el registry original", () => {
    const reg = baseReg();
    setMiniappStorageProvider(reg, "cards_wallet", "blob");
    expect(reg.cards_wallet.storageProvider).toBeUndefined();
  });
  it("MiniappNotFoundError si el id no existe", () => {
    expect(() => setMiniappStorageProvider(baseReg(), "ghost", "r2")).toThrow(MiniappNotFoundError);
  });
});

describe("getMiniappDetail — storageProvider", () => {
  it("incluye el override cuando el record lo tiene", () => {
    const reg = setMiniappStorageProvider(baseReg(), "cards_wallet", "blob");
    expect(getMiniappDetail(reg, "cards_wallet").storageProvider).toBe("blob");
  });
  it("lo omite cuando no está", () => {
    expect(getMiniappDetail(baseReg(), "cards_wallet").storageProvider).toBeUndefined();
  });
});
```

- [ ] **Step 2: Correr — falla** (`npx vitest run lib/registry/__tests__/storage-provider.test.ts`).

- [ ] **Step 3: Tipos** — en `lib/registry/types.ts`:
  - Agregar arriba (junto a los imports de tipo): `import type { StorageProvider } from "@/lib/storage/provider";`
  - En `MiniappRecord`, después de `repoUrl?`:
    ```ts
    /** Provider de storage pinneado para esta miniapp; undefined = usa el default global. */
    readonly storageProvider?: StorageProvider;
    ```
  - En `MiniappDetail`, después de `repoUrl?`:
    ```ts
    readonly storageProvider?: StorageProvider;
    ```

- [ ] **Step 4: Función + proyección** — en `lib/registry/registry.ts`:
  - Agregar el import type (junto a los imports existentes): `import type { StorageProvider } from "@/lib/storage/provider";`
  - Agregar la función (cerca de `removeMiniapp`):
    ```ts
    /** Set (or clear, with null) the per-miniapp storage provider override. Throws if it doesn't exist. */
    export function setMiniappStorageProvider(
      reg: Registry,
      rawId: string,
      provider: StorageProvider | null,
    ): Registry {
      const id = parseMiniappId(rawId);
      if (id === null) throw new InvalidManifestError(`bad miniapp id "${rawId}"`);
      const record = reg[id];
      if (record === undefined) throw new MiniappNotFoundError(id);
      if (provider === null) {
        const next = { ...record };
        delete (next as { storageProvider?: StorageProvider }).storageProvider;
        return { ...reg, [id]: next };
      }
      return { ...reg, [id]: { ...record, storageProvider: provider } };
    }
    ```
  - En `getMiniappDetail`, dentro del objeto retornado, después de la línea de `repoUrl`:
    ```ts
    ...(record.storageProvider !== undefined ? { storageProvider: record.storageProvider } : {}),
    ```

- [ ] **Step 5: Correr — pasa** + `npx tsc --noEmit` limpio.
- [ ] **Step 6: Commit**

```bash
git add lib/registry/types.ts lib/registry/registry.ts lib/registry/__tests__/storage-provider.test.ts
git commit  # feat(registry): per-miniapp storageProvider override + setMiniappStorageProvider  (+ trailer)
```

---

### Task 2: Storage — `getStorage(override)` + `getMiniappStorageState`

**Files:**
- Modify: `lib/storage/index.ts`
- Modify: `app/api/miniapps/[id]/upload/route.ts` (pasar el override de la miniapp)
- Modify: `lib/storage/__tests__/select.test.ts` (casos de override)

**Interfaces:**
- Consumes: `getStorageProviderState` (ya existe), `buildStorage` (interno), `StorageProvider`.
- Produces: `getStorage(miniappOverride?: StorageProvider | null): Promise<ChunkStorage>`, `getMiniappStorageState(miniappOverride: StorageProvider | null): Promise<{ available: StorageProvider[]; override: StorageProvider | null; defaultProvider: StorageProvider; effective: StorageProvider; source: "miniapp" | "preference" | "env" }>`.

- [ ] **Step 1: Extender el test** — agregar al final de `lib/storage/__tests__/select.test.ts` (y actualizar el import de `@/lib/storage`):

Cambiar el import a:
```ts
import { getStorage, getStorageProviderState, getMiniappStorageState } from "@/lib/storage";
```
Agregar estos bloques al final del archivo:
```ts
describe("getStorage — override por miniapp", () => {
  it("el override gana si está disponible", async () => {
    process.env.R2_ACCOUNT_ID = "a";
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    expect(kind(await getStorage("blob"))).toBe("blob");
  });
  it("override no disponible → cae al default global", async () => {
    process.env.R2_ACCOUNT_ID = "a"; // blob NO configurado
    expect(kind(await getStorage("blob"))).toBe("r2");
  });
});

describe("getMiniappStorageState", () => {
  it("override aplica → effective=override, source=miniapp", async () => {
    process.env.R2_ACCOUNT_ID = "a";
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    expect(await getMiniappStorageState("blob")).toEqual({
      available: ["r2", "blob", "fs"],
      override: "blob",
      defaultProvider: "r2",
      effective: "blob",
      source: "miniapp",
    });
  });
  it("sin override → effective=default global, source=env", async () => {
    process.env.R2_ACCOUNT_ID = "a";
    expect(await getMiniappStorageState(null)).toEqual({
      available: ["r2", "fs"],
      override: null,
      defaultProvider: "r2",
      effective: "r2",
      source: "env",
    });
  });
});
```
> `getStorageProviderState` sigue importado porque los tests de la Fase B (más arriba en el archivo) lo usan. No borrar esos bloques.

- [ ] **Step 2: Correr — falla** (no existe `getMiniappStorageState`; `getStorage` no acepta arg).

- [ ] **Step 3: `lib/storage/index.ts`** — reemplazar las funciones `getStorageProviderState`/`getStorage` (dejar `buildStorage` y los imports como están; `getStorageProviderState` no cambia) agregando lo nuevo:

Mantener `buildStorage` y `getStorageProviderState` tal cual. Reemplazar `getStorage` y agregar `getMiniappStorageState`:
```ts
/** Per-miniapp storage state: override vs global default, with the effective provider. */
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

/** Storage for a publish: miniapp override (if valid) → global default → env-order. */
export async function getStorage(miniappOverride: StorageProvider | null = null): Promise<ChunkStorage> {
  const { effective } = await getMiniappStorageState(miniappOverride);
  return buildStorage(effective);
}
```

- [ ] **Step 4: Upload route** — en `app/api/miniapps/[id]/upload/route.ts`, reemplazar el bloque:
```ts
    const storage = await getStorage();
    const { baseUrl } = await storage.putMany(`${id}/${version}`, files);
    const url = `${baseUrl}/${containerName}`;

    const reg = await getStore().load();
    const next = publishVersion(reg, id, { version, url, manifest }, new Date().toISOString());
```
por (mueve el `load` arriba y lee el override):
```ts
    const reg = await getStore().load();
    const storage = await getStorage(reg[id]?.storageProvider ?? null);
    const { baseUrl } = await storage.putMany(`${id}/${version}`, files);
    const url = `${baseUrl}/${containerName}`;

    const next = publishVersion(reg, id, { version, url, manifest }, new Date().toISOString());
```

- [ ] **Step 5: Correr — pasa** (`npx vitest run lib/storage/__tests__/select.test.ts`) + suite completa + `npx tsc --noEmit` + `npx next build`.
- [ ] **Step 6: Commit**

```bash
git add lib/storage/index.ts app/api/miniapps/\[id\]/upload/route.ts lib/storage/__tests__/select.test.ts
git commit  # feat(storage): getStorage(override) + getMiniappStorageState; upload uses per-miniapp override  (+ trailer)
```

---

### Task 3: Endpoint `PUT /api/miniapps/[id]/storage-provider`

**Files:**
- Create: `app/api/miniapps/[id]/storage-provider/route.ts`
- Test: `app/api/__tests__/miniapp-storage-provider-route.test.ts`

**Interfaces:**
- Consumes: `getStore` de `@/lib/registry/store`; `setMiniappStorageProvider` de `@/lib/registry/registry`; `getMiniappStorageState` de `@/lib/storage`; `availableProviders`, `isStorageProvider` de `@/lib/storage/provider`; `canScaffold`, `ScaffoldForbiddenError`, `scaffoldAllowedLogins`, `errorBody`, `statusForError`; `auth` (lazy).
- Produces: `PUT` handler.

- [ ] **Step 1: Test que falla** — `app/api/__tests__/miniapp-storage-provider-route.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ reg: {} as Record<string, { id: string; name: string; owner: string; versions: []; storageProvider?: string }> }));

vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({
    load: async () => state.reg,
    save: async (r: typeof state.reg) => {
      state.reg = r;
    },
  }),
}));
vi.mock("@/lib/storage", () => ({
  getMiniappStorageState: async (override: string | null) => ({
    available: ["r2", "blob", "fs"],
    override,
    defaultProvider: "r2",
    effective: override ?? "r2",
    source: override ? "miniapp" : "env",
  }),
}));
vi.mock("@/lib/storage/provider", () => ({
  availableProviders: () => ["r2", "blob", "fs"],
  isStorageProvider: (v: unknown) => v === "r2" || v === "blob" || v === "fs",
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { PUT } from "@/app/api/miniapps/[id]/storage-provider/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "DentVega";

function putReq(body: unknown): Request {
  return new Request("http://x/api/miniapps/cards_wallet/storage-provider", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.reg = { cards_wallet: { id: "cards_wallet", name: "Cards", owner: "o", versions: [] } };
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  authMock.mockResolvedValue({ githubLogin: ADMIN });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("PUT /api/miniapps/:id/storage-provider", () => {
  it("200 y setea el override (admin)", async () => {
    const res = await PUT(putReq({ provider: "blob" }), params("cards_wallet"));
    expect(res.status).toBe(200);
    expect(state.reg.cards_wallet.storageProvider).toBe("blob");
  });
  it("200 y limpia con provider null", async () => {
    await PUT(putReq({ provider: "blob" }), params("cards_wallet"));
    const res = await PUT(putReq({ provider: null }), params("cards_wallet"));
    expect(res.status).toBe(200);
    expect(state.reg.cards_wallet.storageProvider).toBeUndefined();
  });
  it("400 provider no disponible (no persiste)", async () => {
    const res = await PUT(putReq({ provider: "s3" }), params("cards_wallet"));
    expect(res.status).toBe(400);
    expect(state.reg.cards_wallet.storageProvider).toBeUndefined();
  });
  it("403 sin admin", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    const res = await PUT(putReq({ provider: "blob" }), params("cards_wallet"));
    expect(res.status).toBe(403);
    expect(state.reg.cards_wallet.storageProvider).toBeUndefined();
  });
  it("404 miniapp inexistente", async () => {
    const res = await PUT(putReq({ provider: "blob" }), params("ghost"));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Correr — falla.**

- [ ] **Step 3: `app/api/miniapps/[id]/storage-provider/route.ts`**

```ts
import { NextResponse } from "next/server";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { getStore } from "@/lib/registry/store";
import { setMiniappStorageProvider } from "@/lib/registry/registry";
import { getMiniappStorageState } from "@/lib/storage";
import { availableProviders, isStorageProvider } from "@/lib/storage/provider";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * PUT /api/miniapps/:id/storage-provider — set (or clear with null) this miniapp's
 * storage override (admin, canScaffold). 400 si el provider no está disponible;
 * 404 si la miniapp no existe. Devuelve el estado de storage de la miniapp.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { provider?: unknown } | null;
    const provider = body?.provider ?? null;
    if (provider !== null && (!isStorageProvider(provider) || !availableProviders().includes(provider))) {
      return NextResponse.json({ error: "provider not available" }, { status: 400 });
    }
    const reg = await getStore().load();
    const next = setMiniappStorageProvider(reg, id, provider); // MiniappNotFoundError → 404
    await getStore().save(next);
    return NextResponse.json(await getMiniappStorageState(provider), { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
```

- [ ] **Step 4: Correr — pasa** + suite completa + `npx tsc --noEmit`.
- [ ] **Step 5: Commit**

```bash
git add app/api/miniapps/\[id\]/storage-provider/route.ts app/api/__tests__/miniapp-storage-provider-route.test.ts
git commit  # feat(api): PUT /api/miniapps/:id/storage-provider (admin pins per-miniapp storage)  (+ trailer)
```

---

### Task 4: UI — control en el detalle

**Files:**
- Create: `app/components/MiniappStorageControl.tsx`
- Modify: `app/miniapp/[id]/page.tsx` (montar el control en el bloque admin)
- Test: `app/components/__tests__/MiniappStorageControl.test.tsx`

**Interfaces:**
- Consumes: `getMiniappStorageState` de `@/lib/storage`.
- Produces: `MiniappStorageControl({ id, available, override, defaultProvider, effective, source })`.

- [ ] **Step 1: Test que falla** — `app/components/__tests__/MiniappStorageControl.test.tsx`

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MiniappStorageControl } from "@/app/components/MiniappStorageControl";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

const base = {
  id: "cards_wallet",
  available: ["r2", "blob"],
  defaultProvider: "r2",
  effective: "r2",
  source: "env",
};

describe("MiniappStorageControl", () => {
  it("muestra 'Default (...)' + un radio por available", () => {
    render(<MiniappStorageControl {...base} override={null} />);
    expect(screen.getByLabelText("Default (Cloudflare R2)")).toBeInTheDocument();
    expect(screen.getByLabelText("Cloudflare R2")).toBeInTheDocument();
    expect(screen.getByLabelText("Vercel Blob")).toBeInTheDocument();
  });
  it("sin override → Default seleccionado y Guardar deshabilitado", () => {
    render(<MiniappStorageControl {...base} override={null} />);
    expect(screen.getByLabelText("Default (Cloudflare R2)")).toBeChecked();
    expect(screen.getByRole("button", { name: /Guardar/ })).toBeDisabled();
  });
  it("con override → ese radio seleccionado", () => {
    render(<MiniappStorageControl {...base} override="blob" effective="blob" source="miniapp" />);
    expect(screen.getByLabelText("Vercel Blob")).toBeChecked();
  });
});
```

- [ ] **Step 2: Correr — falla.**

- [ ] **Step 3: `app/components/MiniappStorageControl.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const LABELS: Record<string, string> = {
  r2: "Cloudflare R2",
  blob: "Vercel Blob",
  fs: "Local (dev)",
};
const DEFAULT = "__default__";

export function MiniappStorageControl({
  id,
  available,
  override,
  defaultProvider,
  effective,
  source,
}: {
  id: string;
  available: string[];
  override: string | null;
  defaultProvider: string;
  effective: string;
  source: string;
}) {
  const router = useRouter();
  const current = override ?? DEFAULT;
  const [choice, setChoice] = useState(current);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(): Promise<void> {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/miniapps/${id}/storage-provider`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: choice === DEFAULT ? null : choice }),
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
      <label className="storage-radio">
        <input
          type="radio"
          name={`ms-${id}`}
          value={DEFAULT}
          checked={choice === DEFAULT}
          onChange={() => {
            setChoice(DEFAULT);
            setSaved(false);
          }}
        />
        Default ({LABELS[defaultProvider] ?? defaultProvider})
      </label>
      {available.map((p) => (
        <label key={p} className="storage-radio">
          <input
            type="radio"
            name={`ms-${id}`}
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
        className="btn btn-ghost btn-sm"
        onClick={save}
        disabled={saving || choice === current}
      >
        {saving ? "Guardando…" : "Guardar"}
      </button>
      {saved && <span className="storage-saved">Guardado ✓</span>}
      <span className="storage-source">
        Efectivo: {LABELS[effective] ?? effective} · {source === "miniapp" ? "por miniapp" : "por default"}
      </span>
    </div>
  );
}
```
> Reutiliza las clases `.storage-*` / `.btn-sm` ya agregadas en `app/globals.css` (Fase B). No hace falta CSS nuevo.

- [ ] **Step 4: Montar en `app/miniapp/[id]/page.tsx`**:
  - Imports (junto a los existentes):
    ```ts
    import { getMiniappStorageState } from "@/lib/storage";
    import { MiniappStorageControl } from "@/app/components/MiniappStorageControl";
    ```
  - Después de `const canPublish = ...`:
    ```ts
    const storageState = canPublish
      ? await getMiniappStorageState(detail.storageProvider ?? null)
      : null;
    ```
  - Dentro del bloque `canPublish ? ( <> ... </> )`, agregar una sección (p. ej. después de la de "Deploy"):
    ```tsx
          <section className="detail-section">
            <h2>Almacenamiento</h2>
            {storageState !== null && <MiniappStorageControl id={id} {...storageState} />}
          </section>
    ```

- [ ] **Step 5: Correr — pasa** (`npx vitest run app/components/__tests__/MiniappStorageControl.test.tsx`) + suite completa + `npx tsc --noEmit` + `npx next build`.
- [ ] **Step 6: Commit**

```bash
git add app/components/MiniappStorageControl.tsx app/miniapp/\[id\]/page.tsx app/components/__tests__/MiniappStorageControl.test.tsx
git commit  # feat(ui): per-miniapp storage override control on the detail page  (+ trailer)
```

---

## Cierre (post-tasks, controller)

1. Review final whole-branch (base = commit previo a Task 1).
2. `npx tsc --noEmit && npx vitest run && npx next build` — todo verde.
3. **Push.**

## Operacional (fuera del plan)
- Sin env vars nuevas. En prod, un admin entra a `/miniapp/<id>`, elige "Default" o un provider
  puntual, Guarda → el próximo publish de esa miniapp usa el efectivo. Con R2 y Blob configurados,
  se puede pinnear una miniapp a Blob dejando el resto en R2 (ojo: Blob sigue suspendido).
