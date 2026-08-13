# Fase 3 — Pedido automatizado de capability nativa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando el gate de `/upload` detecta un módulo nativo que el host no provee, **abrir automáticamente un pedido (GitHub issue) contra el repo del host** — con dedup (un issue abierto por lib) — para que plataforma lo agregue. Best-effort/warn-mode: no rompe el publish.

**Architecture:** Backstage tiene el `GITHUB_TOKEN` privilegiado (escribe en el repo del host). Se agrega `ensureIssue` al `GitProvider` (crea el issue solo si no hay uno abierto con el mismo título → dedup). Un módulo `lib/capability-request/` arma título/cuerpo estándar por lib. El gate de `/upload` (que ya computa los missing natives, Fase 2-D) los dispara best-effort. `HOST_REPO` sale de config.

**Tech Stack:** Next.js route handler, TypeScript, Vitest, GitHub REST API (issues), `GitProvider` existente.

## Global Constraints

- **Owner:** DentVega. **Sin dependencias nuevas.**
- **Repo:** `backstage-web`. Commits **locales** (no push).
- **NO rompe el publish:** la apertura de pedidos es best-effort dentro del bloque warn-mode del `/upload` — cualquier fallo → warn, sigue 201.
- **Dedup:** `ensureIssue` NO crea un segundo issue si ya hay uno abierto con el mismo título.
- Al agregar `ensureIssue` al `GitProvider`, **actualizar `lib/git/mock.ts` Y cualquier literal `GitProvider` inline en tests** (si no, no compila) — grep `createFromTemplate:` en tests.
- Commits con **paths explícitos** (no `data/*.json`); trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```
- Tests que importan `@/lib/auth` (transitivo `@/auth`) → `vi.mock("@/auth", ...)`.

---

### Task 1: `HOST_REPO` config + `GitProvider.ensureIssue`

**Files:**
- Modify: `lib/config.ts` (agregar `HOST_REPO`)
- Modify: `lib/git/types.ts` (agregar `EnsureIssueInput` + `ensureIssue` al `GitProvider`)
- Modify: `lib/git/github.ts` (implementar `ensureIssue`)
- Modify: `lib/git/mock.ts` (mock `ensureIssue`)
- Test: `lib/git/__tests__/ensure-issue.test.ts` (nuevo)

**Interfaces:**
- Produces:
  ```ts
  export const HOST_REPO: string; // "owner/repo" del host, de env HOST_REPO
  export interface EnsureIssueInput {
    readonly owner: string; readonly repo: string;
    readonly title: string; readonly body: string;
    readonly labels?: readonly string[];
  }
  // GitProvider gana:
  ensureIssue(input: EnsureIssueInput): Promise<{ created: boolean; url: string }>;
  ```

- [ ] **Step 1: Test que falla** — `lib/git/__tests__/ensure-issue.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { githubProvider } from "@/lib/git/github";

afterEach(() => vi.restoreAllMocks());

const INPUT = { owner: "DentVega", repo: "backstagereactnative", title: "cap: x", body: "b", labels: ["capability-request"] };

describe("githubProvider.ensureIssue", () => {
  it("crea el issue cuando no hay uno abierto con ese título", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] }) // list open issues
      .mockResolvedValueOnce({ ok: true, json: async () => ({ html_url: "https://gh/issues/1" }) }); // create
    vi.stubGlobal("fetch", fetchMock);
    const r = await githubProvider("tok").ensureIssue(INPUT);
    expect(r).toEqual({ created: true, url: "https://gh/issues/1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
  });

  it("NO crea (dedup) si ya hay un issue abierto con ese título", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [{ title: "cap: x", html_url: "https://gh/issues/9" }],
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await githubProvider("tok").ensureIssue(INPUT);
    expect(r).toEqual({ created: false, url: "https://gh/issues/9" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no POST
  });

  it("ignora PRs al deduplicar (issues endpoint también devuelve PRs)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ title: "cap: x", html_url: "https://gh/pull/3", pull_request: {} }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ html_url: "https://gh/issues/2" }) });
    vi.stubGlobal("fetch", fetchMock);
    const r = await githubProvider("tok").ensureIssue(INPUT);
    expect(r.created).toBe(true); // el PR con mismo título NO cuenta como dedup
  });
});
```

- [ ] **Step 2: Correr — falla** (`npx vitest run lib/git/__tests__/ensure-issue.test.ts`).

- [ ] **Step 3: `lib/config.ts`** — agregar (después de `TEMPLATE_REPO`):
```ts
/** Repo del host (donde se agregan los módulos nativos). "owner/repo". */
export const HOST_REPO = process.env.HOST_REPO ?? "org/backstagereactnative";
```

- [ ] **Step 4: `lib/git/types.ts`** — agregar la interfaz + el método al `GitProvider`
```ts
export interface EnsureIssueInput {
  readonly owner: string;
  readonly repo: string;
  readonly title: string;
  readonly body: string;
  readonly labels?: readonly string[];
}
```
Y dentro de `interface GitProvider`:
```ts
  /**
   * Crea un issue en el repo, SOLO si no hay uno abierto con el mismo título
   * (dedup). Usado para pedir que se agregue un módulo nativo al host.
   */
  ensureIssue(input: EnsureIssueInput): Promise<{ created: boolean; url: string }>;
```

- [ ] **Step 5: `lib/git/github.ts`** — implementar (espeja el patrón de las otras: `fetch` con `Authorization: Bearer ${token}` + `Accept: application/vnd.github+json` + `X-GitHub-Api-Version`)

Agregar el import del tipo (`EnsureIssueInput`) y, dentro del objeto que devuelve `githubProvider`, el método:
```ts
    async ensureIssue(input: EnsureIssueInput): Promise<{ created: boolean; url: string }> {
      const base = `https://api.github.com/repos/${input.owner}/${input.repo}`;
      const headers = {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
      };
      // Dedup: buscar un issue ABIERTO con el mismo título (excluyendo PRs).
      const listRes = await fetch(`${base}/issues?state=open&per_page=100`, { headers });
      if (!listRes.ok) {
        const detail = await listRes.text().catch(() => "");
        throw new GitProviderError(`GitHub list issues failed: HTTP ${listRes.status} ${detail.slice(0, 200)}`);
      }
      const issues = (await listRes.json()) as { title?: string; html_url?: string; pull_request?: unknown }[];
      const existing = issues.find((i) => i.pull_request === undefined && i.title === input.title);
      if (existing?.html_url) return { created: false, url: existing.html_url };

      const createRes = await fetch(`${base}/issues`, {
        method: "POST",
        headers,
        body: JSON.stringify({ title: input.title, body: input.body, labels: input.labels ?? [] }),
      });
      if (!createRes.ok) {
        const detail = await createRes.text().catch(() => "");
        throw new GitProviderError(`GitHub create issue failed: HTTP ${createRes.status} ${detail.slice(0, 200)}`);
      }
      const created = (await createRes.json()) as { html_url?: string };
      if (typeof created.html_url !== "string") throw new GitProviderError("GitHub issue response missing html_url");
      return { created: true, url: created.html_url };
    },
```

- [ ] **Step 6: `lib/git/mock.ts`** — agregar el método al mock:
```ts
    async ensureIssue(input) {
      return { created: true, url: `https://github.com/${input.owner}/${input.repo}/issues/1` };
    },
```
Y **grep `createFromTemplate:` en `**/__tests__/`** — a cualquier literal `GitProvider` inline agregarle `ensureIssue: async () => ({ created: true, url: "x" })` (si no, no compila).

- [ ] **Step 7: Correr — pasa** (`npx vitest run lib/git/__tests__/ensure-issue.test.ts`) + `npx tsc --noEmit` limpio + suite completa sin regresión.
- [ ] **Step 8: Commit**

```bash
git add lib/config.ts lib/git/types.ts lib/git/github.ts lib/git/mock.ts lib/git/__tests__/ensure-issue.test.ts
# + los archivos de test que hayan necesitado el método en su literal GitProvider
git commit  # feat(git): GitProvider.ensureIssue (dedup) + HOST_REPO config  (+ trailer)
```

---

### Task 2: `openCapabilityRequests` + wire en `/upload`

**Files:**
- Create: `lib/capability-request/index.ts`
- Modify: `app/api/miniapps/[id]/upload/route.ts` (disparar best-effort en el bloque warn)
- Test: `lib/capability-request/__tests__/index.test.ts` (nuevo) + agregar caso a `app/api/__tests__/upload-route.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export async function openCapabilityRequests(
    gitProvider: GitProvider,
    hostRepo: string,                 // "owner/repo"
    libraries: readonly string[],
    context: { miniappId: string; version: string },
  ): Promise<{ requested: string[]; failed: { library: string; error: string }[] }>;
  ```

- [ ] **Step 1: Test que falla** — `lib/capability-request/__tests__/index.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { openCapabilityRequests } from "@/lib/capability-request";
import { mockProvider } from "@/lib/git/mock";

describe("openCapabilityRequests", () => {
  it("abre un pedido por cada lib faltante con el contexto", async () => {
    const provider = mockProvider();
    const spy = vi.spyOn(provider, "ensureIssue");
    const r = await openCapabilityRequests(provider, "DentVega/backstagereactnative",
      ["react-native-svg", "react-native-mmkv"], { miniappId: "acc", version: "1.0.0" });
    expect(r.requested.sort()).toEqual(["react-native-mmkv", "react-native-svg"]);
    expect(r.failed).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
    const call = spy.mock.calls[0][0];
    expect(call.owner).toBe("DentVega");
    expect(call.repo).toBe("backstagereactnative");
    expect(call.title).toContain("react-native-svg");
    expect(call.body).toContain("acc");
  });

  it("una lib que falla va a failed; las demás a requested", async () => {
    const provider = mockProvider();
    vi.spyOn(provider, "ensureIssue").mockImplementation(async (i) => {
      if (i.title.includes("bad")) throw new Error("boom");
      return { created: true, url: "x" };
    });
    const r = await openCapabilityRequests(provider, "o/r", ["ok-lib", "bad-lib"], { miniappId: "acc", version: "1.0.0" });
    expect(r.requested).toEqual(["ok-lib"]);
    expect(r.failed[0].library).toBe("bad-lib");
  });
});
```

- [ ] **Step 2: Correr — falla**.

- [ ] **Step 3: `lib/capability-request/index.ts`**

```ts
/**
 * Abre pedidos de capability nativa (GitHub issues, con dedup) contra el repo del
 * host — uno por lib que la miniapp necesita y el host no provee. Best-effort.
 */
import type { GitProvider } from "@/lib/git/types";

export async function openCapabilityRequests(
  gitProvider: GitProvider,
  hostRepo: string,
  libraries: readonly string[],
  context: { miniappId: string; version: string },
): Promise<{ requested: string[]; failed: { library: string; error: string }[] }> {
  const [owner, repo] = hostRepo.split("/");
  const requested: string[] = [];
  const failed: { library: string; error: string }[] = [];
  for (const library of libraries) {
    try {
      await gitProvider.ensureIssue({
        owner,
        repo,
        title: `capability request: native module \`${library}\``,
        body:
          `La miniapp \`${context.miniappId}\` v${context.version} necesita el módulo nativo ` +
          `\`${library}\`, que el binario del host no provee.\n\n` +
          `Para habilitarlo: agregar la dependencia nativa al host, sacar una release nueva ` +
          `del binario, y regenerar el host contract (que ahora incluirá \`${library}\`).`,
        labels: ["capability-request"],
      });
      requested.push(library);
    } catch (err) {
      failed.push({ library, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { requested, failed };
}
```

- [ ] **Step 4: Wire en `app/api/miniapps/[id]/upload/route.ts`** — dentro del bloque warn, cuando hay `missingNatives`, disparar best-effort.

Imports:
```ts
import { githubProvider } from "@/lib/git/github";
import { githubToken, HOST_REPO } from "@/lib/config";
import { openCapabilityRequests } from "@/lib/capability-request";
```
En el bloque de compat, tras computar `problems`/los missing natives, agregar (dentro del mismo `try` warn, o su propio try best-effort):
```ts
        // Pedido automatizado de capability por cada nativo faltante (best-effort).
        const missing = (m.nativeModules ?? []).filter((n) => !hostNatives.has(n));
        if (missing.length > 0) {
          try {
            const result = await openCapabilityRequests(
              githubProvider(githubToken()), HOST_REPO, missing, { miniappId: id, version },
            );
            if (result.requested.length > 0) {
              console.warn(`compat[${id}@${version}]: opened/ensured capability request(s) for ${result.requested.join(", ")}`);
            }
          } catch (err) {
            console.warn(`compat[${id}@${version}]: capability request failed (ignored):`, err);
          }
        }
```
(Reusar el `hostNatives`/`missing` que ya se computa en el bloque; NO duplicar el Set. Ajustar para que `missing` esté disponible donde se dispara. Todo dentro del warn-mode → nunca rompe el 201.)

- [ ] **Step 5: Test del `/upload`** — agregar a `app/api/__tests__/upload-route.test.ts` un caso: con un contract sin el native + un manifest que lo declara → `githubProvider`/`openCapabilityRequests` se invoca (mockear `@/lib/git/github` `githubProvider` para devolver un `ensureIssue` spy) y el status sigue 201. Mockear `githubToken` vía `process.env.GITHUB_TOKEN`.

- [ ] **Step 6: Correr — pasa** (`npx vitest run lib/capability-request app/api/__tests__/upload-route.test.ts`) + `npx tsc --noEmit` + suite completa + `npx next build`.
- [ ] **Step 7: Commit**

```bash
git add lib/capability-request/index.ts lib/capability-request/__tests__/index.test.ts "app/api/miniapps/[id]/upload/route.ts" app/api/__tests__/upload-route.test.ts
git commit  # feat(capability): auto-open native capability requests from /upload gate  (+ trailer)
```

---

## Cierre (post-tasks, controller)

1. Review final whole-branch (base = commit previo a Task 1). Verificar: dedup real; best-effort no rompe el publish (warn-mode); HOST_REPO configurable.
2. `npx tsc --noEmit && npx vitest run && npx next build` — todo verde.
3. **Push.**

## Operacional / follow-ups
- Setear `HOST_REPO` en Vercel (ej. `DentVega/backstagereactnative`) — sin él usa el default `org/backstagereactnative`.
- El `GITHUB_TOKEN` del scaffolder necesita permiso de issues en el repo del host (ya tiene `repo` scope).
- Fase 4 (gate de gobernanza del host / blast-radius) queda como último bloque de código.
