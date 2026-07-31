# Fase 2-B — Host generator puebla `nativeModules` (autolinking) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `gen-host-contract.mjs` deje de emitir `nativeModules: []` y liste los módulos nativos REALES del host, enumerados vía autolinking de React Native (`react-native config`). Así el contract describe de verdad el capability set nativo del binario.

**Architecture:** Una función pura `parseAutolinkedNatives(rnConfig)` extrae los deps con código nativo (`platforms.android`/`ios` no-null) del output de `react-native config`. El CLI de `gen-host-contract.mjs` corre `pnpm exec react-native config`, parsea, y pasa la lista a `buildHostContract` (que ahora acepta `nativeModules`). Función pura testeable con fixture; la ejecución del subproceso vive en el CLI.

**Tech Stack:** Node ESM script, `node:test`, `node:child_process` (execSync), React Native CLI (`react-native config`).

## Global Constraints

- **Owner:** DentVega. **Sin dependencias nuevas** (`react-native` CLI ya está).
- **Repo:** `/Volumes/SSDExterno/prodproyects/backstagereactnative`, archivo `apps/host/scripts/gen-host-contract.mjs`. Trabajar desde ahí. Commits **locales** (no push).
- **Backward-compatible:** `buildHostContract` gana un `nativeModules` OPCIONAL (default `[]`) — el test existente (que no lo pasa y espera `[]`) debe seguir verde.
- Tests con `node:test` (jest ignora `scripts/`, ya configurado en Fase 1-D).
- Commits con **paths explícitos**; trailer:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```

---

### Task 1: `parseAutolinkedNatives` + poblar `nativeModules` en el generador

**Files:**
- Modify: `apps/host/scripts/gen-host-contract.mjs`
- Test: `apps/host/scripts/__tests__/gen-host-contract.test.mjs` (agregar casos)

**Interfaces:**
- Produces:
  ```js
  export function parseAutolinkedNatives(rnConfig); // → string[] (deps con native code)
  // buildHostContract gana un 4º campo opcional en el opts: { contractVersion, nativeModules = [] }
  ```

- [ ] **Step 1: Test que falla** — agregar a `apps/host/scripts/__tests__/gen-host-contract.test.mjs`

```js
import { parseAutolinkedNatives } from "../gen-host-contract.mjs";

// Forma real del output de `react-native config`: dependencies[name].platforms.{android,ios}
// es un OBJETO si el dep tiene código nativo en esa plataforma, o null si no.
const RN_CONFIG = {
  dependencies: {
    "@shopify/flash-list": { platforms: { android: { sourceDir: "x" }, ios: {} } },
    "react-native-screens": { platforms: { android: {}, ios: null } },
    "some-pure-js-lib": { platforms: { android: null, ios: null } },
    "@callstack/repack": { platforms: { android: {}, ios: {} } },
  },
};

test("parseAutolinkedNatives: solo los deps con native code (android o ios no-null)", () => {
  const out = parseAutolinkedNatives(RN_CONFIG);
  assert.deepEqual(out.sort(), ["@callstack/repack", "@shopify/flash-list", "react-native-screens"]);
  assert.equal(out.includes("some-pure-js-lib"), false);
});

test("parseAutolinkedNatives: tolera config vacío/sin dependencies", () => {
  assert.deepEqual(parseAutolinkedNatives({}), []);
  assert.deepEqual(parseAutolinkedNatives({ dependencies: {} }), []);
});

test("buildHostContract incluye los nativeModules pasados", () => {
  const fakePkg = (name) => (name === "react-native" ? "0.76.6" : "1.0.0");
  const c = buildHostContract(SHARED_DEPS, fakePkg, { contractVersion: "1.0.0", nativeModules: ["react-native-screens"] });
  assert.deepEqual(c.nativeModules, ["react-native-screens"]);
});
```
(El import de `buildHostContract` y `SHARED_DEPS` ya está en el archivo de test — reusarlo.)

- [ ] **Step 2: Correr — falla** (`cd apps/host && node --test scripts/__tests__/gen-host-contract.test.mjs`).

- [ ] **Step 3: Editar `apps/host/scripts/gen-host-contract.mjs`**

Agregar el import de execSync arriba:
```js
import { execSync } from "node:child_process";
```

Agregar la función pura (después de `buildHostContract`):
```js
/**
 * Extrae los módulos nativos autolinkeados del output de `react-native config`.
 * Un dep es nativo si tiene config de plataforma (android o ios) no-null — o sea,
 * código nativo que debe estar compilado en el binario del host.
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
```

Cambiar la firma de `buildHostContract` para aceptar `nativeModules`:
```js
export function buildHostContract(deps, resolveVersion, { contractVersion, nativeModules = [] }) {
  const shared = {};
  for (const d of deps) shared[d.name] = resolveVersion(d.name);
  return {
    contractVersion,
    reactNative: resolveVersion("react-native"),
    shared,
    nativeModules,
  };
}
```

En el bloque CLI, computar los nativeModules vía `react-native config` y pasarlos:
```js
  // Enumerar los módulos nativos del host (autolinking). Best-effort: si falla, [].
  let nativeModules = [];
  try {
    const raw = execSync("pnpm exec react-native config", {
      cwd: path.join(__dirname, ".."),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    });
    nativeModules = parseAutolinkedNatives(JSON.parse(raw));
  } catch (err) {
    console.warn(`gen-host-contract: react-native config failed (${err}) — nativeModules: []`);
  }
  const contract = buildHostContract(SHARED_DEPS, pkgVersion, { contractVersion, nativeModules });
```
(Reemplaza la línea previa `const contract = buildHostContract(SHARED_DEPS, pkgVersion, { contractVersion });`. El resto del CLI — write + log — igual. Actualizar el log para incluir `contract.nativeModules.length`.)

- [ ] **Step 4: Correr — pasa** (`node --test scripts/__tests__/gen-host-contract.test.mjs`) — los 3 nuevos + los existentes.

- [ ] **Step 5: Smoke del CLI REAL** — `cd apps/host && node scripts/gen-host-contract.mjs && node -p "require('./host-contract.json').nativeModules"` → debe listar los natives reales del host (`@shopify/flash-list`, `react-native-safe-area-context`, `react-native-screens`, `@callstack/repack`). `host-contract.json` sigue gitignoreado (no se commitea).

- [ ] **Step 6: `pnpm test`** (jest) sin regresión (ignora `scripts/`). Si jest cuelga por el open-handle del preset RN, es pre-existente — cortar y confiar en node:test (Fase 1-D lo documentó).

- [ ] **Step 7: Commit**

```bash
git add apps/host/scripts/gen-host-contract.mjs apps/host/scripts/__tests__/gen-host-contract.test.mjs
git commit  # feat(host): populate host-contract nativeModules via RN autolinking  (+ trailer)
```

---

## Cierre (post-tasks, controller)

1. Review final whole-branch (base = commit previo a Task 1).
2. `node --test scripts/__tests__/gen-host-contract.test.mjs` verde + smoke del CLI real muestra los natives.
3. **Push** (repo del host).

## Nota de alcance / follow-ups (resto de Fase 2)
- **Template check-compat**: enumerar los natives de la miniapp (mismo `react-native config`) + `checkNativeModules` → bloquear missing bajo `COMPAT_ENFORCE`. El manifest gana `nativeModules` (derivado en `gen-manifest-shared`).
- **Backstage /upload**: usar `checkCompatibility` completo (skew + nativo) contra el contract guardado; requiere que el manifest traiga `nativeModules`.
- Operacional: al re-publicar el contract (workflow de Fase 1-D), ahora `nativeModules` viene poblado.
