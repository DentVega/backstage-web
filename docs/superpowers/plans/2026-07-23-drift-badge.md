# Badge de drift disponible Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show a per-miniapp badge in Backstage indicating whether it is up to date with the template or has a template update available (drift), closing the Capa 2 loop visually.

**Architecture:** A `lib/drift/` module mirrors the existing `lib/ci/` (types/github/mock/cache/index/resolve). It compares each miniapp's `.template-sync` `baseSha` against the template's current HEAD, using the scaffolder `githubToken()` server-side. A presentational `DriftBadge` (mirroring `CiBadge`) renders the status in the catalog list and the detail page.

**Tech Stack:** Next.js 16 (App Router, server components), vitest + @testing-library/react, GitHub REST API.

## Global Constraints

- Repo: `/Volumes/SSDExterno/prodproyects/backstage-web`. Owner DentVega. Direct to `main`.
- `DriftStatus = "up_to_date" | "drift" | "untracked" | "unknown"`.
- Token: the drift provider reads GitHub with the scaffolder `githubToken()` (from `@/lib/config`) — NOT a session token. The template repo is `TEMPLATE_REPO` (from `@/lib/config`, = `process.env.MINIAPP_TEMPLATE_REPO`). Never hardcode `DentVega/miniapp-template`.
- **Provider throws on error** (unlike the CI provider which never throws): `getBaseSha` returns `null` on 404 (untracked) but THROWS on other failures, so `resolve` can distinguish `untracked` (null) from `unknown` (throw). `resolveDriftStatuses` catches per-item → `unknown` (fail-soft; never breaks the render).
- Reuse `repoFullNameFor` from `@/lib/ci` (do not duplicate it).
- Labels: `up_to_date`="Al día", `drift`="Actualización disponible", `untracked`="Sin sync", `unknown`="Desconocido".
- No new dependencies.
- Commit trailer for every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```

---

## Task 1: `lib/drift/` logic core — types, cache, mock, resolve

**Files:**
- Create: `lib/drift/types.ts`, `lib/drift/cache.ts`, `lib/drift/mock.ts`, `lib/drift/resolve.ts`
- Test: `lib/drift/__tests__/resolve.test.ts`

**Interfaces:**
- Produces: `DriftStatus`, `DriftProvider` (`getTemplateHead(): Promise<string>`, `getBaseSha(repoFullName: string): Promise<string|null>`), `DriftProviderError`, `withCache(provider, opts?)`, `mockDriftProvider(opts?)`, `resolveDriftStatuses(items, provider?)`.

- [ ] **Step 1: Write the failing test**

Create `lib/drift/__tests__/resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveDriftStatuses } from "@/lib/drift/resolve";
import { mockDriftProvider } from "@/lib/drift/mock";

const items = [
  { id: "a", owner: "acme", repoUrl: "https://github.com/acme/miniapp-a" },
  { id: "b", owner: "acme", repoUrl: "https://github.com/acme/miniapp-b" },
  { id: "c", owner: "acme", repoUrl: "https://github.com/acme/miniapp-c" },
];

describe("resolveDriftStatuses", () => {
  it("classifies up_to_date / drift / untracked", async () => {
    const provider = mockDriftProvider({
      head: "HEADSHA",
      baseByRepo: {
        "acme/miniapp-a": "HEADSHA", // == head → up_to_date
        "acme/miniapp-b": "OLDSHA", //  != head → drift
        "acme/miniapp-c": null, //      no marker → untracked
      },
    });
    const out = await resolveDriftStatuses(items, provider);
    expect(out).toEqual({ a: "up_to_date", b: "drift", c: "untracked" });
  });

  it("maps a per-item error to unknown (fail-soft)", async () => {
    const provider = mockDriftProvider({
      head: "HEADSHA",
      baseByRepo: { "acme/miniapp-a": "HEADSHA" },
      throwRepos: ["acme/miniapp-b"],
    });
    const out = await resolveDriftStatuses(items, provider);
    expect(out.a).toBe("up_to_date");
    expect(out.b).toBe("unknown");
    expect(out.c).toBe("untracked"); // null default
  });

  it("returns all unknown when the template HEAD fetch fails", async () => {
    const provider = mockDriftProvider({ throwHead: true });
    const out = await resolveDriftStatuses(items, provider);
    expect(out).toEqual({ a: "unknown", b: "unknown", c: "unknown" });
  });
});
```

- [ ] **Step 2: Run it — fails**

Run: `cd /Volumes/SSDExterno/prodproyects/backstage-web && npx vitest run lib/drift/__tests__/resolve.test.ts`
Expected: FAIL — cannot resolve `@/lib/drift/resolve` / `@/lib/drift/mock`.

- [ ] **Step 3: Create `lib/drift/types.ts`**

```ts
/** Abstraction over a miniapp's drift vs the template (roadmap #7). */

/** Whether a miniapp is up to date with the template. Closed domain. */
export type DriftStatus = "up_to_date" | "drift" | "untracked" | "unknown";

export interface DriftProvider {
  /** SHA of the template's current HEAD (shared across miniapps; fetch once). */
  getTemplateHead(): Promise<string>;
  /** baseSha from the repo's `.template-sync`, or null if it has none (untracked). Throws on non-404 errors. */
  getBaseSha(repoFullName: string): Promise<string | null>;
}

export class DriftProviderError extends Error {
  readonly code = "DRIFT_PROVIDER_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "DriftProviderError";
  }
}
```

- [ ] **Step 4: Create `lib/drift/mock.ts`**

```ts
import type { DriftProvider } from "./types";

/** No-network provider for tests. Configurable head + per-repo baseSha + forced throws. */
export function mockDriftProvider(opts: {
  head?: string;
  baseByRepo?: Record<string, string | null>;
  throwHead?: boolean;
  throwRepos?: string[];
} = {}): DriftProvider {
  return {
    async getTemplateHead(): Promise<string> {
      if (opts.throwHead) throw new Error("template head failed");
      return opts.head ?? "HEAD";
    },
    async getBaseSha(repoFullName: string): Promise<string | null> {
      if (opts.throwRepos?.includes(repoFullName)) throw new Error("base sha failed");
      return opts.baseByRepo?.[repoFullName] ?? null;
    },
  };
}
```

- [ ] **Step 5: Create `lib/drift/cache.ts`**

```ts
import type { DriftProvider } from "./types";

interface CacheOptions {
  /** TTL, ms. Default 60s. */
  ttlMs?: number;
  /** Clock, injected for tests. Default Date.now. */
  now?: () => number;
}

/**
 * Decorate a DriftProvider with a short cache: the template HEAD (single value)
 * and each repo's baseSha (per-repo), so repeated catalog renders don't re-hit
 * GitHub. Only successful values are cached; a thrown error is not cached (so a
 * transient failure is retried on the next render).
 */
export function withCache(
  provider: DriftProvider,
  { ttlMs = 60_000, now = Date.now }: CacheOptions = {},
): DriftProvider {
  let headEntry: { value: string; expiresAt: number } | undefined;
  const baseCache = new Map<string, { value: string | null; expiresAt: number }>();
  return {
    async getTemplateHead(): Promise<string> {
      const t = now();
      if (headEntry !== undefined && headEntry.expiresAt > t) return headEntry.value;
      const value = await provider.getTemplateHead();
      headEntry = { value, expiresAt: t + ttlMs };
      return value;
    },
    async getBaseSha(repoFullName: string): Promise<string | null> {
      const t = now();
      const hit = baseCache.get(repoFullName);
      if (hit !== undefined && hit.expiresAt > t) return hit.value;
      const value = await provider.getBaseSha(repoFullName);
      baseCache.set(repoFullName, { value, expiresAt: t + ttlMs });
      return value;
    },
  };
}
```

- [ ] **Step 6: Create `lib/drift/resolve.ts`**

```ts
import { repoFullNameFor } from "@/lib/ci";
import { getDriftProvider } from "./index";
import type { DriftProvider, DriftStatus } from "./types";

interface DriftTarget {
  id: string;
  owner: string;
  repoUrl?: string;
}

/**
 * Resolve drift status for a set of miniapps into an `id → DriftStatus` map.
 * Fetches the template HEAD once, then each miniapp's baseSha, and compares.
 * Fail-soft: a per-item error → `unknown`; a HEAD fetch failure → all `unknown`.
 * The provider is injectable for tests; defaults to the cached GitHub provider.
 */
export async function resolveDriftStatuses(
  items: readonly DriftTarget[],
  provider: DriftProvider = getDriftProvider(),
): Promise<Record<string, DriftStatus>> {
  let head: string;
  try {
    head = await provider.getTemplateHead();
  } catch {
    return Object.fromEntries(items.map((i) => [i.id, "unknown" as DriftStatus]));
  }
  const pairs = await Promise.all(
    items.map(async (i) => {
      try {
        const base = await provider.getBaseSha(repoFullNameFor(i));
        const status: DriftStatus =
          base === null ? "untracked" : base === head ? "up_to_date" : "drift";
        return [i.id, status] as const;
      } catch {
        return [i.id, "unknown" as DriftStatus] as const;
      }
    }),
  );
  return Object.fromEntries(pairs);
}
```

Note: `resolve.ts` imports `getDriftProvider` from `./index`, which Task 2 creates. Until Task 2 exists, the test injects a mock provider (the `provider` param), so the default import is not exercised — but the module must still resolve `./index`. Create a minimal `lib/drift/index.ts` stub in this task exporting a placeholder, OR (cleaner) have Task 2 create `index.ts`; to keep Task 1's test green now, add a temporary re-export. **Do this:** create `lib/drift/index.ts` in this task with only the type re-exports + a `getDriftProvider` that throws "not wired yet" (Task 2 replaces it):

```ts
// lib/drift/index.ts (Task 1 stub — Task 2 replaces getDriftProvider with the real one)
export type { DriftStatus, DriftProvider } from "./types";
export { DriftProviderError } from "./types";
export function getDriftProvider(): never {
  throw new Error("getDriftProvider not wired (Task 2)");
}
```

- [ ] **Step 7: Run tests — pass**

Run: `cd /Volumes/SSDExterno/prodproyects/backstage-web && npx vitest run lib/drift/__tests__/resolve.test.ts`
Expected: PASS (3 tests) — the mock is injected, so the `getDriftProvider` stub is never called.

- [ ] **Step 8: Typecheck + commit**

Run: `npx tsc --noEmit`
Expected: no errors.
```bash
git add lib/drift/types.ts lib/drift/cache.ts lib/drift/mock.ts lib/drift/resolve.ts lib/drift/index.ts lib/drift/__tests__/resolve.test.ts
git commit -m "feat(drift): resolveDriftStatuses + provider types/cache/mock"
```

---

## Task 2: `lib/drift/github.ts` + real `getDriftProvider`

**Files:**
- Create: `lib/drift/github.ts`
- Modify: `lib/drift/index.ts` (replace the stub)
- Test: `lib/drift/__tests__/github.test.ts`

**Interfaces:**
- Consumes: `DriftProvider`, `DriftProviderError` (Task 1); `githubToken`, `TEMPLATE_REPO` from `@/lib/config`.
- Produces: `githubDriftProvider(fetchImpl?)`, and `getDriftProvider()` returning `withCache(githubDriftProvider())`.

- [ ] **Step 1: Write the failing test**

Create `lib/drift/__tests__/github.test.ts`:

```ts
import { describe, expect, it, beforeEach } from "vitest";
import { githubDriftProvider } from "@/lib/drift/github";

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

beforeEach(() => {
  process.env.GITHUB_TOKEN = "test-token";
  process.env.MINIAPP_TEMPLATE_REPO = "DentVega/miniapp-template";
});

describe("githubDriftProvider", () => {
  it("getTemplateHead returns the commit sha", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ sha: "HEADSHA" }), { status: 200 })) as unknown as typeof fetch;
    const sha = await githubDriftProvider(fetchImpl).getTemplateHead();
    expect(sha).toBe("HEADSHA");
  });

  it("getBaseSha decodes .template-sync content", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ content: b64({ templateRepo: "x", baseSha: "BASESHA" }) }), {
        status: 200,
      })) as unknown as typeof fetch;
    const base = await githubDriftProvider(fetchImpl).getBaseSha("acme/miniapp-a");
    expect(base).toBe("BASESHA");
  });

  it("getBaseSha returns null on 404 (untracked)", async () => {
    const fetchImpl = (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    const base = await githubDriftProvider(fetchImpl).getBaseSha("acme/miniapp-a");
    expect(base).toBeNull();
  });

  it("getBaseSha throws on a non-404 error", async () => {
    const fetchImpl = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await expect(githubDriftProvider(fetchImpl).getBaseSha("acme/miniapp-a")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run it — fails**

Run: `npx vitest run lib/drift/__tests__/github.test.ts`
Expected: FAIL — cannot resolve `@/lib/drift/github`.

- [ ] **Step 3: Create `lib/drift/github.ts`**

```ts
import { githubToken, TEMPLATE_REPO } from "@/lib/config";
import { DriftProviderError, type DriftProvider } from "./types";

type FetchImpl = typeof fetch;

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${githubToken()}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

/**
 * GitHub implementation. Reads the template's HEAD sha and each miniapp's
 * `.template-sync` baseSha via the REST API, using the scaffolder token.
 * `getBaseSha` returns null on 404 (untracked) but THROWS on other failures,
 * so the resolver can distinguish "untracked" from "unknown". `fetchImpl` is
 * injectable for tests.
 */
export function githubDriftProvider(fetchImpl: FetchImpl = fetch): DriftProvider {
  return {
    async getTemplateHead(): Promise<string> {
      const res = await fetchImpl(
        `https://api.github.com/repos/${TEMPLATE_REPO}/commits/main`,
        { headers: authHeaders() },
      );
      if (!res.ok) throw new DriftProviderError(`template HEAD failed: HTTP ${res.status}`);
      const body = (await res.json()) as { sha?: string };
      if (typeof body.sha !== "string") throw new DriftProviderError("template HEAD missing sha");
      return body.sha;
    },
    async getBaseSha(repoFullName: string): Promise<string | null> {
      const res = await fetchImpl(
        `https://api.github.com/repos/${repoFullName}/contents/.template-sync`,
        { headers: authHeaders() },
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new DriftProviderError(`.template-sync fetch failed: HTTP ${res.status}`);
      const body = (await res.json()) as { content?: string };
      if (typeof body.content !== "string") throw new DriftProviderError(".template-sync missing content");
      const json = JSON.parse(Buffer.from(body.content, "base64").toString("utf8")) as {
        baseSha?: string;
      };
      if (typeof json.baseSha !== "string") throw new DriftProviderError(".template-sync missing baseSha");
      return json.baseSha;
    },
  };
}
```

- [ ] **Step 4: Replace `lib/drift/index.ts` with the real provider**

```ts
import { githubDriftProvider } from "./github";
import { withCache } from "./cache";
import type { DriftProvider } from "./types";

export type { DriftStatus, DriftProvider } from "./types";
export { DriftProviderError } from "./types";

let cached: DriftProvider | null = null;

/** The GitHub drift provider wrapped in a ~60s cache (singleton). */
export function getDriftProvider(): DriftProvider {
  if (cached) return cached;
  cached = withCache(githubDriftProvider());
  return cached;
}
```

- [ ] **Step 5: Run both drift test files + typecheck**

Run: `npx vitest run lib/drift/ && npx tsc --noEmit`
Expected: github (4) + resolve (3) pass; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add lib/drift/github.ts lib/drift/index.ts lib/drift/__tests__/github.test.ts
git commit -m "feat(drift): GitHub provider + cached getDriftProvider"
```

---

## Task 3: `DriftBadge` component + CSS

**Files:**
- Create: `app/components/DriftBadge.tsx`
- Modify: `app/globals.css` (add `.drift-badge` rules after the `.ci-badge` block, ~line 190)
- Test: `app/components/__tests__/DriftBadge.test.tsx`

**Interfaces:**
- Consumes: `DriftStatus` from `@/lib/drift`.
- Produces: `<DriftBadge status={DriftStatus} />`.

- [ ] **Step 1: Write the failing test**

Create `app/components/__tests__/DriftBadge.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { DriftBadge } from "@/app/components/DriftBadge";
import type { DriftStatus } from "@/lib/drift";

describe("DriftBadge", () => {
  const cases: Array<[DriftStatus, RegExp]> = [
    ["up_to_date", /Al día/],
    ["drift", /Actualización disponible/],
    ["untracked", /Sin sync/],
    ["unknown", /Desconocido/],
  ];
  for (const [status, label] of cases) {
    it(`renders the ${status} badge with an accessible label`, () => {
      render(<DriftBadge status={status} />);
      const el = screen.getByRole("status");
      expect(el).toHaveAttribute("aria-label", `Drift: ${status}`);
      expect(el).toHaveTextContent(label);
    });
  }
});
```

- [ ] **Step 2: Run it — fails**

Run: `npx vitest run app/components/__tests__/DriftBadge.test.tsx`
Expected: FAIL — cannot resolve `@/app/components/DriftBadge`.

- [ ] **Step 3: Create `app/components/DriftBadge.tsx`**

```tsx
"use client";

import type { DriftStatus } from "@/lib/drift";

const LABELS: Record<DriftStatus, string> = {
  up_to_date: "Al día",
  drift: "Actualización disponible",
  untracked: "Sin sync",
  unknown: "Desconocido",
};

/** Presentational drift badge. No network — receives the status as a prop. */
export function DriftBadge({ status }: { status: DriftStatus }) {
  return (
    <span role="status" aria-label={`Drift: ${status}`} className={`drift-badge is-${status}`}>
      <span className="led" aria-hidden="true" />
      {LABELS[status]}
    </span>
  );
}
```

- [ ] **Step 4: Add CSS to `app/globals.css`**

After the `.ci-badge.is-none, .ci-badge.is-unknown { ... }` line (~line 190), add:

```css
.drift-badge {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 2px 9px; border-radius: 999px; font-size: 12px; font-weight: 600;
  border: 1px solid var(--line); color: var(--faint); white-space: nowrap;
}
.drift-badge .led { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
.drift-badge.is-up_to_date { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 45%, var(--line)); }
.drift-badge.is-drift { color: var(--warn); border-color: color-mix(in srgb, var(--warn) 45%, var(--line)); }
.drift-badge.is-untracked, .drift-badge.is-unknown { color: var(--faint); }
```

- [ ] **Step 5: Run test — pass**

Run: `npx vitest run app/components/__tests__/DriftBadge.test.tsx`
Expected: PASS (4).

- [ ] **Step 6: Commit**

```bash
git add app/components/DriftBadge.tsx app/globals.css app/components/__tests__/DriftBadge.test.tsx
git commit -m "feat(drift): DriftBadge component + styles"
```

---

## Task 4: Wire the badge into the catalog + detail

**Files:**
- Modify: `app/components/CatalogList.tsx` (add `driftById` prop + render `DriftBadge`)
- Modify: `app/catalog/page.tsx` (compute + pass `driftById`)
- Modify: `app/miniapp/[id]/page.tsx` (compute + render the detail badge)

**Interfaces:**
- Consumes: `resolveDriftStatuses` (`@/lib/drift/resolve`), `DriftBadge`, `DriftStatus` (Tasks 1–3).

- [ ] **Step 1: Add `driftById` to `CatalogList.tsx`**

In `app/components/CatalogList.tsx`, add the imports:
```tsx
import type { DriftStatus } from "@/lib/drift";
import { DriftBadge } from "./DriftBadge";
```
Change the signature to add the prop:
```tsx
export function CatalogList({
  entries,
  statusById = {},
  driftById = {},
}: {
  entries: CatalogEntry[];
  statusById?: Record<string, CiStatus>;
  driftById?: Record<string, DriftStatus>;
}) {
```
And render the drift badge next to the CI badge (after `<CiBadge status={statusById[e.id] ?? "unknown"} />`):
```tsx
          <CiBadge status={statusById[e.id] ?? "unknown"} />
          <DriftBadge status={driftById[e.id] ?? "unknown"} />
```

- [ ] **Step 2: Compute + pass `driftById` in `app/catalog/page.tsx`**

Add the import:
```tsx
import { resolveDriftStatuses } from "@/lib/drift/resolve";
```
After `const statusById = await resolveCiStatuses(...)`, add:
```tsx
  const driftById = await resolveDriftStatuses(entries);
```
Pass it to CatalogList:
```tsx
          <CatalogList entries={entries} statusById={statusById} driftById={driftById} />
```

- [ ] **Step 3: Render the drift badge on the detail page**

In `app/miniapp/[id]/page.tsx`, add the imports:
```tsx
import { resolveDriftStatuses } from "@/lib/drift/resolve";
import { DriftBadge } from "@/app/components/DriftBadge";
```
Near where `ciStatus` is computed (after that block), add:
```tsx
  const driftStatus = (await resolveDriftStatuses([detail]))[detail.id] ?? "unknown";
```
Render the drift badge next to the existing `<CiBadge status={ciStatus} />`:
```tsx
        <CiBadge status={ciStatus} />
        <DriftBadge status={driftStatus} />
```

- [ ] **Step 4: Typecheck + build + full test suite**

Run: `npx tsc --noEmit && npx vitest run && npx next build`
Expected: tsc clean; all tests pass (existing + the new drift tests); build succeeds.

- [ ] **Step 5: Commit + push**

```bash
git add app/components/CatalogList.tsx app/catalog/page.tsx app/miniapp/\[id\]/page.tsx
git commit -m "feat(drift): show DriftBadge in catalog + detail"
git push origin main
```

---

## Self-Review notes (author)

- **Spec coverage:** §3 module → Tasks 1–2; §4 UI (DriftBadge, catalog, detail) → Tasks 3–4; §6 testing → Task 1 (resolve) + Task 2 (github) + Task 3 (badge); §7 error invariant → Task 1 (fail-soft resolve) + Task 2 (throw-vs-404).
- **cache reuse decision resolved:** `lib/ci/cache.ts` is typed to `CiStatusProvider` (not generic), so `lib/drift/cache.ts` is its own (per the spec's conditional).
- **`repoFullNameFor` reused** from `@/lib/ci` in resolve.ts (not duplicated).
- **Type consistency:** `DriftStatus`, `DriftProvider` (`getTemplateHead`/`getBaseSha`), `resolveDriftStatuses(items, provider?)`, `getDriftProvider`, `DriftBadge` names identical across tasks.
- **Push:** only the final task pushes (Tasks 1–3 commit locally; Task 4 pushes all).
