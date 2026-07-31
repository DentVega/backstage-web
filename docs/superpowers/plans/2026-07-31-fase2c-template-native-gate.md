# Fase 2-C — Template gate: detección nativa de la miniapp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el lado de la miniapp para la **Falla B**: `gen-manifest-shared` agrega al manifest los módulos nativos que la miniapp autolinkea (`react-native config`), y `check-compat` los valida contra `contract.nativeModules` — bloqueando los que el host no tiene (bajo `COMPAT_ENFORCE`).

**Architecture:** Extiende los dos scripts self-contained ya existentes (Fase 1-E) en `miniapp-template/scripts/`. `gen-manifest-shared` gana `parseAutolinkedNatives` + escribe `manifest.nativeModules`. `check-compat` gana `checkNatives` (set-difference) y combina skew + nativo en el veredicto. El wiring en `publish.yml` ya existe — no se toca. Warn-first + rollout-safe mantenidos.

**Tech Stack:** Node ESM scripts, `node:test`, `node:child_process` (execSync), `semver` (ya presente), React Native CLI.

## Global Constraints

- **Owner:** DentVega. **Sin dependencias nuevas.**
- **Repo:** `/Volumes/SSDExterno/prodproyects/miniapp-template`. Commits **locales** (no push).
- **ROLLOUT-SAFE + WARN-FIRST (invariante, se mantiene):** sin contract → skip; `react-native config` que falla → `nativeModules: []` (best-effort, no rompe); incompatible (skew O nativo) → warn por defecto, exit 1 solo con `COMPAT_ENFORCE=1`.
- **Self-contained:** `checkNatives`/`parseAutolinkedNatives` inline (set-difference / filtro) — NO importar el contract package (no acoplar al republish).
- Tests con `node:test`. Commits con **paths explícitos**; trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```

---

### Task 1: `gen-manifest-shared` escribe `manifest.nativeModules`

**Files:**
- Modify: `scripts/gen-manifest-shared.mjs`
- Test: `scripts/__tests__/gen-manifest-shared.test.mjs` (agregar casos)

**Interfaces:**
- Produces: `parseAutolinkedNatives(rnConfig) → string[]` (deps con native code).

- [ ] **Step 1: Test que falla** — agregar a `scripts/__tests__/gen-manifest-shared.test.mjs`

```js
import { parseAutolinkedNatives } from "../gen-manifest-shared.mjs";

const RN_CONFIG = {
  dependencies: {
    "react-native-svg": { platforms: { android: { sourceDir: "x" }, ios: {} } },
    "react-native-screens": { platforms: { android: {}, ios: null } },
    "some-pure-js-lib": { platforms: { android: null, ios: null } },
  },
};

test("parseAutolinkedNatives: solo deps con native code (android o ios no-null)", () => {
  const out = parseAutolinkedNatives(RN_CONFIG);
  assert.deepEqual(out.sort(), ["react-native-screens", "react-native-svg"]);
});

test("parseAutolinkedNatives: tolera config vacío", () => {
  assert.deepEqual(parseAutolinkedNatives({}), []);
  assert.deepEqual(parseAutolinkedNatives({ dependencies: {} }), []);
});
```

- [ ] **Step 2: Correr — falla** (`node --test scripts/__tests__/gen-manifest-shared.test.mjs`).

- [ ] **Step 3: Editar `scripts/gen-manifest-shared.mjs`**

Agregar el import:
```js
import { execSync } from "node:child_process";
```

Agregar la función pura (después de `deriveShared`):
```js
/**
 * Módulos nativos que la miniapp autolinkea (del output de `react-native config`).
 * Un dep es nativo si tiene config de plataforma (android o ios) no-null.
 */
export function parseAutolinkedNatives(rnConfig) {
  const deps = rnConfig?.dependencies ?? {};
  return Object.entries(deps)
    .filter(([, d]) => {
      const p = d?.platforms ?? {};
      return (p.android != null) || (p.ios != null);
    })
    .map(([name]) => name);
}

/** Corre `react-native config` y devuelve los natives autolinkeados (best-effort → []). */
function miniappNativeModules() {
  try {
    const raw = execSync("pnpm exec react-native config", {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseAutolinkedNatives(JSON.parse(raw));
  } catch (err) {
    console.warn(`gen-manifest-shared: react-native config failed (${err}) — nativeModules: []`);
    return [];
  }
}
```

En el bloque CLI, dentro del `if (contract) { ... }`, después de setear `manifest.minHostContract`, agregar:
```js
    manifest.nativeModules = miniappNativeModules();
```
Y actualizar el `console.log` final para incluir `manifest.nativeModules.length` (ej. `... + N native(s)`).

- [ ] **Step 4: Correr — pasa** (`node --test scripts/__tests__/gen-manifest-shared.test.mjs`).
- [ ] **Step 5: `pnpm test`** (jest) sin regresión (ignora `scripts/`).
- [ ] **Step 6: Commit**

```bash
git add scripts/gen-manifest-shared.mjs scripts/__tests__/gen-manifest-shared.test.mjs
git commit  # feat(ci): gen-manifest-shared writes manifest.nativeModules (autolinking)  (+ trailer)
```

---

### Task 2: `check-compat` valida los natives contra el contract

**Files:**
- Modify: `scripts/check-compat.mjs`
- Test: `scripts/__tests__/check-compat.test.mjs` (agregar casos)

**Interfaces:**
- Produces: `checkNatives(contractNativeModules, manifestNativeModules) → string[]` (los natives de la miniapp que el host NO tiene).

- [ ] **Step 1: Test que falla** — agregar a `scripts/__tests__/check-compat.test.mjs`

```js
import { checkNatives } from "../check-compat.mjs";

describe("checkNatives", () => {
  const hostNatives = ["react-native-screens", "react-native-safe-area-context"];

  it("[] cuando todos los natives de la miniapp están en el host", () => {
    assert.deepEqual(checkNatives(hostNatives, ["react-native-screens"]), []);
  });
  it("lista los natives faltantes", () => {
    assert.deepEqual(checkNatives(hostNatives, ["react-native-screens", "react-native-svg"]), ["react-native-svg"]);
  });
  it("crash-proof si contractNatives viene undefined", () => {
    assert.deepEqual(checkNatives(undefined, ["react-native-svg"]), ["react-native-svg"]);
  });
});
```
(Nota: si el runner de este archivo es `describe`/`it` de node:test, importarlos: `import { test, describe, it } from "node:test";` — seguir el estilo ya presente en el archivo.)

- [ ] **Step 2: Correr — falla**.

- [ ] **Step 3: Editar `scripts/check-compat.mjs`**

Agregar la función pura (después de `checkSkew`):
```js
/** Natives que la miniapp necesita y el host NO provee (set-difference). Crash-proof. */
export function checkNatives(contractNativeModules, manifestNativeModules) {
  const host = new Set(contractNativeModules ?? []);
  return (manifestNativeModules ?? []).filter((m) => !host.has(m));
}
```

En el CLI, reemplazar el bloque desde `const { compatible, incompatible } = checkSkew(...)` hasta el final por:
```js
  const manifest = JSON.parse(readFileSync(path.resolve("manifest.json"), "utf8"));
  const skew = checkSkew(contract.shared, manifest.shared ?? []);
  const missingNatives = checkNatives(contract.nativeModules, manifest.nativeModules ?? []);
  const compatible = skew.compatible && missingNatives.length === 0;
  if (compatible) {
    console.log(`check-compat: OK vs host contract v${contract.contractVersion}`);
    process.exit(0);
  }
  const skewDetail = skew.incompatible.map((e) => `${e.name} (host ${e.provided ?? "MISSING"}, needs ${e.requiredRange})`);
  const nativeDetail = missingNatives.map((n) => `${n} (native module not in host)`);
  const detail = [...skewDetail, ...nativeDetail].join("; ");
  const msg = `check-compat: INCOMPATIBLE with host contract v${contract.contractVersion} — ${detail}`;
  if (enforce) { console.error(`${msg}\n[COMPAT_ENFORCE=1 → failing the build]`); process.exit(1); }
  console.warn(`${msg}\n[warn mode — set COMPAT_ENFORCE=1 to block]`);
  process.exit(0);
```

- [ ] **Step 4: Correr — pasa** (`node --test scripts/__tests__/check-compat.test.mjs`) — los nuevos + los existentes de skew.
- [ ] **Step 5: `pnpm test`** (jest) sin regresión.
- [ ] **Step 6: Commit**

```bash
git add scripts/check-compat.mjs scripts/__tests__/check-compat.test.mjs
git commit  # feat(ci): check-compat blocks native modules absent from the host  (+ trailer)
```

---

## Cierre (post-tasks, controller)

1. Review final whole-branch (base = commit previo a Task 1). Verificar sobre todo que el warn-first/rollout-safe sigue intacto (natives faltantes → warn por defecto, no rompe; react-native config que falla → []).
2. `node --test scripts/__tests__/gen-manifest-shared.test.mjs scripts/__tests__/check-compat.test.mjs` verde.
3. **Push** (repo del template). Como toca los scripts del gate reusable, el próximo publish de cada miniapp sincronizada ya chequea natives (warn).

## Nota de alcance / follow-ups
- **Backstage /upload** (último slice de Fase 2): usar `checkCompatibility` completo (skew + nativo) contra el contract guardado; el manifest ya trae `nativeModules` (de acá). Agregar `nativeModules?` al `Manifest` del contract package + isManifest.
- El guard de existencia del step (Fase 1-E) sigue protegiendo a las miniapps no sincronizadas.
- Operacional: pasar a enforce (`COMPAT_ENFORCE=1`) recién tras publicar el contract (con natives, de Fase 2-B) + backfill + validar en sombra.
