# Rotación de PUBLISH_TOKEN (dual-token + reseed) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rotar el `PUBLISH_TOKEN` de `dev-publish-secret` (débil, compartido) a un token fuerte con rotación cero-downtime, vía validación dual-token en el server + un endpoint de re-seed que resiembra el token nuevo en todos los repos existentes.

**Architecture:** El server valida un Bearer token contra un *conjunto* (`PUBLISH_TOKEN` + `PUBLISH_TOKENS_OLD` CSV) con comparación timing-safe. El loop de seeding del scaffolder se extrae a un helper reutilizable que también consume un nuevo endpoint admin (`POST /api/admin/reseed-secrets`, guardado por el allowlist). En el camino se cierra el hueco de auth en `/publish`.

**Tech Stack:** Next.js 16 (App Router, route handlers `runtime = "nodejs"`), TypeScript, Vitest, `node:crypto` (builtin), libsodium sealed-box (ya existente en `lib/git/github.ts`).

## Global Constraints

- **Owner:** DentVega. **Sin dependencias nuevas** (usar `node:crypto`, builtin).
- **Nunca** escribir valores reales de token en el repo, docs, tests ni memoria. Los tests usan valores ficticios (`"new-strong"`, `"old-weak"`); el runbook usa placeholders (`<nuevo>`, `<viejo>`).
- Commits con **paths explícitos** (no `git add -A`); **no** commitear `data/registry.json` (artefacto local de dev).
- Cada commit termina con el trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```
- Los tests **no** deben inicializar NextAuth real: en cualquier archivo que importe (directa o transitivamente) `@/lib/auth`, mockear `@/auth` (`vi.mock("@/auth", () => ({ auth: vi.fn() }))`).
- Comportamiento observable de auth sin cambios para consumidores válidos: token válido pasa; inválido/ausente → `AuthError` → 401; sin ningún token configurado → `AuthError("PUBLISH_TOKEN not configured")`.
- Los commits son **locales**; el push a `main` lo hace el controller **después** de la review final whole-branch (código de auth — no push por-task).

---

### Task 1: Validación dual-token + timing-safe + mover `authorizeUpload` a `lib/auth.ts`

**Files:**
- Modify: `lib/auth.ts` (reescribe `requirePublishToken`, agrega `authorizeUpload`)
- Modify: `app/api/miniapps/[id]/upload/route.ts` (borra el `authorizeUpload` local, lo importa de `@/lib/auth`)
- Test: `lib/__tests__/auth.test.ts` (nuevo)

**Interfaces:**
- Produces:
  - `requirePublishToken(req: Request): void` — valida Bearer contra `[PUBLISH_TOKEN, ...PUBLISH_TOKENS_OLD]`.
  - `authorizeUpload(req: Request): Promise<void>` — sesión allowlisted (`canScaffold`) **o** `requirePublishToken`. Lanza `AuthError` si ninguna aplica.
  - `AuthError` (sin cambios).
- Consumes: `auth` de `@/auth`; `canScaffold` de `@/lib/scaffold-authz`; `scaffoldAllowedLogins` de `@/lib/config`.

- [ ] **Step 1: Escribir el test que falla** — `lib/__tests__/auth.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Importar @/lib/auth carga authorizeUpload → @/auth: mockear para no inicializar NextAuth.
vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));

import { requirePublishToken, authorizeUpload, AuthError } from "@/lib/auth";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;

function req(authorization?: string): Request {
  return new Request("http://x/api/upload", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

const OLD = process.env;
beforeEach(() => {
  process.env = { ...OLD };
  delete process.env.PUBLISH_TOKEN;
  delete process.env.PUBLISH_TOKENS_OLD;
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
  authMock.mockResolvedValue(null);
});
afterEach(() => {
  process.env = OLD;
  vi.restoreAllMocks();
});

describe("requirePublishToken — dual token", () => {
  it("acepta el token primario", () => {
    process.env.PUBLISH_TOKEN = "new-strong";
    expect(() => requirePublishToken(req("Bearer new-strong"))).not.toThrow();
  });

  it("acepta un token viejo aún en PUBLISH_TOKENS_OLD (transición)", () => {
    process.env.PUBLISH_TOKEN = "new-strong";
    process.env.PUBLISH_TOKENS_OLD = "old-weak";
    expect(() => requirePublishToken(req("Bearer old-weak"))).not.toThrow();
  });

  it("acepta cualquiera de varios tokens viejos (CSV con espacios/vacíos)", () => {
    process.env.PUBLISH_TOKEN = "new-strong";
    process.env.PUBLISH_TOKENS_OLD = " old-a , , old-b ";
    expect(() => requirePublishToken(req("Bearer old-b"))).not.toThrow();
  });

  it("rechaza un token desconocido", () => {
    process.env.PUBLISH_TOKEN = "new-strong";
    expect(() => requirePublishToken(req("Bearer nope"))).toThrow(AuthError);
  });

  it("rechaza header ausente o mal formado", () => {
    process.env.PUBLISH_TOKEN = "new-strong";
    expect(() => requirePublishToken(req())).toThrow(AuthError);
    expect(() => requirePublishToken(req("new-strong"))).toThrow(AuthError);
  });

  it("lanza 'not configured' si no hay ningún token en env", () => {
    expect(() => requirePublishToken(req("Bearer x"))).toThrow("PUBLISH_TOKEN not configured");
  });
});

describe("authorizeUpload", () => {
  it("pasa con sesión allowlisted (sin token)", async () => {
    process.env.SCAFFOLD_ALLOWED_LOGINS = "DentVega";
    authMock.mockResolvedValue({ githubLogin: "DentVega" });
    await expect(authorizeUpload(req())).resolves.toBeUndefined();
  });

  it("cae al token cuando no hay sesión allowlisted", async () => {
    process.env.PUBLISH_TOKEN = "new-strong";
    authMock.mockResolvedValue(null);
    await expect(authorizeUpload(req("Bearer new-strong"))).resolves.toBeUndefined();
    await expect(authorizeUpload(req("Bearer nope"))).rejects.toBeInstanceOf(AuthError);
  });
});
```

- [ ] **Step 2: Correr el test — debe fallar** (aún no existe `authorizeUpload` exportado ni el dual-token)

Run: `npx vitest run lib/__tests__/auth.test.ts`
Expected: FAIL (import de `authorizeUpload` no resuelve / token viejo rechazado).

- [ ] **Step 3: Reescribir `lib/auth.ts`** (contenido completo)

```ts
/** Service-token auth for the publish/upload endpoints (ADR-015). */
import { createHash, timingSafeEqual } from "node:crypto";
import { auth } from "@/auth";
import { canScaffold } from "@/lib/scaffold-authz";
import { scaffoldAllowedLogins } from "@/lib/config";

export class AuthError extends Error {
  readonly code = "UNAUTHORIZED";
  constructor(message = "unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Tokens de publicación válidos: el `PUBLISH_TOKEN` primario más cualquier token
 * viejo aún aceptado en `PUBLISH_TOKENS_OLD` (CSV) — habilita rotación cero-downtime.
 */
function validPublishTokens(): string[] {
  const primary = process.env.PUBLISH_TOKEN ?? "";
  const old = (process.env.PUBLISH_TOKENS_OLD ?? "").split(",").map((t) => t.trim());
  return [primary, ...old].filter((t) => t.length > 0);
}

/**
 * Comparación en tiempo constante vía digests sha256 de largo fijo — evita el
 * throw de `timingSafeEqual` con largos distintos y no filtra la longitud del token.
 */
function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

/** Lanza AuthError salvo que el request traiga un token de publicación válido como Bearer. */
export function requirePublishToken(req: Request): void {
  const valid = validPublishTokens();
  if (valid.length === 0) throw new AuthError("PUBLISH_TOKEN not configured");
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!valid.some((v) => safeEqual(token, v))) throw new AuthError();
}

/**
 * Autoriza un upload/publish: un usuario logueado allowlisted (flujo UI) O un
 * Bearer `PUBLISH_TOKEN` válido (flujo CI). Lanza AuthError si ninguna aplica.
 */
export async function authorizeUpload(req: Request): Promise<void> {
  const session = await auth();
  if (canScaffold(session?.githubLogin, scaffoldAllowedLogins())) return;
  requirePublishToken(req);
}
```

- [ ] **Step 4: Actualizar `app/api/miniapps/[id]/upload/route.ts`**

Borrar la función local `authorizeUpload` (líneas 17-25) y su uso de imports que queden huérfanos. Cambiar el import de la línea 7:

```ts
import { authorizeUpload } from "@/lib/auth";
```

Quitar de los imports lo que ya no se use **en este archivo** tras borrar la función local: `auth` (`@/auth`), `canScaffold` (`@/lib/scaffold-authz`), `requirePublishToken` (`@/lib/auth`), y `scaffoldAllowedLogins` de `@/lib/config`. **Cuidado:** verificar con grep si alguno de esos sigue usándose en el resto del archivo antes de borrarlo del import (dejar los que sí). El cuerpo de `POST` sigue llamando `await authorizeUpload(req)` en la línea 39 (sin cambios).

- [ ] **Step 5: Correr los tests afectados — deben pasar**

Run: `npx vitest run lib/__tests__/auth.test.ts app/api/__tests__/upload-route.test.ts`
Expected: PASS (dual-token + `authorizeUpload` movido; upload sigue verde).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: sin errores (verifica que no haya import circular `@/lib/auth` ↔ `@/auth` ni imports huérfanos).

- [ ] **Step 7: Commit**

```bash
git add lib/auth.ts app/api/miniapps/[id]/upload/route.ts lib/__tests__/auth.test.ts
git commit  # feat(auth): dual publish tokens + timing-safe + shared authorizeUpload  (+ trailer)
```

---

### Task 2: Extraer `seedRepoSecrets` reutilizable

**Files:**
- Modify: `lib/scaffold.ts` (extrae el loop de seeding a una función exportada; `scaffoldMiniapp` la usa)
- Test: `lib/__tests__/scaffold.test.ts` (agrega un `describe("seedRepoSecrets")`)

**Interfaces:**
- Produces:
  ```ts
  export interface SeedResult {
    seeded: string[];                              // nombres de secrets seteados ok
    failed: { name: string; error: string }[];     // secrets que fallaron
  }
  export async function seedRepoSecrets(
    gitProvider: GitProvider,
    owner: string,
    repo: string,
    secrets: Record<string, string>,
  ): Promise<SeedResult>;
  ```
  Best-effort **por secret** (nunca lanza); devuelve el detalle para que un caller (el reseed) decida a nivel repo. Reconcilia §3.3 (void, best-effort para el scaffolder) y §3.4 (necesita detectar fallos por repo) del spec.
- Consumes: `GitProvider` de `./git/types`.

- [ ] **Step 1: Escribir el test que falla** — agregar a `lib/__tests__/scaffold.test.ts`

```ts
import { seedRepoSecrets } from "@/lib/scaffold";

describe("seedRepoSecrets", () => {
  it("setea cada secret y los reporta en seeded", async () => {
    const calls: { name: string; value: string }[] = [];
    const provider = {
      createFromTemplate: async () => ({ repoUrl: "x" }),
      dispatchWorkflow: async () => {},
      enableActionsPullRequests: async () => {},
      setSecret: async (i: { name: string; value: string }) => {
        calls.push({ name: i.name, value: i.value });
      },
    };
    const res = await seedRepoSecrets(provider, "acme", "miniapp-x", {
      BACKSTAGE_URL: "https://b",
      PUBLISH_TOKEN: "new-strong",
    });
    expect(res.seeded.sort()).toEqual(["BACKSTAGE_URL", "PUBLISH_TOKEN"]);
    expect(res.failed).toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it("un secret que falla no aborta los demás (best-effort)", async () => {
    const provider = {
      createFromTemplate: async () => ({ repoUrl: "x" }),
      dispatchWorkflow: async () => {},
      enableActionsPullRequests: async () => {},
      setSecret: async (i: { name: string }) => {
        if (i.name === "PUBLISH_TOKEN") throw new Error("boom");
      },
    };
    const res = await seedRepoSecrets(provider, "acme", "miniapp-x", {
      BACKSTAGE_URL: "https://b",
      PUBLISH_TOKEN: "new-strong",
    });
    expect(res.seeded).toEqual(["BACKSTAGE_URL"]);
    expect(res.failed).toEqual([{ name: "PUBLISH_TOKEN", error: "boom" }]);
  });
});
```

- [ ] **Step 2: Correr — debe fallar** (no existe `seedRepoSecrets`)

Run: `npx vitest run lib/__tests__/scaffold.test.ts`
Expected: FAIL (`seedRepoSecrets` no exportado).

- [ ] **Step 3: Implementar en `lib/scaffold.ts`**

Agregar la interfaz + función (después de los imports, antes de `scaffoldMiniapp`):

```ts
export interface SeedResult {
  seeded: string[];
  failed: { name: string; error: string }[];
}

/**
 * Siembra (crea/actualiza) los secrets de Actions de un repo, best-effort por
 * secret: un fallo no aborta los demás. Nunca logea el VALOR del secret.
 * Reusado por el scaffolder (al crear) y por el reseed (rotación).
 */
export async function seedRepoSecrets(
  gitProvider: GitProvider,
  owner: string,
  repo: string,
  secrets: Record<string, string>,
): Promise<SeedResult> {
  const seeded: string[] = [];
  const failed: { name: string; error: string }[] = [];
  for (const [name, value] of Object.entries(secrets)) {
    try {
      await gitProvider.setSecret({ owner, repo, name, value });
      seeded.push(name);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      failed.push({ name, error });
      console.warn(`seedRepoSecrets: could not set secret ${name} for ${owner}/${repo}: ${error}`);
    }
  }
  return { seeded, failed };
}
```

Reemplazar el loop inline en `scaffoldMiniapp` (líneas 63-74 originales) por:

```ts
  // Best-effort: seed the CI secrets (BACKSTAGE_URL + PUBLISH_TOKEN) so the
  // miniapp can publish on first push. A failure here must not abort the scaffold.
  await seedRepoSecrets(gitProvider, input.owner, repo, secrets);
```

- [ ] **Step 4: Correr — deben pasar** (incluye los tests existentes de scaffold, sin regresión)

Run: `npx vitest run lib/__tests__/scaffold.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scaffold.ts lib/__tests__/scaffold.test.ts
git commit  # refactor(scaffold): extract reusable seedRepoSecrets helper  (+ trailer)
```

---

### Task 3: Endpoint `POST /api/admin/reseed-secrets`

**Files:**
- Create: `app/api/admin/reseed-secrets/route.ts`
- Test: `app/api/__tests__/reseed-secrets-route.test.ts` (nuevo)

**Interfaces:**
- Consumes: `auth` (`@/auth`), `canScaffold` + `ScaffoldForbiddenError` (`@/lib/scaffold-authz`), `scaffoldAllowedLogins` + `scaffoldSecrets` + `githubToken` (`@/lib/config`), `githubProvider` (`@/lib/git/github`), `getStore` (`@/lib/registry/store`), `seedRepoSecrets` (`@/lib/scaffold`), `errorBody` + `statusForError` (`@/lib/http`).
- Produces: `POST(): Promise<NextResponse>` → `200 { reseeded: string[]; failed: { id: string; error: string }[] }`. Guard: sesión allowlisted; sin ella → `ScaffoldForbiddenError` → 403.

- [ ] **Step 1: Escribir el test que falla** — `app/api/__tests__/reseed-secrets-route.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Registry } from "@/lib/registry/types";

const state = vi.hoisted(() => ({
  reg: {} as Registry,
  setSecretCalls: [] as { owner: string; repo: string; name: string }[],
  failRepo: null as string | null,
}));

vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({ load: async () => state.reg, save: async () => {} }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/git/github", () => ({
  githubProvider: () => ({
    createFromTemplate: async () => ({ repoUrl: "x" }),
    dispatchWorkflow: async () => {},
    enableActionsPullRequests: async () => {},
    setSecret: async (i: { owner: string; repo: string; name: string }) => {
      state.setSecretCalls.push(i);
      if (state.failRepo && i.repo === state.failRepo) throw new Error("seal failed");
    },
  }),
}));

import { POST } from "@/app/api/admin/reseed-secrets/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "DentVega";

function post(): Request {
  return new Request("http://x/api/admin/reseed-secrets", { method: "POST" });
}

beforeEach(() => {
  state.reg = {
    a: { id: "a" as never, name: "A", owner: "acme", versions: [] },
    b: { id: "b" as never, name: "B", owner: "acme", versions: [] },
  };
  state.setSecretCalls = [];
  state.failRepo = null;
  process.env.GITHUB_TOKEN = "test-token";
  process.env.BACKSTAGE_URL = "https://backstage.example";
  process.env.PUBLISH_TOKEN = "new-strong";
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  authMock.mockResolvedValue({ githubLogin: ADMIN });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("POST /api/admin/reseed-secrets — authorization", () => {
  it("403 sin sesión allowlisted (no toca ningún repo)", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    const res = await POST(post());
    expect(res.status).toBe(403);
    expect(state.setSecretCalls).toHaveLength(0);
  });

  it("403 sin sesión", async () => {
    authMock.mockResolvedValue(null);
    expect((await POST(post())).status).toBe(403);
  });
});

describe("POST /api/admin/reseed-secrets", () => {
  it("resiembra PUBLISH_TOKEN + BACKSTAGE_URL en todos los repos del registry", async () => {
    const res = await POST(post());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reseeded: string[]; failed: unknown[] };
    expect(body.reseeded.sort()).toEqual(["a", "b"]);
    expect(body.failed).toEqual([]);
    // 2 repos × 2 secrets
    expect(state.setSecretCalls.filter((c) => c.name === "PUBLISH_TOKEN")).toHaveLength(2);
    expect(state.setSecretCalls.some((c) => c.repo === "miniapp-a")).toBe(true);
  });

  it("un repo que falla va a failed; el resto a reseeded", async () => {
    state.failRepo = "miniapp-b";
    const res = await POST(post());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reseeded: string[]; failed: { id: string }[] };
    expect(body.reseeded).toEqual(["a"]);
    expect(body.failed.map((f) => f.id)).toEqual(["b"]);
  });
});
```

- [ ] **Step 2: Correr — debe fallar** (la ruta no existe)

Run: `npx vitest run app/api/__tests__/reseed-secrets-route.test.ts`
Expected: FAIL (no module `@/app/api/admin/reseed-secrets/route`).

- [ ] **Step 3: Implementar `app/api/admin/reseed-secrets/route.ts`**

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { getStore } from "@/lib/registry/store";
import { seedRepoSecrets } from "@/lib/scaffold";
import { githubProvider } from "@/lib/git/github";
import { githubToken, scaffoldAllowedLogins, scaffoldSecrets } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * POST /api/admin/reseed-secrets — re-siembra los secrets de CI
 * (BACKSTAGE_URL + PUBLISH_TOKEN, valores actuales del env de Backstage) en TODOS
 * los repos del registry. Usado para rotar el PUBLISH_TOKEN sin downtime.
 * Auth: sesión allowlisted (canScaffold) — acción administrativa, no el token.
 * Best-effort por repo → { reseeded, failed }.
 */
export async function POST(_req: Request): Promise<NextResponse> {
  try {
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }

    const reg = await getStore().load();
    const provider = githubProvider(githubToken());
    const secrets = scaffoldSecrets();

    const reseeded: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const rec of Object.values(reg)) {
      const repo = `miniapp-${rec.id}`;
      try {
        const result = await seedRepoSecrets(provider, rec.owner, repo, secrets);
        if (result.failed.length > 0) {
          failed.push({ id: rec.id, error: result.failed.map((f) => `${f.name}: ${f.error}`).join("; ") });
        } else {
          reseeded.push(rec.id);
        }
      } catch (err) {
        failed.push({ id: rec.id, error: err instanceof Error ? err.message : String(err) });
      }
    }

    return NextResponse.json({ reseeded, failed }, { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
```

- [ ] **Step 4: Correr — deben pasar**

Run: `npx vitest run app/api/__tests__/reseed-secrets-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/reseed-secrets/route.ts app/api/__tests__/reseed-secrets-route.test.ts
git commit  # feat(admin): reseed-secrets endpoint for zero-downtime token rotation  (+ trailer)
```

---

### Task 4: Guard de auth en `/publish` (cierra el hueco) + arreglar `routes.test.ts`

**Files:**
- Modify: `app/api/miniapps/[id]/publish/route.ts` (agrega `await authorizeUpload(req)`)
- Modify: `app/api/__tests__/routes.test.ts` (autentica las llamadas a publish existentes, o rompen)
- Test: `app/api/__tests__/publish-route.test.ts` (nuevo — matriz de auth)

**Interfaces:**
- Consumes: `authorizeUpload` de `@/lib/auth` (Task 1).

**Contexto crítico:** hoy `app/api/__tests__/routes.test.ts` llama `publishPOST` **sin auth** (describe en línea ~62) y el test de `resolve` (~90) publica como setup. Agregar el guard rompe esos tests salvo que se autentiquen. Solución elegida: mockear `@/auth` en `routes.test.ts` para devolver una sesión allowlisted y setear `SCAFFOLD_ALLOWED_LOGINS`, así todas las llamadas a publish pasan por la rama de sesión sin tocar headers.

- [ ] **Step 1: Escribir el test nuevo que falla** — `app/api/__tests__/publish-route.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Registry } from "@/lib/registry/types";

const state = vi.hoisted(() => ({ reg: {} as Registry }));
vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({
    load: async () => state.reg,
    save: async (r: Registry) => { state.reg = r; },
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { POST } from "@/app/api/miniapps/[id]/publish/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;

function publishReq(headers?: Record<string, string>): Request {
  return new Request("http://x/api/miniapps/acc/publish", {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify({ version: "1.0.0", url: "http://h/acc", manifest: {} }),
  });
}
const params = { params: Promise.resolve({ id: "acc" }) };

beforeEach(() => {
  state.reg = { acc: { id: "acc" as never, name: "A", owner: "o", versions: [] } };
  delete process.env.PUBLISH_TOKEN;
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
  authMock.mockResolvedValue(null);
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.SCAFFOLD_ALLOWED_LOGINS; });

describe("POST /api/miniapps/:id/publish — auth", () => {
  it("401 sin sesión ni token", async () => {
    const res = await POST(publishReq(), params);
    expect(res.status).toBe(401);
  });

  it("pasa con Bearer PUBLISH_TOKEN válido (flujo CI)", async () => {
    process.env.PUBLISH_TOKEN = "new-strong";
    const res = await POST(publishReq({ authorization: "Bearer new-strong" }), params);
    expect(res.status).toBe(201);
  });

  it("pasa con sesión allowlisted (flujo UI)", async () => {
    process.env.SCAFFOLD_ALLOWED_LOGINS = "DentVega";
    authMock.mockResolvedValue({ githubLogin: "DentVega" });
    const res = await POST(publishReq(), params);
    expect(res.status).toBe(201);
  });
});
```

- [ ] **Step 2: Correr — debe fallar** (publish aún no exige auth → el caso 401 devuelve 201)

Run: `npx vitest run app/api/__tests__/publish-route.test.ts`
Expected: FAIL (primer test espera 401, obtiene 201).

- [ ] **Step 3: Agregar el guard en `app/api/miniapps/[id]/publish/route.ts`**

Import nuevo:
```ts
import { authorizeUpload } from "@/lib/auth";
```
Primera línea dentro del `try` de `POST` (antes de `const { id } = await params;`):
```ts
    await authorizeUpload(req);
```

- [ ] **Step 4: Arreglar `app/api/__tests__/routes.test.ts`** (que no rompa)

Agregar el mock de `@/auth` junto a los otros `vi.mock` del archivo, y autenticar via sesión allowlisted en el `beforeEach`. Concretamente:

1. Agregar cerca de los mocks existentes:
   ```ts
   vi.mock("@/auth", () => ({ auth: vi.fn() }));
   ```
   e importar debajo de los imports de rutas:
   ```ts
   import { auth } from "@/auth";
   const authMock = auth as unknown as ReturnType<typeof vi.fn>;
   ```
2. En el `beforeEach` del archivo (crear uno si no existe, o extender el actual) agregar:
   ```ts
   process.env.SCAFFOLD_ALLOWED_LOGINS = "DentVega";
   authMock.mockResolvedValue({ githubLogin: "DentVega" });
   ```
   y en `afterEach`: `delete process.env.SCAFFOLD_ALLOWED_LOGINS;` + `vi.restoreAllMocks();` (si no está).

Con esto, las llamadas existentes a `publishPOST` pasan por la rama de sesión. **No** cambiar los cuerpos de los tests de publish/resolve. Verificar que `registerPOST` (`/api/miniapps`) no exige auth (no debería — es otra ruta); si algún test suyo se ve afectado por el mock de auth, no lo estará porque esa ruta no llama `auth()`.

- [ ] **Step 5: Correr los tests afectados — deben pasar**

Run: `npx vitest run app/api/__tests__/publish-route.test.ts app/api/__tests__/routes.test.ts`
Expected: PASS (matriz de auth nueva verde; routes.test sigue verde).

- [ ] **Step 6: Commit**

```bash
git add app/api/miniapps/[id]/publish/route.ts app/api/__tests__/publish-route.test.ts app/api/__tests__/routes.test.ts
git commit  # fix(auth): require auth on /publish (close open registry-write endpoint)  (+ trailer)
```

---

### Task 5: Runbook de rotación

**Files:**
- Create: `docs/rotar-publish-token.md`

- [ ] **Step 1: Escribir `docs/rotar-publish-token.md`**

Documento operacional. **Sin valores reales de token** — solo placeholders `<nuevo>` / `<viejo>` e instrucciones para que el owner los genere/setee. Contenido:

```markdown
# Rotar el PUBLISH_TOKEN (cero-downtime)

El `PUBLISH_TOKEN` es el token de servicio que cada miniapp usa para publicar sus
chunks a Backstage (`Authorization: Bearer <token>`). Backstage lo valida y el
scaffolder lo siembra en el secret de Actions de cada repo. Esta es la rotación
sin downtime, apoyada en el soporte **dual-token** del server.

## Cómo funciona el dual-token

`requirePublishToken` (en `lib/auth.ts`) acepta un **conjunto** de tokens:
- `PUBLISH_TOKEN` — el token primario (el nuevo, tras rotar).
- `PUBLISH_TOKENS_OLD` — lista CSV de tokens viejos aún aceptados durante la transición.

Mientras el viejo siga en `PUBLISH_TOKENS_OLD`, los repos no re-sembrados publican ok.

## Pasos

1. **Generar el token fuerte:**
   ```bash
   openssl rand -hex 32
   ```

2. **Setear el env en Vercel (prod)** y redeployar:
   - `PUBLISH_TOKEN` = `<nuevo>` (el de openssl)
   - `PUBLISH_TOKENS_OLD` = `<viejo>` (el `dev-publish-secret` actual)
   ```bash
   vercel env add PUBLISH_TOKEN production        # pegás <nuevo>
   vercel env add PUBLISH_TOKENS_OLD production    # pegás <viejo>
   vercel --prod   # o el redeploy que uses
   ```
   → El server ahora acepta **ambos**: ningún publish falla.

3. **Re-sembrar el token nuevo en todos los repos** — como usuario allowlisted
   (logueado en Backstage con un login de `SCAFFOLD_ALLOWED_LOGINS`):
   ```bash
   curl -X POST https://<tu-backstage>/api/admin/reseed-secrets \
     -H "cookie: <tu cookie de sesión de Backstage>"
   ```
   Respuesta: `{ "reseeded": ["hello_widget", ...], "failed": [] }`.
   Reintentá si algún id cae en `failed` (repo borrado, rate-limit, permisos).

4. **Verificar** que un publish real anda con el token nuevo: disparar el CI de una
   miniapp (o el botón Deploy) → debe dar 200/201.

5. **Quitar el token viejo:** borrar `PUBLISH_TOKENS_OLD` del env y redeployar.
   ```bash
   vercel env rm PUBLISH_TOKENS_OLD production
   vercel --prod
   ```
   → El token viejo deja de ser aceptado. Rotación completa.

6. **Dev local:** actualizar `PUBLISH_TOKEN` en `.env.local`.

## Notas

- **Nunca** commitees los valores de token. Viven solo en Vercel env y `.env.local`
  (gitignored).
- El endpoint `/api/admin/reseed-secrets` siembra el `PUBLISH_TOKEN` **actual** del
  env de Backstage — por eso el paso 2 (setear el nuevo) va **antes** del paso 3.
- Si comprometen el token en el futuro: repetí esta rotación. El dual-token la hace
  segura y sin cortar publicaciones.
- A futuro: token por-miniapp revocable (roadmap #1-futuro) — cerraría el problema de
  raíz (revocar uno sin rotar todos).

Ver también: `docs/superpowers/specs/2026-07-23-publish-token-rotation-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add docs/rotar-publish-token.md
git commit  # docs: runbook de rotación del PUBLISH_TOKEN  (+ trailer)
```

---

## Cierre (post-tasks, lo hace el controller)

1. Review final whole-branch (base = commit previo a Task 1; head = último commit) en el modelo más capaz.
2. Suite completa: `npx tsc --noEmit && npx vitest run && npx next build` — todo verde.
3. **Push a `main`** (recién acá — es código de auth).
4. Vercel redeploya. El código soporta la rotación; los cambios de env + el `POST /api/admin/reseed-secrets` los ejecuta el owner siguiendo `docs/rotar-publish-token.md`.
