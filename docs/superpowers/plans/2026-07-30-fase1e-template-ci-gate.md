# Fase 1-E — Template CI compat gate (manifest truthful + check) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El gate del lado de la miniapp, en el workflow **reusable** del template (aplica a todas vía `@main`): deriva un `manifest.shared` **truthful** de las deps reales ∩ host contract, y chequea compat contra el contract. **Warn-first + degradación graciosa** — seguro de shipear ya sin romper publishes; se pasa a fail-closed con un flag después del rollout.

**Architecture:** Dos scripts Node **self-contained** en `miniapp-template/scripts/` (usan `semver` directo + `fetch` + `require` para resolver versiones — NO importan el contract package, así no dependen del republish de v0.2.0). Se cablean en `publish.yml` (reusable) entre "Install" y "Publish". Tests con `node:test` (jest ignora `scripts/`). Si el host contract no está publicado (404) → skip con warning (no rompe). Incompatibilidad → warn por defecto; `COMPAT_ENFORCE=1` → falla el build.

**Tech Stack:** Node ESM scripts, `node:test`, `semver` (nueva devDep del template), GitHub Actions reusable workflow.

## Global Constraints

- **Owner:** DentVega. **Única dep nueva:** `semver` (devDependency del template). Nada más.
- **Repo:** `/Volumes/SSDExterno/prodproyects/miniapp-template`. Todo bajo ese repo. Commits **locales** (no push).
- **ROLLOUT-SAFE (invariante):** el gate NO debe romper publishes existentes. Si `GET {BACKSTAGE_URL}/api/host-contract` falla o da 404 → **skip con warning, exit 0**. Incompatibilidad → **warn (exit 0) por defecto**; solo `COMPAT_ENFORCE=1` hace exit 1. gen-manifest-shared, si no hay contract, deja el `manifest.json` como está.
- **`gen-manifest-shared` es quirúrgico:** solo reescribe el campo `shared` y agrega `minHostContract` en `manifest.json`; preserva `id`, `version`, `entry`, `capabilities`. En CI (efímero), no se commitea.
- Los scripts se testean con `node --test <archivo>` (el arg de directorio tiene un quirk en Node 22). Jest debe **ignorar** `scripts/`.
- Commits con **paths explícitos**; trailer en cada commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```

---

### Task 1: `gen-manifest-shared.mjs` — manifest truthful

**Files:**
- Create: `scripts/gen-manifest-shared.mjs`
- Modify: `jest.config.js` (crear si no existe) — ignorar `scripts/`
- Test: `scripts/__tests__/gen-manifest-shared.test.mjs`

**Interfaces:**
- Produces: `deriveShared(contractShared, resolveVersion) → SharedDepSpec[]` (pura); CLI reescribe `manifest.json`.

- [ ] **Step 1: Test que falla** — `scripts/__tests__/gen-manifest-shared.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveShared } from "../gen-manifest-shared.mjs";

// contract.shared del host; resolveVersion simula lo instalado en la miniapp.
const contractShared = { react: "18.3.1", "react-native": "0.76.6", zustand: "5.0.14" };

test("deriveShared: ^versión resuelta para cada shared que la miniapp tiene instalado", () => {
  const resolve = (name) => (name === "zustand" ? null : ({ react: "18.3.1", "react-native": "0.76.9" }[name]));
  const out = deriveShared(contractShared, resolve);
  // react + react-native están; zustand NO (resolve → null) → se omite
  assert.deepEqual(out, [
    { name: "react", requiredRange: "^18.3.1", singleton: true },
    { name: "react-native", requiredRange: "^0.76.9", singleton: true },
  ]);
});

test("deriveShared: vacío si la miniapp no comparte nada", () => {
  assert.deepEqual(deriveShared(contractShared, () => null), []);
});
```

- [ ] **Step 2: Correr — falla** (`node --test scripts/__tests__/gen-manifest-shared.test.mjs`).

- [ ] **Step 3: `scripts/gen-manifest-shared.mjs`**

```js
/**
 * Deriva un manifest.shared TRUTHFUL de las deps reales de la miniapp ∩ el host
 * contract, y lo escribe en manifest.json (+ minHostContract). Reemplaza el
 * `shared` hand-written (que podía mentir). Self-contained (no importa el
 * contract package).
 *
 * Rollout-safe: si el contract no está publicado (404/red) → skip, deja el
 * manifest como está. Uso (en CI): BACKSTAGE_URL=... node scripts/gen-manifest-shared.mjs
 */
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const require = createRequire(import.meta.url);

/** Para cada shared del host que la miniapp tiene instalado, emite ^versión resuelta. */
export function deriveShared(contractShared, resolveVersion) {
  const out = [];
  for (const name of Object.keys(contractShared)) {
    const v = resolveVersion(name);
    if (v) out.push({ name, requiredRange: `^${v}`, singleton: true });
  }
  return out;
}

/** Resuelve la versión instalada de un paquete en la miniapp (o null). */
function installedVersion(name) {
  try {
    return require(`${name}/package.json`).version;
  } catch {
    return null;
  }
}

// --- CLI ---
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const baseUrl = process.env.BACKSTAGE_URL;
  if (!baseUrl) {
    console.error("BACKSTAGE_URL is required");
    process.exit(1);
  }
  let contract = null;
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/host-contract`);
    if (res.ok) contract = await res.json();
    else console.warn(`gen-manifest-shared: host contract HTTP ${res.status} — skipping (manifest unchanged)`);
  } catch (err) {
    console.warn(`gen-manifest-shared: host contract fetch failed (${err}) — skipping`);
  }
  if (contract) {
    const manifestPath = path.resolve("manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    manifest.shared = deriveShared(contract.shared, installedVersion);
    manifest.minHostContract = { reactNative: contract.reactNative, contractVersion: contract.contractVersion };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    console.log(`gen-manifest-shared: derived ${manifest.shared.length} shared dep(s) from contract v${contract.contractVersion}`);
  }
}
```

- [ ] **Step 4: `jest.config.js`** — ignorar `scripts/` (preservar cualquier config existente; si no existe el archivo, crear con `preset` acorde — mirar `package.json`/otros repos RN. Mínimo:)

```js
module.exports = {
  preset: 'react-native',
  testPathIgnorePatterns: ['/node_modules/', '/scripts/'],
};
```
(Si ya hay `jest.config.js`, solo agregar `testPathIgnorePatterns` con `/scripts/`. Verificar que `pnpm test` se comporte igual que antes — si el template no tenía tests jest, mantené ese comportamiento, ej. agregando `passWithNoTests: true` solo si ya fallaba por eso.)

- [ ] **Step 5: Correr — pasa** (`node --test scripts/__tests__/gen-manifest-shared.test.mjs`) + `pnpm test` (jest) sin regresión (ignora `scripts/`).
- [ ] **Step 6: Typecheck** no aplica (`.mjs`). Smoke opcional del CLI sin `BACKSTAGE_URL` → exit 1 con el mensaje.
- [ ] **Step 7: Commit**

```bash
git add scripts/gen-manifest-shared.mjs scripts/__tests__/gen-manifest-shared.test.mjs jest.config.js
git commit  # feat(ci): gen-manifest-shared — truthful manifest.shared from real deps  (+ trailer)
```

---

### Task 2: `check-compat.mjs` — gate de skew (warn-first)

**Files:**
- Modify: `package.json` (devDep `semver`)
- Create: `scripts/check-compat.mjs`
- Test: `scripts/__tests__/check-compat.test.mjs`

**Interfaces:**
- Produces: `checkSkew(contractShared, manifestShared) → { compatible, incompatible: [{name, provided, requiredRange}] }` (pura, semver); CLI hace exit 1 solo con `COMPAT_ENFORCE=1`.

- [ ] **Step 1: Agregar la dep** en `package.json`: `"devDependencies": { ..., "semver": "^7.6.0" }` + `pnpm install`.

- [ ] **Step 2: Test que falla** — `scripts/__tests__/check-compat.test.mjs`

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkSkew } from "../check-compat.mjs";

const contractShared = { "react-native": "0.76.6", react: "18.3.1" };

test("compatible cuando el host satisface el requiredRange", () => {
  const r = checkSkew(contractShared, [
    { name: "react-native", requiredRange: "^0.76.0", singleton: true },
    { name: "react", requiredRange: "^18.3.0", singleton: true },
  ]);
  assert.equal(r.compatible, true);
  assert.deepEqual(r.incompatible, []);
});

test("incompatible cuando el host queda fuera del rango (semver real)", () => {
  const r = checkSkew(contractShared, [
    { name: "react-native", requiredRange: "^0.77.0", singleton: true }, // host 0.76.6 no satisface
  ]);
  assert.equal(r.compatible, false);
  assert.equal(r.incompatible[0].name, "react-native");
});

test("dep que el host NO provee → incompatible (missing)", () => {
  const r = checkSkew(contractShared, [{ name: "react-native-svg", requiredRange: "^15.0.0", singleton: true }]);
  assert.equal(r.compatible, false);
  assert.equal(r.incompatible[0].name, "react-native-svg");
});
```

- [ ] **Step 3: Correr — falla**.

- [ ] **Step 4: `scripts/check-compat.mjs`**

```js
/**
 * Gate de compatibilidad de la miniapp contra el host contract (skew de shared).
 * Self-contained (semver directo). Rollout-safe: sin contract → skip; incompatible
 * → warn por defecto, exit 1 solo con COMPAT_ENFORCE=1.
 * Uso (en CI): BACKSTAGE_URL=... [COMPAT_ENFORCE=1] node scripts/check-compat.mjs
 */
import semver from "semver";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

/** Compara el manifest.shared de la miniapp contra lo que provee el host. */
export function checkSkew(contractShared, manifestShared) {
  const incompatible = [];
  for (const dep of manifestShared) {
    const provided = contractShared[dep.name];
    if (provided === undefined) {
      incompatible.push({ name: dep.name, provided: null, requiredRange: dep.requiredRange });
    } else if (!semver.satisfies(provided, dep.requiredRange, { includePrerelease: false })) {
      incompatible.push({ name: dep.name, provided, requiredRange: dep.requiredRange });
    }
  }
  return { compatible: incompatible.length === 0, incompatible };
}

// --- CLI ---
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const baseUrl = process.env.BACKSTAGE_URL;
  const enforce = process.env.COMPAT_ENFORCE === "1";
  if (!baseUrl) { console.error("BACKSTAGE_URL is required"); process.exit(1); }

  let contract = null;
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/host-contract`);
    if (res.ok) contract = await res.json();
    else console.warn(`check-compat: host contract HTTP ${res.status} — skipping (no gate yet)`);
  } catch (err) {
    console.warn(`check-compat: host contract fetch failed (${err}) — skipping`);
  }
  if (!contract) process.exit(0); // rollout-safe: sin contract, no bloquea

  const manifest = JSON.parse(readFileSync(path.resolve("manifest.json"), "utf8"));
  const { compatible, incompatible } = checkSkew(contract.shared, manifest.shared ?? []);
  if (compatible) {
    console.log(`check-compat: OK vs host contract v${contract.contractVersion}`);
    process.exit(0);
  }
  const detail = incompatible.map((e) => `${e.name} (host ${e.provided ?? "MISSING"}, needs ${e.requiredRange})`).join("; ");
  const msg = `check-compat: INCOMPATIBLE with host contract v${contract.contractVersion} — ${detail}`;
  if (enforce) { console.error(`${msg}\n[COMPAT_ENFORCE=1 → failing the build]`); process.exit(1); }
  console.warn(`${msg}\n[warn mode — set COMPAT_ENFORCE=1 to block]`);
  process.exit(0);
}
```

- [ ] **Step 5: Correr — pasa** (`node --test scripts/__tests__/check-compat.test.mjs`) + `pnpm test` sin regresión.
- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml scripts/check-compat.mjs scripts/__tests__/check-compat.test.mjs
git commit  # feat(ci): check-compat gate vs host contract (warn-first, COMPAT_ENFORCE to block)  (+ trailer)
```

---

### Task 3: Cablear el gate en el workflow reusable `publish.yml`

**Files:**
- Modify: `.github/workflows/publish.yml`

- [ ] **Step 1: Agregar los dos steps** entre "Install deps (GitHub Packages)" y "Build chunk" (necesitan node_modules; se corren antes del build para que el manifest derivado entre al bundle si aplica — el `shared` no afecta el bundle, pero el orden mantiene el manifest coherente antes de `publish.mjs`):

```yaml
      - name: Derive truthful manifest.shared + compat gate
        # gen reescribe manifest.shared desde las deps reales ∩ host contract;
        # check valida el skew. Rollout-safe: sin contract publicado → skip (no rompe).
        # Para bloquear publishes incompatibles, setear COMPAT_ENFORCE=1 (tras el rollout).
        run: |
          node scripts/gen-manifest-shared.mjs
          node scripts/check-compat.mjs
        env:
          BACKSTAGE_URL: ${{ secrets.BACKSTAGE_URL }}
          COMPAT_ENFORCE: ${{ vars.COMPAT_ENFORCE }}
```
(No tocar el resto del workflow. `vars.COMPAT_ENFORCE` es una repo/org variable — vacía por defecto → warn; se setea a `1` cuando se quiere enforce. `secrets.BACKSTAGE_URL` ya está declarado en el `workflow_call`.)

- [ ] **Step 2: Lint del YAML** (visual / `node -e "require('yaml')"` no disponible — revisar indentación a mano; el resto del archivo intacto).

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/publish.yml
git commit  # feat(ci): wire compat gate into reusable publish workflow (warn-first)  (+ trailer)
```

---

## Cierre (post-tasks, controller)

1. Review final whole-branch (base = commit previo a Task 1).
2. `node --test scripts/gen-manifest-shared.test.mjs scripts/check-compat.test.mjs` + `pnpm test` (jest) — todo verde.
3. **Push** (coordinar con el owner — repo del template).
4. Como toca el workflow reusable, el próximo publish de CADA miniapp ya corre el gate (warn). Verificar en la primera corrida real que degrada bien (sin contract → skip).

## Operacional / follow-ups
- Este gate es **warn-first**: no bloquea hasta setear la repo/org variable `COMPAT_ENFORCE=1` — hacerlo DESPUÉS de: publicar el host contract (Fase 1-D operacional), backfillear la flota (re-publicar para que carguen el `shared` derivado), y validar en sombra que nadie queda incompatible.
- **Backfill**: re-publicar las miniapps existentes (Deploy/dispatch) → sus manifests cargan el `shared` truthful. Sin esto, el blast-radius de Fase 4 sigue ciego.
- **Fase 2** agrega la detección nativa (autolinking) a `check-compat` (hoy solo skew).
- Los cambios del template se propagan a las miniapps existentes vía Capa 2 (template-sync).
