# Fase 4 — Gate de gobernanza del host (blast-radius) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el CI del host bloquee un cambio de deps que **rompería la flota**: regenera el contract candidato del PR, lo compara contra cada miniapp publicada (blast-radius con `checkCompatibility`), y falla si alguna miniapp **hoy compatible pasaría a incompatible** — salvo override explícito. Con branch protection, no se puede saltear (ni humano ni IA).

**Architecture:** Backstage expone `GET /api/manifests` (el manifest de la última versión de cada miniapp). El host tiene `scripts/check-host-compat.mjs`: genera el contract candidato (corriendo `gen-host-contract.mjs`), fetch del contract publicado + los manifests, y `findNewlyBroken` (transición compatible→incompatible) usando el `checkCompatibility` real (v0.3.0, workspace). Corre en un workflow del host en PRs que tocan deps. Rollout-safe: sin contract publicado → skip.

**Tech Stack:** Next.js route (Backstage) + Node ESM script `node:test` (host) + `@dentvega/miniapp-contract` (workspace, `checkCompatibility`) + GitHub Actions.

## Global Constraints

- **Owner:** DentVega. **Sin dependencias nuevas.**
- **Dos repos:** Task 1 en `/Volumes/SSDExterno/prodproyects/backstage-web` (vitest); Task 2 en `/Volumes/SSDExterno/prodproyects/backstagereactnative` `apps/host` (node:test). Commits **locales** por repo.
- **Definición de breaking (transición):** una miniapp cuenta como rota SOLO si es **compatible con el contract publicado** Y **incompatible con el candidato** (evita marcar las que ya estaban incompatibles/sin backfill).
- **Rollout-safe:** sin contract publicado (404) → no hay baseline → skip (exit 0, warn). Override: env `ACCEPT_BREAKING=true` (del label `accept-breaking-contract`) → deja pasar dejando registro.
- Tests del host con `node:test`. Commits con **paths explícitos**; trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```

---

### Task 1: `GET /api/manifests` en Backstage

**Files:**
- Create: `app/api/manifests/route.ts`
- Test: `app/api/__tests__/manifests-route.test.ts`

**Interfaces:**
- Produces: `GET /api/manifests` → `200 { manifests: Manifest[] }` — el manifest de la ÚLTIMA versión publicada de cada miniapp (las miniapps sin versiones se omiten).

- [ ] **Step 1: Test que falla** — `app/api/__tests__/manifests-route.test.ts`

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Registry } from "@/lib/registry/types";

const state = vi.hoisted(() => ({ reg: {} as Registry }));
vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({ load: async () => state.reg, save: async () => {} }),
}));

import { GET } from "@/app/api/manifests/route";

beforeEach(() => {
  state.reg = {
    a: {
      id: "a" as never, name: "A", owner: "o",
      versions: [
        { version: "0.1.0", url: "u", manifest: { id: "a", version: "0.1.0", shared: [], nativeModules: [] }, publishedAt: "t" },
        { version: "0.2.0", url: "u", manifest: { id: "a", version: "0.2.0", shared: [], nativeModules: ["react-native-svg"] }, publishedAt: "t" },
      ],
    },
    b: { id: "b" as never, name: "B", owner: "o", versions: [] }, // sin versiones → se omite
  } as never;
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/manifests", () => {
  it("devuelve el manifest de la última versión de cada miniapp con versiones", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { manifests: { id: string; version: string; nativeModules?: string[] }[] };
    expect(body.manifests).toHaveLength(1); // 'b' omitida
    expect(body.manifests[0].version).toBe("0.2.0"); // la última
    expect(body.manifests[0].nativeModules).toEqual(["react-native-svg"]);
  });
});
```

- [ ] **Step 2: Correr — falla** (`npx vitest run app/api/__tests__/manifests-route.test.ts`).

- [ ] **Step 3: `app/api/manifests/route.ts`**

```ts
import { NextResponse } from "next/server";
import { getStore } from "@/lib/registry/store";

export const runtime = "nodejs";

/**
 * GET /api/manifests — el manifest de la última versión publicada de cada miniapp.
 * Usado por el gate de gobernanza del host (blast-radius). Miniapps sin versiones
 * publicadas se omiten. Lectura pública (no secreto).
 */
export async function GET(): Promise<NextResponse> {
  const reg = await getStore().load();
  const manifests: unknown[] = [];
  for (const rec of Object.values(reg)) {
    const versions = rec.versions ?? [];
    if (versions.length === 0) continue;
    const latest = versions[versions.length - 1]; // el registry publica en orden ascendente
    if (latest?.manifest !== undefined) manifests.push(latest.manifest);
  }
  return NextResponse.json({ manifests }, { status: 200 });
}
```
(Nota: si el registry no garantiza orden ascendente de `versions`, ordenar por semver antes de tomar la última — verificar cómo `publishVersion` inserta; el test asume append ascendente.)

- [ ] **Step 4: Correr — pasa** + `npx tsc --noEmit` limpio + suite completa sin regresión.
- [ ] **Step 5: Commit**

```bash
git add app/api/manifests/route.ts app/api/__tests__/manifests-route.test.ts
git commit  # feat(api): GET /api/manifests — latest manifest per miniapp (blast-radius)  (+ trailer)
```

---

### Task 2: `check-host-compat.mjs` + workflow (en el repo del host)

**Files (repo `backstagereactnative`):**
- Create: `apps/host/scripts/check-host-compat.mjs`
- Create: `.github/workflows/host-compat.yml`
- Test: `apps/host/scripts/__tests__/check-host-compat.test.mjs`

**Interfaces:**
- Produces: `findNewlyBroken(publishedContract, candidateContract, manifests) → { id, reason }[]` (usa el `checkCompatibility` real del package).

- [ ] **Step 1: Test que falla** — `apps/host/scripts/__tests__/check-host-compat.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { findNewlyBroken } from "../check-host-compat.mjs";

const published = { contractVersion: "1.0.0", reactNative: "0.76.6",
  shared: { "react-native": "0.76.6" }, nativeModules: ["react-native-screens"] };

// candidato sube RN a 0.77 → rompe la miniapp que pide ^0.76
const candidate = { ...published, reactNative: "0.77.0", shared: { "react-native": "0.77.0" } };

const manifests = [
  { id: "compat", shared: [{ name: "react-native", requiredRange: "^0.76.0", singleton: true }], nativeModules: [] },
  { id: "any", shared: [{ name: "react-native", requiredRange: "*", singleton: true }], nativeModules: [] },
];

test("findNewlyBroken: lista las miniapps que pasan de compatible → incompatible", () => {
  const broken = findNewlyBroken(published, candidate, manifests);
  assert.deepEqual(broken.map((b) => b.id), ["compat"]); // 'any' (rango *) sigue compatible
});

test("findNewlyBroken: [] si el candidato no rompe a nadie", () => {
  assert.deepEqual(findNewlyBroken(published, published, manifests), []);
});

test("findNewlyBroken: NO marca una miniapp que ya estaba incompatible con el publicado", () => {
  const alreadyBroken = [{ id: "old", shared: [{ name: "react-native", requiredRange: "^0.99.0", singleton: true }], nativeModules: [] }];
  assert.deepEqual(findNewlyBroken(published, candidate, alreadyBroken), []); // era incompat, sigue incompat
});
```

- [ ] **Step 2: Correr — falla** (`cd apps/host && node --test scripts/__tests__/check-host-compat.test.mjs`).

- [ ] **Step 3: `apps/host/scripts/check-host-compat.mjs`**

```js
/**
 * Gate de gobernanza del host: valida que un cambio de deps del host NO rompa la
 * flota de miniapps publicadas (blast-radius). "Breaking" = una miniapp compatible
 * con el contract PUBLICADO que pasa a incompatible con el CANDIDATO (del PR).
 * Rollout-safe: sin contract publicado → skip. Override: ACCEPT_BREAKING=true.
 * Uso (CI del host, en PRs de deps): BACKSTAGE_URL=... node scripts/check-host-compat.mjs
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { checkCompatibility } from "@dentvega/miniapp-contract";

/** Miniapps que pasan de compatible (publicado) → incompatible (candidato). */
export function findNewlyBroken(publishedContract, candidateContract, manifests) {
  const broken = [];
  for (const m of manifests) {
    const shared = m.shared ?? [];
    const natives = m.nativeModules ?? [];
    const was = checkCompatibility(publishedContract, shared, natives).compatible;
    const now = checkCompatibility(candidateContract, shared, natives).compatible;
    if (was && !now) {
      const report = checkCompatibility(candidateContract, shared, natives);
      const reason = [
        ...report.skew.entries.filter((e) => e.status !== "ok").map((e) => `${e.name} (${e.status})`),
        ...report.native.missing.map((n) => `${n} (native missing)`),
      ].join("; ");
      broken.push({ id: m.id, reason });
    }
  }
  return broken;
}

// --- CLI ---
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const baseUrl = process.env.BACKSTAGE_URL;
  const acceptBreaking = process.env.ACCEPT_BREAKING === "true";
  if (!baseUrl) { console.error("BACKSTAGE_URL is required"); process.exit(1); }
  const api = baseUrl.replace(/\/+$/, "");
  const __dirname = path.dirname(fileURLToPath(import.meta.url));

  // Contract candidato = el que generaría este PR (corre el generador real).
  execSync("node scripts/gen-host-contract.mjs", { cwd: path.join(__dirname, ".."), stdio: "inherit" });
  const candidate = JSON.parse(readFileSync(path.join(__dirname, "..", "host-contract.json"), "utf8"));

  // Baseline: el contract publicado. Sin él no hay transición que medir → skip.
  let published = null;
  try {
    const res = await fetch(`${api}/api/host-contract`);
    if (res.ok) published = await res.json();
  } catch (err) { console.warn(`check-host-compat: contract fetch failed (${err})`); }
  if (!published) { console.warn("check-host-compat: no published contract — skipping (no baseline)"); process.exit(0); }

  // Flota.
  let manifests = [];
  try {
    const res = await fetch(`${api}/api/manifests`);
    if (res.ok) manifests = (await res.json()).manifests ?? [];
  } catch (err) { console.warn(`check-host-compat: manifests fetch failed (${err}) — skipping`); process.exit(0); }

  const broken = findNewlyBroken(published, candidate, manifests);
  if (broken.length === 0) {
    console.log(`check-host-compat: OK — candidate breaks 0 of ${manifests.length} published miniapp(s)`);
    process.exit(0);
  }
  const detail = broken.map((b) => `${b.id}: ${b.reason}`).join("\n  ");
  const msg = `check-host-compat: this change BREAKS ${broken.length} published miniapp(s):\n  ${detail}`;
  if (acceptBreaking) { console.warn(`${msg}\n[ACCEPT_BREAKING=true → allowed with record]`); process.exit(0); }
  console.error(`${msg}\n[migrate them, or add the 'accept-breaking-contract' label to override]`);
  process.exit(1);
}
```

- [ ] **Step 4: Correr — pasa** (`node --test scripts/__tests__/check-host-compat.test.mjs`) + `pnpm test` (jest, ignora scripts).

- [ ] **Step 5: `.github/workflows/host-compat.yml`** (root del repo del host)

```yaml
name: Host compat gate (blast-radius)
on:
  pull_request:
    paths: ['apps/host/package.json', 'apps/host/shared-deps.mjs', 'pnpm-lock.yaml']
jobs:
  blast-radius:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: apps/host } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: corepack enable && pnpm install --frozen-lockfile
        working-directory: .
      - run: pnpm --filter @dentvega/miniapp-contract build   # dist para el import del script
        working-directory: .
      - run: node scripts/check-host-compat.mjs
        env:
          BACKSTAGE_URL: ${{ secrets.BACKSTAGE_URL }}
          ACCEPT_BREAKING: ${{ contains(github.event.pull_request.labels.*.name, 'accept-breaking-contract') }}
```

- [ ] **Step 6: Commit** (en `backstagereactnative`)

```bash
git add apps/host/scripts/check-host-compat.mjs apps/host/scripts/__tests__/check-host-compat.test.mjs .github/workflows/host-compat.yml
git commit  # feat(host): blast-radius gate — block dep changes that break published miniapps  (+ trailer)
```

---

## Cierre (post-tasks, controller)

1. Review final por repo (backstage-web Task 1; host Task 2).
2. Backstage: `tsc + vitest + next build`. Host: `node --test` de los scripts.
3. **Push** ambos repos.
4. **Governance (manual, operacional):** marcar el check `host-compat / blast-radius` como **required** en la branch protection de `main` del repo del host (paso documentado, como el permiso de Actions PRs).

## Nota de alcance / follow-ups
- El candidato se genera corriendo `gen-host-contract.mjs` real (incluye `react-native config`) → fiel a lo que se publicaría.
- Con esto **el código de las 4 fases está completo**. Queda solo lo operacional (publicar contract, backfill, enforce, republish del package, branch protection) + natives-as-singletons (device).
