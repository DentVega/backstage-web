# Fase 1-D — Host Contract generator + publish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer el Host Contract **real**: una fuente única de los shared deps del host, un generador que emite `host-contract.json` (versiones resueltas), y un publish que lo sube a Backstage (`PUT /api/host-contract`). A partir de acá el gate warn-mode de Backstage loguea datos reales.

**Architecture:** Se extrae el bloque `shared` del `rspack.config.mjs` a `apps/host/shared-deps.mjs` (fuente única), consumido por rspack (vía `buildMfShared`, **behavior-preserving**, snapshot-tested) y por el generador. El generador y el publish son scripts Node bajo `apps/host/scripts/`, testeados con `node:test` (jest los ignora). El host consume `@dentvega/miniapp-contract` vía `workspace:*` → ya tiene `isHostContract` (v0.2.0), sin republish.

**Tech Stack:** Node ESM scripts, `node:test` (NO jest para los scripts), `@dentvega/miniapp-contract` (workspace, `isHostContract`), rspack/Re.Pack MF config.

## Global Constraints

- **Owner:** DentVega. **Sin dependencias nuevas.**
- **Repo:** `/Volumes/SSDExterno/prodproyects/backstagereactnative`, todo bajo `apps/host`. Trabajar desde ahí. Commits **locales** (no push; el controller pushea tras la review final).
- **Behavior-preserving:** el refactor del `shared` NO debe cambiar el objeto que recibe `ModuleFederationPluginV2` — `buildMfShared(SHARED_DEPS, pkgVersion)` tiene que producir **exactamente** el bloque actual (snapshot-test lo bloquea).
- **FUERA DE ALCANCE (diferido): natives-as-singletons.** Agregar `react-native-screens`/`safe-area-context`/`reanimated` al `shared` cambia el runtime del host y **necesita validación en device** — NO va en este plan. El generador emite `nativeModules: []` (se puebla en Fase 2). Este plan usa el set de shared ACTUAL.
- Tests de scripts con `node --test` (jest usa preset `react-native`, no sirve para scripts Node puros). Jest debe **ignorar** `scripts/`.
- Commits con **paths explícitos**; trailer en cada commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```

---

### Task 1: Fuente única de shared deps + refactor del rspack (behavior-preserving)

**Files:**
- Create: `apps/host/shared-deps.mjs`
- Modify: `apps/host/rspack.config.mjs` (consume la fuente única)
- Modify: `apps/host/jest.config.js` (ignorar `scripts/`)
- Test: `apps/host/scripts/__tests__/shared-deps.test.mjs` (node:test snapshot)

**Interfaces:**
- Produces:
  ```js
  export const SHARED_DEPS = [ { name, requiredVersion, provideVersion? }, ... ];
  export function buildMfShared(deps, pkgVersion); // → objeto shared de MF, idéntico al actual
  ```

- [ ] **Step 1: Test que falla** — `apps/host/scripts/__tests__/shared-deps.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { SHARED_DEPS, buildMfShared } from "../../shared-deps.mjs";

// pkgVersion falso y determinista para el snapshot.
const fakePkg = (name) => `v(${name})`;

test("buildMfShared reproduce EXACTAMENTE el bloque shared actual", () => {
  const out = buildMfShared(SHARED_DEPS, fakePkg);
  assert.deepEqual(out, {
    react: { singleton: true, eager: true, requiredVersion: "18.3.1" },
    "react-native": { singleton: true, eager: true, requiredVersion: "0.76.6" },
    "@tanstack/react-query": { singleton: true, eager: true, version: "v(@tanstack/react-query)", requiredVersion: "^5.0.0" },
    "@shopify/flash-list": { singleton: true, eager: true, version: "v(@shopify/flash-list)", requiredVersion: "^1.7.0" },
    zustand: { singleton: true, eager: true, version: "v(zustand)", requiredVersion: "^5.0.0" },
    "@react-navigation/native": { singleton: true, eager: true, version: "v(@react-navigation/native)", requiredVersion: "^7.0.0" },
    "@react-navigation/native-stack": { singleton: true, eager: true, version: "v(@react-navigation/native-stack)", requiredVersion: "^7.0.0" },
    "@dentvega/ui-kit": { singleton: true, eager: true, version: "v(@dentvega/ui-kit)", requiredVersion: "^0.1.0" },
  });
});

test("react y react-native NO llevan campo version (solo requiredVersion exacto)", () => {
  const out = buildMfShared(SHARED_DEPS, fakePkg);
  assert.equal("version" in out.react, false);
  assert.equal("version" in out["react-native"], false);
});
```

- [ ] **Step 2: Correr — falla** (`cd apps/host && node --test scripts/__tests__/shared-deps.test.mjs`) → módulo no existe.

- [ ] **Step 3: `apps/host/shared-deps.mjs`**

```js
/**
 * Fuente ÚNICA de los shared singletons del host (Module Federation).
 * Consumida por rspack.config.mjs (para el `shared` de MF) y por
 * scripts/gen-host-contract.mjs (para el Host Contract). Antes estaba duplicada.
 */
export const SHARED_DEPS = [
  { name: "react", requiredVersion: "18.3.1" },
  { name: "react-native", requiredVersion: "0.76.6" },
  { name: "@tanstack/react-query", requiredVersion: "^5.0.0", provideVersion: true },
  { name: "@shopify/flash-list", requiredVersion: "^1.7.0", provideVersion: true },
  { name: "zustand", requiredVersion: "^5.0.0", provideVersion: true },
  { name: "@react-navigation/native", requiredVersion: "^7.0.0", provideVersion: true },
  { name: "@react-navigation/native-stack", requiredVersion: "^7.0.0", provideVersion: true },
  { name: "@dentvega/ui-kit", requiredVersion: "^0.1.0", provideVersion: true },
];

/**
 * Construye el objeto `shared` de ModuleFederationPluginV2 a partir de SHARED_DEPS.
 * Todos son singleton+eager (invariante del host). Los `provideVersion` advierten la
 * versión resuelta (`pkgVersion(name)`); react/react-native no la llevan (igual que hoy).
 */
export function buildMfShared(deps, pkgVersion) {
  const shared = {};
  for (const d of deps) {
    shared[d.name] = { singleton: true, eager: true };
    if (d.provideVersion) shared[d.name].version = pkgVersion(d.name);
    shared[d.name].requiredVersion = d.requiredVersion;
  }
  return shared;
}
```
> Nota de orden de claves: el bloque original pone `version` antes de `requiredVersion` en los 6 que la llevan. `buildMfShared` respeta ese orden (setea `version` antes de `requiredVersion`). `deepEqual` no depende del orden, pero mantenerlo evita ruido en el diff del bundle.

- [ ] **Step 4: `apps/host/rspack.config.mjs`** — consumir la fuente única

Import arriba (junto a los otros imports):
```js
import { SHARED_DEPS, buildMfShared } from './shared-deps.mjs';
```
Reemplazar el bloque inline `shared: { ... }` (las ~42 líneas del objeto) por:
```js
      shared: buildMfShared(SHARED_DEPS, pkgVersion),
```
(Dejar `pkgVersion` como está — se lo pasás a `buildMfShared`. No tocar `remotes`, `name`, `dts`, `dev`.)

- [ ] **Step 5: `apps/host/jest.config.js`** — que jest ignore `scripts/`

Agregar al `module.exports`:
```js
  testPathIgnorePatterns: ['/node_modules/', '/scripts/'],
```

- [ ] **Step 6: Correr los tests**
  - Node: `cd apps/host && node --test scripts/__tests__/shared-deps.test.mjs` → PASS.
  - Jest: `cd apps/host && pnpm test` → sigue verde (ignora `scripts/`, no intenta correr el `.test.mjs`).

- [ ] **Step 7: Smoke check del config** (best-effort — el config importa Repack; si no carga standalone, alcanza con el snapshot test, dejarlo documentado):
`cd apps/host && node --input-type=module -e "await import('./rspack.config.mjs'); console.log('config loaded')"` — si carga sin error, listo; si falla por el entorno de Repack, anotarlo y confiar en el snapshot test.

- [ ] **Step 8: Commit**

```bash
git add apps/host/shared-deps.mjs apps/host/rspack.config.mjs apps/host/jest.config.js apps/host/scripts/__tests__/shared-deps.test.mjs
git commit  # refactor(host): single source of MF shared deps (behavior-preserving)  (+ trailer)
```

---

### Task 2: Generador `gen-host-contract.mjs`

**Files:**
- Create: `apps/host/scripts/gen-host-contract.mjs`
- Test: `apps/host/scripts/__tests__/gen-host-contract.test.mjs`

**Interfaces:**
- Consumes: `SHARED_DEPS` (Task 1), `isHostContract` (`@dentvega/miniapp-contract`, workspace).
- Produces: `buildHostContract(deps, pkgVersion, { contractVersion }) → HostContract`; el script CLI escribe `apps/host/host-contract.json`.

- [ ] **Step 1: Test que falla** — `apps/host/scripts/__tests__/gen-host-contract.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHostContract } from "../gen-host-contract.mjs";
import { SHARED_DEPS } from "../../shared-deps.mjs";
import { isHostContract } from "@dentvega/miniapp-contract";

const fakePkg = (name) => (name === "react-native" ? "0.76.6" : `1.0.0`);

test("buildHostContract emite un HostContract válido con las versiones resueltas", () => {
  const c = buildHostContract(SHARED_DEPS, fakePkg, { contractVersion: "1.2.3" });
  assert.equal(c.contractVersion, "1.2.3");
  assert.equal(c.reactNative, "0.76.6");
  assert.equal(c.shared["react-native"], "0.76.6");
  assert.equal(c.shared["@dentvega/ui-kit"], "1.0.0");
  assert.deepEqual(c.nativeModules, []); // Fase 2 los puebla
  assert.equal(isHostContract(c), true);
});
```

- [ ] **Step 2: Correr — falla** (`node --test scripts/__tests__/gen-host-contract.test.mjs`).

- [ ] **Step 3: `apps/host/scripts/gen-host-contract.mjs`**

```js
/**
 * Genera el Host Contract (host-contract.json) desde la fuente única SHARED_DEPS
 * + las versiones instaladas. nativeModules queda [] hasta Fase 2 (autolinking).
 * Uso: node scripts/gen-host-contract.mjs   (escribe apps/host/host-contract.json)
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { SHARED_DEPS } from "../shared-deps.mjs";

const require = createRequire(import.meta.url);
const pkgVersion = (name) => require(`${name}/package.json`).version;

/** Construye el HostContract (pura, testeable). */
export function buildHostContract(deps, resolveVersion, { contractVersion }) {
  const shared = {};
  for (const d of deps) shared[d.name] = resolveVersion(d.name);
  return {
    contractVersion,
    reactNative: resolveVersion("react-native"),
    shared,
    nativeModules: [],
  };
}

// --- CLI ---
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const hostPkg = JSON.parse(readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
const contractVersion = process.env.CONTRACT_VERSION ?? hostPkg.version ?? "1.0.0";

// El bloque CLI solo corre cuando se ejecuta directo (no al importar en tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const contract = buildHostContract(SHARED_DEPS, pkgVersion, { contractVersion });
  const out = path.join(__dirname, "..", "host-contract.json");
  writeFileSync(out, `${JSON.stringify(contract, null, 2)}\n`, "utf8");
  console.log(`wrote ${out} (contractVersion ${contractVersion}, rn ${contract.reactNative})`);
}
```

- [ ] **Step 4: Correr — pasa** (`node --test scripts/__tests__/gen-host-contract.test.mjs`).
- [ ] **Step 5: Smoke del CLI** — `cd apps/host && node scripts/gen-host-contract.mjs && cat host-contract.json` → JSON válido con versiones reales. (NO commitear `host-contract.json` — es un artefacto generado; agregarlo a `.gitignore` de apps/host.)
- [ ] **Step 6: `.gitignore`** — agregar `host-contract.json` en `apps/host/.gitignore` (crear si no existe).
- [ ] **Step 7: Commit**

```bash
git add apps/host/scripts/gen-host-contract.mjs apps/host/scripts/__tests__/gen-host-contract.test.mjs apps/host/.gitignore
git commit  # feat(host): gen-host-contract.mjs — emits host-contract.json from shared source  (+ trailer)
```

---

### Task 3: Publish `publish-host-contract.mjs` + workflow

**Files:**
- Create: `apps/host/scripts/publish-host-contract.mjs`
- Create: `apps/host/.github/workflows/host-contract.yml` (documentado — NO validado por CI acá)
- Test: `apps/host/scripts/__tests__/publish-host-contract.test.mjs`

**Interfaces:**
- Produces: `buildPutRequest(baseUrl, token, contract) → { url, init }` (pura, testeable); el script hace `fetch` real.

- [ ] **Step 1: Test que falla** — `apps/host/scripts/__tests__/publish-host-contract.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPutRequest, publishHostContract } from "../publish-host-contract.mjs";

const CONTRACT = { contractVersion: "1.0.0", reactNative: "0.76.6", shared: {}, nativeModules: [] };

test("buildPutRequest arma el PUT con Bearer y JSON", () => {
  const { url, init } = buildPutRequest("https://b.example/", "tok", CONTRACT);
  assert.equal(url, "https://b.example/api/host-contract");
  assert.equal(init.method, "PUT");
  assert.equal(init.headers.authorization, "Bearer tok");
  assert.equal(init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(init.body), CONTRACT);
});

test("publishHostContract lanza si el PUT no es ok", async () => {
  const fakeFetch = async () => ({ ok: false, status: 401, text: async () => "no" });
  await assert.rejects(
    () => publishHostContract("https://b.example", "tok", CONTRACT, fakeFetch),
    /401/,
  );
});

test("publishHostContract resuelve en 200", async () => {
  const fakeFetch = async () => ({ ok: true, status: 200, text: async () => "ok" });
  await assert.doesNotReject(() => publishHostContract("https://b.example", "tok", CONTRACT, fakeFetch));
});
```

- [ ] **Step 2: Correr — falla**.

- [ ] **Step 3: `apps/host/scripts/publish-host-contract.mjs`**

```js
/**
 * Sube host-contract.json a Backstage (PUT /api/host-contract) con el
 * HOST_CONTRACT_TOKEN dedicado. Uso (en CI/release del host):
 *   BACKSTAGE_URL=... HOST_CONTRACT_TOKEN=... node scripts/publish-host-contract.mjs
 * Requiere que gen-host-contract.mjs haya corrido antes (host-contract.json).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export function buildPutRequest(baseUrl, token, contract) {
  const url = `${baseUrl.replace(/\/+$/, "")}/api/host-contract`;
  return {
    url,
    init: {
      method: "PUT",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(contract),
    },
  };
}

export async function publishHostContract(baseUrl, token, contract, fetchImpl = fetch) {
  const { url, init } = buildPutRequest(baseUrl, token, contract);
  const res = await fetchImpl(url, init);
  if (!res.ok) {
    throw new Error(`publish host-contract failed: HTTP ${res.status} — ${await res.text()}`);
  }
}

// --- CLI ---
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const baseUrl = process.env.BACKSTAGE_URL;
  const token = process.env.HOST_CONTRACT_TOKEN;
  if (!baseUrl || !token) {
    console.error("BACKSTAGE_URL and HOST_CONTRACT_TOKEN are required");
    process.exit(1);
  }
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const contract = JSON.parse(readFileSync(path.join(__dirname, "..", "host-contract.json"), "utf8"));
  await publishHostContract(baseUrl, token, contract);
  console.log(`published host-contract v${contract.contractVersion} to ${baseUrl}`);
}
```

- [ ] **Step 4: Correr — pasa** (`node --test scripts/__tests__/publish-host-contract.test.mjs`).

- [ ] **Step 5: `apps/host/.github/workflows/host-contract.yml`** (documentado; no se valida acá)

```yaml
name: Publish host contract
on:
  workflow_dispatch:
  push:
    branches: [main]
    paths: ['apps/host/shared-deps.mjs', 'apps/host/package.json']
jobs:
  publish:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: apps/host } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24 }
      - run: corepack enable && pnpm install --frozen-lockfile
        working-directory: .
      - run: node scripts/gen-host-contract.mjs
      - run: node scripts/publish-host-contract.mjs
        env:
          BACKSTAGE_URL: ${{ secrets.BACKSTAGE_URL }}
          HOST_CONTRACT_TOKEN: ${{ secrets.HOST_CONTRACT_TOKEN }}
```

- [ ] **Step 6: Commit**

```bash
git add apps/host/scripts/publish-host-contract.mjs apps/host/scripts/__tests__/publish-host-contract.test.mjs apps/host/.github/workflows/host-contract.yml
git commit  # feat(host): publish-host-contract.mjs + workflow (PUT to Backstage)  (+ trailer)
```

---

## Cierre (post-tasks, controller)

1. Review final whole-branch (base = commit previo a Task 1).
2. `cd apps/host && node --test scripts/ && pnpm test` (jest verde) — todo pasa.
3. **Push** (coordinar con el owner — repo del host).

## Operacional / follow-ups
- Setear los secrets `BACKSTAGE_URL` + `HOST_CONTRACT_TOKEN` en el repo del host (para el workflow) y `HOST_CONTRACT_TOKEN` en Vercel (de Fase 1-A).
- Correr el workflow (o `gen` + `publish` a mano) → Backstage tiene el contract real → el gate warn-mode empieza a loguear datos reales.
- **Diferido:** natives-as-singletons (agregar screens/safe-area/reanimated a `SHARED_DEPS`) — validar en device antes; recién ahí el generador los incluye y Fase 2 puebla `nativeModules`.
