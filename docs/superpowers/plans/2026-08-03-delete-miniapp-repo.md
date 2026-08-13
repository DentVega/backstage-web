# Eliminar miniapp + repo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Desde Backstage, un admin elimina una miniapp y opcionalmente su repo de GitHub, con confirmación tipeando el id.

**Architecture:** `GitProvider.deleteRepo` nuevo (github + mock); el `DELETE /api/miniapps/:id` acepta `?repo=true` y borra el repo (orden repo→registry, fail-safe); control de UI "Zona de peligro" en el detalle.

**Tech Stack:** TypeScript, Next.js 16, Vitest, @testing-library/react, GitHub REST API.

## Global Constraints

- **Owner:** <owner>. **Repo:** `backstage-web`. Commits **locales** (push tras la review final). Directo a `main`.
- **Retrocompatible:** sin `?repo=true`, el DELETE hace exactamente lo de hoy (solo registry). Los tests existentes de `miniapp-delete-route.test.ts` siguen verdes.
- **Orden repo→registry:** con `?repo=true`, se borra el repo primero; si falla (token sin `delete_repo`) → **403 con mensaje claro y registry intacto**. Repo ya borrado (404 GitHub) → no es error, sigue.
- **Auth:** `canScaffold` (admin), igual que el DELETE actual.
- **Confirmación:** el botón se habilita solo si el texto tipeado === id.
- `deleteRepo` firma: `deleteRepo(input: { owner: string; repo: string }): Promise<{ deleted: boolean }>`.
- Headers GitHub: `Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, `X-GitHub-Api-Version: 2022-11-28` (igual que el resto de github.ts).
- Commits con **paths explícitos**; trailer en cada commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```

---

### Task 1: `GitProvider.deleteRepo`

**Files:**
- Modify: `lib/git/types.ts` (sumar `deleteRepo` al interface)
- Modify: `lib/git/github.ts` (impl)
- Modify: `lib/git/mock.ts` (no-op)
- Test: `lib/git/__tests__/delete-repo.test.ts`

**Interfaces:**
- Produces: `GitProvider.deleteRepo({ owner, repo }): Promise<{ deleted: boolean }>`.

- [ ] **Step 1: Test que falla** — `lib/git/__tests__/delete-repo.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { githubProvider } from "@/lib/git/github";
import { GitProviderError } from "@/lib/git/types";

function mockFetch(status: number) {
  return vi.fn(async () => ({ status, ok: status >= 200 && status < 300, text: async () => "" }));
}

afterEach(() => vi.unstubAllGlobals());

describe("githubProvider.deleteRepo", () => {
  it("204 → { deleted: true } y llama DELETE al repo correcto", async () => {
    const f = mockFetch(204);
    vi.stubGlobal("fetch", f);
    const res = await githubProvider("tok").deleteRepo({ owner: "<owner>", repo: "miniapp-x" });
    expect(res).toEqual({ deleted: true });
    expect(f).toHaveBeenCalledWith(
      "https://api.github.com/repos/<owner>/miniapp-x",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
  it("404 → { deleted: false } (idempotente, no lanza)", async () => {
    vi.stubGlobal("fetch", mockFetch(404));
    expect(await githubProvider("tok").deleteRepo({ owner: "o", repo: "r" })).toEqual({ deleted: false });
  });
  it("403 → GitProviderError mencionando delete_repo", async () => {
    vi.stubGlobal("fetch", mockFetch(403));
    await expect(githubProvider("tok").deleteRepo({ owner: "o", repo: "r" })).rejects.toThrow(/delete_repo/);
  });
  it("500 → GitProviderError", async () => {
    vi.stubGlobal("fetch", mockFetch(500));
    await expect(githubProvider("tok").deleteRepo({ owner: "o", repo: "r" })).rejects.toBeInstanceOf(GitProviderError);
  });
});
```

- [ ] **Step 2: Correr — falla** (`npx vitest run lib/git/__tests__/delete-repo.test.ts`).

- [ ] **Step 3: types.ts** — dentro del `interface GitProvider`, agregar:
```ts
  /** Delete a GitHub repo. 404 → { deleted: false } (idempotent); 403 (no scope) throws. */
  deleteRepo(input: { owner: string; repo: string }): Promise<{ deleted: boolean }>;
```

- [ ] **Step 4: github.ts** — agregar el método al objeto que devuelve `githubProvider` (junto a los otros):
```ts
    async deleteRepo(input: { owner: string; repo: string }): Promise<{ deleted: boolean }> {
      const res = await fetch(`https://api.github.com/repos/${input.owner}/${input.repo}`, {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });
      if (res.status === 204) return { deleted: true };
      if (res.status === 404) return { deleted: false }; // ya no existe → idempotente
      if (res.status === 403) {
        throw new GitProviderError(
          "repo delete forbidden: el token del server no tiene el scope delete_repo",
        );
      }
      const detail = await res.text().catch(() => "");
      throw new GitProviderError(`repo delete failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
    },
```

- [ ] **Step 5: mock.ts** — agregar al objeto de `mockProvider`:
```ts
    async deleteRepo(): Promise<{ deleted: boolean }> {
      return { deleted: true };
    },
```

- [ ] **Step 6: Correr — pasa** + `npx tsc --noEmit` limpio.
- [ ] **Step 7: Commit**
```bash
git add lib/git/types.ts lib/git/github.ts lib/git/mock.ts lib/git/__tests__/delete-repo.test.ts
git commit  # feat(git): GitProvider.deleteRepo (204 ok / 404 idempotent / 403 no-scope)  (+ trailer)
```

---

### Task 2: Endpoint — `DELETE /api/miniapps/:id?repo=true`

**Files:**
- Modify: `app/api/miniapps/[id]/route.ts`
- Test: `app/api/__tests__/miniapp-delete-route.test.ts` (extender)

**Interfaces:**
- Consumes: `githubProvider` (`@/lib/git/github`), `githubToken` (`@/lib/config`), `parseRepo` (`@/lib/git/miniapp-dispatch`), `MiniappNotFoundError` (`@/lib/registry/types`), `GitProviderError` (`@/lib/git/types`).

- [ ] **Step 1: Extender el test** — en `app/api/__tests__/miniapp-delete-route.test.ts`.

Agregar al tope los mocks del git provider + token (después de los mocks existentes de store/auth):
```ts
const gitState = vi.hoisted(() => ({
  result: { deleted: true } as { deleted: boolean },
  error: null as Error | null,
  calls: [] as { owner: string; repo: string }[],
}));
vi.mock("@/lib/git/github", () => ({
  githubProvider: () => ({
    deleteRepo: async (input: { owner: string; repo: string }) => {
      gitState.calls.push(input);
      if (gitState.error) throw gitState.error;
      return gitState.result;
    },
  }),
}));
```
En el `beforeEach`, dar repoUrl a los records + resetear gitState + set token:
```ts
  state.reg = {
    test_prod: {
      id: "test_prod" as never, name: "Test", owner: "o", versions: [],
      repoUrl: "https://github.com/<owner>/miniapp-test_prod",
    },
    cards_wallet: { id: "cards_wallet" as never, name: "Cards", owner: "o", versions: [] },
  } as never;
  process.env.GITHUB_TOKEN = "tok";
  gitState.result = { deleted: true };
  gitState.error = null;
  gitState.calls = [];
```
(Importar `GitProviderError` arriba: `import { GitProviderError } from "@/lib/git/types";`)

Helper para el request con query:
```ts
function reqRepo(id: string): Request {
  return new Request(`http://x/api/miniapps/${id}?repo=true`, { method: "DELETE" });
}
```

Casos nuevos (los existentes NO se tocan):
```ts
  it("?repo=true: borra el repo (owner/repo del repoUrl) + la entrada", async () => {
    const res = await DELETE(reqRepo("test_prod"), params("test_prod"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: true, repoDeleted: true });
    expect(gitState.calls[0]).toEqual({ owner: "<owner>", repo: "miniapp-test_prod" });
    expect(state.reg.test_prod).toBeUndefined();
  });
  it("?repo=true con repo ya borrado (deleted:false) → 200 y borra el registry igual", async () => {
    gitState.result = { deleted: false };
    const res = await DELETE(reqRepo("test_prod"), params("test_prod"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ repoDeleted: false });
    expect(state.reg.test_prod).toBeUndefined();
  });
  it("?repo=true y el borrado del repo falla → 403 y NO borra el registry", async () => {
    gitState.error = new GitProviderError("delete_repo");
    const res = await DELETE(reqRepo("test_prod"), params("test_prod"));
    expect(res.status).toBe(403);
    expect(state.reg.test_prod).toBeDefined(); // intacto
  });
  it("?repo=true sin repoUrl en el record → 400, registry intacto", async () => {
    const res = await DELETE(reqRepo("cards_wallet"), params("cards_wallet"));
    expect(res.status).toBe(400);
    expect(state.reg.cards_wallet).toBeDefined();
  });
```

- [ ] **Step 2: Correr — falla.**

- [ ] **Step 3: `app/api/miniapps/[id]/route.ts`** — reemplazar el archivo entero:

```ts
import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";
import { removeMiniapp } from "@/lib/registry/registry";
import { MiniappNotFoundError } from "@/lib/registry/types";
import { scaffoldAllowedLogins, githubToken } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { githubProvider } from "@/lib/git/github";
import { parseRepo } from "@/lib/git/miniapp-dispatch";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * DELETE /api/miniapps/:id — remove a miniapp (admin, canScaffold).
 * Default: solo la entrada del registry (comportamiento histórico).
 * Con `?repo=true`: además borra el repo de GitHub (orden repo→registry, fail-safe —
 * si el repo no se puede borrar, aborta sin tocar el registry). NO borra los chunks del CDN.
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    // Lazy (evita el crash de next-auth/Next-16 en el grafo de tests).
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const { id } = await params;
    const alsoRepo = new URL(req.url).searchParams.get("repo") === "true";
    const reg = await getStore().load();

    let repoDeleted: boolean | undefined;
    if (alsoRepo) {
      const record = reg[id];
      if (record === undefined) throw new MiniappNotFoundError(id);
      const parsed = parseRepo(record.repoUrl);
      if (parsed === null) {
        return NextResponse.json(
          { error: "miniapp has no valid repo URL to delete" },
          { status: 400 },
        );
      }
      try {
        const result = await githubProvider(githubToken()).deleteRepo(parsed);
        repoDeleted = result.deleted;
      } catch (err) {
        // Fail-safe: no tocar el registry si el repo no se pudo borrar.
        return NextResponse.json(
          {
            error:
              err instanceof Error
                ? err.message
                : "repo delete failed (¿el token del server tiene delete_repo?)",
            code: "REPO_DELETE_FAILED",
          },
          { status: 403 },
        );
      }
    }

    const next = removeMiniapp(reg, id);
    await getStore().save(next);
    return NextResponse.json(
      alsoRepo ? { id, deleted: true, repoDeleted } : { id, deleted: true },
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
git add app/api/miniapps/\[id\]/route.ts app/api/__tests__/miniapp-delete-route.test.ts
git commit  # feat(api): DELETE ?repo=true also deletes the GitHub repo (repo-first, fail-safe)  (+ trailer)
```

---

### Task 3: UI — "Zona de peligro" en el detalle

**Files:**
- Create: `app/components/MiniappDeleteControl.tsx`
- Modify: `app/miniapp/[id]/page.tsx` (montar en el bloque admin)
- Modify: `app/globals.css` (estilos `.danger-*` / `.btn-danger`)
- Test: `app/components/__tests__/MiniappDeleteControl.test.tsx`

**Interfaces:**
- Produces: `MiniappDeleteControl({ id: string; hasRepo: boolean })`.

- [ ] **Step 1: Test que falla** — `app/components/__tests__/MiniappDeleteControl.test.tsx`

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MiniappDeleteControl } from "@/app/components/MiniappDeleteControl";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

describe("MiniappDeleteControl", () => {
  it("el botón se habilita solo al tipear el id exacto", () => {
    render(<MiniappDeleteControl id="cards_wallet" hasRepo={true} />);
    const btn = screen.getByRole("button", { name: /Eliminar/ });
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Confirmar id de la miniapp"), {
      target: { value: "cards_wallet" },
    });
    expect(btn).toBeEnabled();
  });
  it("el checkbox de repo se muestra solo si hasRepo", () => {
    const { rerender } = render(<MiniappDeleteControl id="x" hasRepo={false} />);
    expect(screen.queryByLabelText(/borrar el repositorio/i)).toBeNull();
    rerender(<MiniappDeleteControl id="x" hasRepo={true} />);
    expect(screen.getByLabelText(/borrar el repositorio/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Correr — falla.**

- [ ] **Step 3: `app/components/MiniappDeleteControl.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MiniappDeleteControl({ id, hasRepo }: { id: string; hasRepo: boolean }) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [deleteRepo, setDeleteRepo] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function del(): Promise<void> {
    setDeleting(true);
    setError(null);
    try {
      const repo = deleteRepo && hasRepo;
      const res = await fetch(`/api/miniapps/${id}?repo=${repo}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/catalog");
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Error ${res.status}`);
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="danger-zone">
      <p className="danger-hint">
        Esto es irreversible. Escribí <code>{id}</code> para confirmar.
      </p>
      <input
        className="danger-input"
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={id}
        aria-label="Confirmar id de la miniapp"
      />
      {hasRepo && (
        <label className="danger-check">
          <input
            type="checkbox"
            checked={deleteRepo}
            onChange={(e) => setDeleteRepo(e.target.checked)}
          />
          También borrar el repositorio de GitHub
        </label>
      )}
      <button
        type="button"
        className="btn btn-danger"
        onClick={del}
        disabled={deleting || confirmText !== id}
      >
        {deleting ? "Eliminando…" : "Eliminar miniapp"}
      </button>
      {error && (
        <p className="danger-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Montar en `app/miniapp/[id]/page.tsx`** — imports:
```ts
import { MiniappDeleteControl } from "@/app/components/MiniappDeleteControl";
```
Dentro del bloque `canPublish ? ( <> ... </> )`, como **última** sección (después de "Publicar versión"):
```tsx
          <section className="detail-section danger-section">
            <h2>Zona de peligro</h2>
            <MiniappDeleteControl id={id} hasRepo={detail.repoUrl !== undefined} />
          </section>
```

- [ ] **Step 5: Estilos** — agregar al final de `app/globals.css`:
```css
/* Danger zone — eliminar miniapp */
.danger-section h2 { color: var(--danger, #dc4c4c); }
.danger-zone {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
  border: 1px solid color-mix(in srgb, var(--danger, #dc4c4c) 40%, transparent);
  border-radius: 12px;
  padding: 16px;
}
.danger-hint { font-size: 13px; color: var(--muted); margin: 0; }
.danger-input {
  font-family: var(--mono, monospace);
  padding: 7px 10px;
  border-radius: 8px;
  border: 1px solid var(--line, #333);
  background: var(--surface, transparent);
  color: var(--text);
  min-width: 240px;
}
.danger-check { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; }
.btn-danger {
  background: var(--danger, #dc4c4c);
  color: #fff;
  padding: 8px 16px;
}
.btn-danger:disabled { opacity: .5; cursor: default; }
.danger-error { color: var(--danger, #dc4c4c); font-size: 13px; margin: 0; }
```
> Reutilizá una var `--danger`/`--line`/`--surface`/`--mono` si ya existe en `:root` (mirá el bloque de variables arriba); si no, los fallbacks del `color-mix`/literales alcanzan.

- [ ] **Step 6: Correr — pasa** (`npx vitest run app/components/__tests__/MiniappDeleteControl.test.tsx`) + suite completa + `npx tsc --noEmit` + `npx next build`.
- [ ] **Step 7: Commit**
```bash
git add app/components/MiniappDeleteControl.tsx app/miniapp/\[id\]/page.tsx app/components/__tests__/MiniappDeleteControl.test.tsx app/globals.css
git commit  # feat(ui): danger-zone delete control (typed confirm + repo checkbox)  (+ trailer)
```

---

## Cierre (post-tasks, controller)

1. Review final whole-branch (base = commit previo a Task 1).
2. `npx tsc --noEmit && npx vitest run && npx next build` — todo verde.
3. **Push.**

## Operacional (fuera del plan)
- Para que el borrado del repo funcione, el `GITHUB_TOKEN` de Vercel (production) necesita el
  scope **`delete_repo`**. Sin eso, el borrado del registry anda, pero el del repo da 403 con
  mensaje claro. Agregar el scope + redeploy cuando se quiera activar.
