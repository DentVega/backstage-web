# Check de reconciliación package.json ↔ SHARED_DEPS — Design

**Fecha:** 2026-08-04
**Estado:** Aprobado (listo para plan)
**Repo:** `backstagereactnative` (host)
**Owner:** <owner>

---

## Goal

Un check que fuerce a **clasificar cada runtime dependency del host** como *shared*, *native* o *bundled*, de modo que:
- Agregar una dep al `package.json` sin decidir su clasificación **falla el CI** (cierra el hueco "me olvidé de promoverla a `SHARED_DEPS`").
- Dejar en `SHARED_DEPS` una dep que ya no está en `package.json` **falla con un mensaje claro** (hoy es un crash `MODULE_NOT_FOUND` en `gen-host-contract`).

## Background

`SHARED_DEPS` (en `apps/host/shared-deps.mjs`) es una lista **curada a mano** de los singletons que el host provee. Hoy NO hay reconciliación explícita contra las deps reales del `package.json`. Las 12 runtime deps del host se clasifican en tres grupos:
- **8 shared** (react, react-native, @tanstack/react-query, @shopify/flash-list, zustand, @react-navigation/native, @react-navigation/native-stack, @dentvega/ui-kit).
- **native** (react-native-safe-area-context, react-native-screens; @shopify/flash-list es shared *y* native).
- **bundled/internas** (@dentvega/host-runtime, @dentvega/miniapp-contract) — el host las bundlea, no son singletons.

Lo único que hoy cubre esto es indirecto: `pkgVersion` crashea si una `SHARED_DEP` no está instalada; el snapshot test obliga a que editar `SHARED_DEPS` sea deliberado; `missingProvenance` exige `CAPABILITY_SINCE`. Falta el gate directo sobre "toda dep está clasificada".

## Approach

Agregar a `shared-deps.mjs`:
- Una lista nueva **`BUNDLED_DEPS`** (las runtime deps deliberadamente NO compartidas).
- Una función pura **`reconcileDeps(dependencies, { shared, native, bundled })`** que devuelve las violaciones.

Y en `shared-deps.test.mjs` (que ya corre en el `tests.yml` del host → **gatea PRs**):
- Tests unitarios de `reconcileDeps` (fixtures).
- Un test de integración que lee el **`package.json` real** del host y assertea **cero violaciones**.

Sin workflow nuevo (reusa el `test` required check). Sin CLI (el test ES el gate). Scope: solo `dependencies` (los devDeps nunca se comparten).

Alternativa descartada: un script CLI aparte con su propio step de CI — innecesario, el test node:test ya gatea y es la unidad natural.

## Diseño detallado

### `apps/host/shared-deps.mjs`

```js
/** Runtime deps que el host bundlea (NO son singletons compartidos). Mantener al día
 *  con package.json: el check de reconciliación exige que TODA runtime dep esté en
 *  SHARED_DEPS, en CAPABILITY_SINCE.native, o acá. */
export const BUNDLED_DEPS = ["@dentvega/host-runtime", "@dentvega/miniapp-contract"];

/**
 * Reconcilia las runtime deps del host contra su clasificación (shared | native | bundled).
 * Devuelve las violaciones (listas vacías = OK). Pura y testeable.
 */
export function reconcileDeps(dependencies, { shared, native, bundled }) {
  const classified = new Set([...shared, ...native, ...bundled]);
  const depSet = new Set(dependencies);
  return {
    unclassified: dependencies.filter((d) => !classified.has(d)),
    phantomShared: shared.filter((n) => !depSet.has(n)),
    staleBundled: bundled.filter((n) => !depSet.has(n)),
    conflicting: shared.filter((n) => bundled.includes(n)),
  };
}
```

Semántica:
- **`unclassified`** — deps del `package.json` que no caen en ninguna lista → *"clasificá X"*. (cierra el hueco al agregar)
- **`phantomShared`** — nombres en `SHARED_DEPS` que no son deps reales. (catch al eliminar; mensaje claro vs crash)
- **`staleBundled`** — nombres en `BUNDLED_DEPS` que ya no son deps. (mantiene la lista honesta)
- **`conflicting`** — un nombre en `SHARED_DEPS` y `BUNDLED_DEPS` a la vez (contradicción).

Nota: **no** se exige `native ⊆ dependencies` — un native como `@callstack/repack` es devDep (autolinkeado), no runtime dep. Los natives se validan aparte (`missingProvenance` vs autolinking).

### `apps/host/scripts/__tests__/shared-deps.test.mjs` (agregar)

Unitarios (fixtures) + integración con el `package.json` real:
```js
import { readFileSync } from "node:fs";
import { SHARED_DEPS, CAPABILITY_SINCE, BUNDLED_DEPS, reconcileDeps } from "../../shared-deps.mjs";

const cls = () => ({ shared: SHARED_DEPS.map((d) => d.name), native: Object.keys(CAPABILITY_SINCE.native), bundled: BUNDLED_DEPS });

test("reconcileDeps: dep sin clasificar → unclassified", () => {
  const r = reconcileDeps(["react", "misteriosa"], { shared: ["react"], native: [], bundled: [] });
  assert.deepEqual(r.unclassified, ["misteriosa"]);
});
test("reconcileDeps: shared que no es dep real → phantomShared", () => {
  const r = reconcileDeps(["react"], { shared: ["react", "fantasma"], native: [], bundled: [] });
  assert.deepEqual(r.phantomShared, ["fantasma"]);
});
test("reconcileDeps: bundled stale + conflicting", () => {
  const r = reconcileDeps(["react"], { shared: ["react"], native: [], bundled: ["react", "vieja"] });
  assert.deepEqual(r.staleBundled, ["vieja"]);
  assert.deepEqual(r.conflicting, ["react"]);
});
test("reconcileDeps: todo clasificado → sin violaciones", () => {
  const r = reconcileDeps(["react", "rn-screens", "@dentvega/host-runtime"], { shared: ["react"], native: ["rn-screens"], bundled: ["@dentvega/host-runtime"] });
  assert.deepEqual(r, { unclassified: [], phantomShared: [], staleBundled: [], conflicting: [] });
});

test("EL package.json del host está reconciliado (gate real)", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
  const r = reconcileDeps(Object.keys(pkg.dependencies ?? {}), cls());
  assert.deepEqual(r.unclassified, [], `runtime deps sin clasificar → agregalas a SHARED_DEPS / CAPABILITY_SINCE.native / BUNDLED_DEPS: ${r.unclassified.join(", ")}`);
  assert.deepEqual(r.phantomShared, [], `en SHARED_DEPS pero no en package.json: ${r.phantomShared.join(", ")}`);
  assert.deepEqual(r.staleBundled, [], `en BUNDLED_DEPS pero no en package.json: ${r.staleBundled.join(", ")}`);
  assert.deepEqual(r.conflicting, [], `en SHARED_DEPS y BUNDLED_DEPS a la vez: ${r.conflicting.join(", ")}`);
});
```

## Verificación

1. `node --test apps/host/scripts/__tests__/shared-deps.test.mjs` verde local (el gate real pasa sobre el estado actual — las 12 deps clasifican).
2. **Prueba negativa manual (opcional):** agregar una dep dummy al `package.json` → el test de integración falla con "sin clasificar"; removerla → vuelve a verde.
3. Corre en el `tests.yml` del host (PR) → check `test` required → gatea.

## Qué NO cambia

- El algoritmo de `buildMfShared`/`gen-host-contract` — intacto.
- No se toca `package.json` (solo se lee en el test).
- Nada del sistema de compat ni la flota.

## Fuera de alcance

- Reconciliar deps de las **miniapps** (su gate es `check-compat`).
- Auto-sugerir la clasificación (shared vs bundled es decisión humana; el check solo exige que se tome).
- Validar `native ⊆ dependencies` (los natives incluyen devDeps autolinkeados).

## Archivos afectados

- **Modificar:** `apps/host/shared-deps.mjs` (+`BUNDLED_DEPS`, +`reconcileDeps`)
- **Modificar:** `apps/host/scripts/__tests__/shared-deps.test.mjs` (+5 tests)
- **Sin cambios:** el resto.
