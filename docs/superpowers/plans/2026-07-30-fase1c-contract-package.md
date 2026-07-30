# Fase 1-C — Contract package: HostContract + minHostContract + semver — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Elevar `@dentvega/miniapp-contract` a la lógica compartida de compatibilidad: define canónicamente `HostContract` (hoy vive local en backstage-web), agrega `minHostContract` al `Manifest`, y hace que `satisfiesShared` use **semver real** (`semver.satisfies`) en vez del range-checker mínimo — que daría falsos incompatibles con rangos reales.

**Architecture:** Paquete TS puro (Jest + ts-jest, ESM con imports `./x.js`). Agrega la dep `semver`. `satisfiesShared` pasa a validar rangos con `semver.satisfies`; el `satisfiesRange` mínimo se conserva SOLO para el badge de drift (no-gate). `HostContract` + `isHostContract` se vuelven parte del contract (backstage-web los adopta tras republish; su copia local sigue funcionando mientras tanto).

**Tech Stack:** TypeScript, Jest + ts-jest, `semver` (nueva dep), `@types/semver` (devDep).

## Global Constraints

- **Owner:** DentVega. **Única dep nueva permitida:** `semver` (runtime) + `@types/semver` (dev), justificada en el spec §2.4. Ninguna otra.
- **`minHostContract` es OPCIONAL** en `Manifest` — los manifests existentes (sin él) deben seguir pasando `isManifest`.
- **No romper consumidores:** `satisfiesShared` mantiene su firma `(hostProvided: Record<string,SemVer>, miniappShared: SharedDepSpec[]) => SkewResult` y su semántica (compatible ⇔ todos los required satisfechos). Solo cambia el motor de rangos.
- `satisfiesRange` (mínimo) **NO se borra** — sigue exportado para el badge.
- Espejar el estilo del paquete: imports con extensión `.js`, type guards como `isManifest`/`isSharedDepSpec`, comentarios pueden ser inglés (el paquete está en inglés).
- Commits con **paths explícitos**; trailer en cada commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```
- Repo: `/Volumes/SSDExterno/prodproyects/backstagereactnative` (paquete en `packages/miniapp-contract`). Trabajar desde ahí. Commits **locales**; NO publicar el paquete (el republish es un paso operacional posterior).
- Correr los tests con el runner del paquete: `pnpm --filter @dentvega/miniapp-contract test` (o `pnpm test` dentro de `packages/miniapp-contract`). Typecheck: `pnpm typecheck` ahí mismo.

---

### Task 1: `HostContract` type + `isHostContract` + `minHostContract` en `Manifest`

**Files:**
- Modify: `packages/miniapp-contract/src/types.ts` (agrega `HostContract` + `minHostContract` a `Manifest`)
- Modify: `packages/miniapp-contract/src/guards.ts` (agrega `isHostContract` + valida `minHostContract` en `isManifest`)
- Modify: `packages/miniapp-contract/src/index.ts` (exporta `HostContract`, `isHostContract`)
- Test: `packages/miniapp-contract/src/__tests__/host-contract.test.ts` (nuevo)

**Interfaces:**
- Produces:
  ```ts
  export interface HostContract {
    contractVersion: string;
    reactNative: string;
    shared: Readonly<Record<string, string>>;
    nativeModules: readonly string[];
  }
  export function isHostContract(v: unknown): v is HostContract;
  // Manifest gana:  readonly minHostContract?: { reactNative: string; contractVersion: string };
  ```

- [ ] **Step 1: Test que falla** — `packages/miniapp-contract/src/__tests__/host-contract.test.ts`

```ts
import { isHostContract } from "../guards.js";
import type { HostContract } from "../types.js";

const VALID: HostContract = {
  contractVersion: "1.0.0",
  reactNative: "0.76.6",
  shared: { react: "18.3.1", "react-native": "0.76.6" },
  nativeModules: ["react-native-screens"],
};

describe("isHostContract", () => {
  it("accepts a valid contract", () => expect(isHostContract(VALID)).toBe(true));
  it("rejects bad shapes", () => {
    expect(isHostContract(null)).toBe(false);
    expect(isHostContract({ ...VALID, shared: "x" })).toBe(false);
    expect(isHostContract({ ...VALID, shared: { react: 123 } })).toBe(false);
    expect(isHostContract({ ...VALID, nativeModules: "x" })).toBe(false);
    expect(isHostContract({ ...VALID, nativeModules: [1] })).toBe(false);
    expect(isHostContract({ contractVersion: "1.0.0" })).toBe(false);
  });
});
```

Y en el test de guards existente (`src/__tests__/guards.test.ts`), agregar que `isManifest` acepta un manifest CON y SIN `minHostContract`, y rechaza uno con `minHostContract` mal tipado:
```ts
it("accepts a manifest with a valid minHostContract", () => {
  expect(isManifest({ ...VALID_MANIFEST, minHostContract: { reactNative: "0.76.6", contractVersion: "1.0.0" } })).toBe(true);
});
it("accepts a manifest without minHostContract (optional)", () => {
  expect(isManifest(VALID_MANIFEST)).toBe(true);
});
it("rejects a manifest with a malformed minHostContract", () => {
  expect(isManifest({ ...VALID_MANIFEST, minHostContract: { reactNative: 1 } })).toBe(false);
});
```
(Reusar el fixture de manifest válido que ya exista en ese archivo — si se llama distinto, adaptá el nombre.)

- [ ] **Step 2: Correr — falla** (`pnpm --filter @dentvega/miniapp-contract test`) → `isHostContract` no existe.

- [ ] **Step 3: `types.ts`** — agregar `HostContract` y el campo opcional en `Manifest`

Agregar al final de `types.ts`:
```ts
/** El Host Platform Contract: lo que el host provee (fuente de verdad de compat). */
export interface HostContract {
  /** SemVer que bumpea cuando cambia la plataforma. */
  contractVersion: string;
  /** Versión de react-native del host. */
  reactNative: string;
  /** Singletons que provee el host: name → versión concreta. */
  shared: Readonly<Record<string, string>>;
  /** Módulos nativos sin API JS compilados en el binario (presencia only). */
  nativeModules: readonly string[];
}
```
Y en la interface `Manifest`, agregar (opcional, sin romper los existentes):
```ts
  /** Contract mínimo del host contra el que se construyó (compat con hosts viejos). */
  readonly minHostContract?: { readonly reactNative: string; readonly contractVersion: string };
```

- [ ] **Step 4: `guards.ts`** — `isHostContract` + validar `minHostContract` en `isManifest`

Agregar la función:
```ts
export function isHostContract(v: unknown): v is HostContract {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  if (
    typeof c.contractVersion !== "string" ||
    typeof c.reactNative !== "string" ||
    typeof c.shared !== "object" || c.shared === null || Array.isArray(c.shared) ||
    !Array.isArray(c.nativeModules) ||
    !c.nativeModules.every((n) => typeof n === "string")
  ) {
    return false;
  }
  return Object.values(c.shared as Record<string, unknown>).every((x) => typeof x === "string");
}
```
Importar `HostContract` en el `import type { ... } from "./types.js"` de guards.ts.
En `isManifest`, antes del `return true` final, validar el campo opcional:
```ts
  if (o.minHostContract !== undefined) {
    const mh = o.minHostContract as Record<string, unknown>;
    if (typeof mh !== "object" || mh === null ||
        typeof mh.reactNative !== "string" || typeof mh.contractVersion !== "string") {
      return false;
    }
  }
```
(Ubicarlo donde encaje con el flujo existente de `isManifest` — después de validar los campos obligatorios, antes del return positivo.)

- [ ] **Step 5: `index.ts`** — exportar lo nuevo

```ts
export type { /* ...existentes..., */ HostContract } from "./types.js";
export { /* ...existentes..., */ isHostContract } from "./guards.js";
```
(Agregar `HostContract` a la línea de `export type` de types, e `isHostContract` a la de guards.)

- [ ] **Step 6: Correr — pasa** (`pnpm --filter @dentvega/miniapp-contract test`).
- [ ] **Step 7: Typecheck** (`pnpm --filter @dentvega/miniapp-contract typecheck`) limpio.
- [ ] **Step 8: Commit**

```bash
git add packages/miniapp-contract/src/types.ts packages/miniapp-contract/src/guards.ts packages/miniapp-contract/src/index.ts packages/miniapp-contract/src/__tests__/host-contract.test.ts packages/miniapp-contract/src/__tests__/guards.test.ts
git commit  # feat(contract): HostContract type + isHostContract + minHostContract on Manifest  (+ trailer)
```

---

### Task 2: `satisfiesShared` usa semver real

**Files:**
- Modify: `packages/miniapp-contract/package.json` (dep `semver` + devDep `@types/semver`)
- Modify: `packages/miniapp-contract/src/shared.ts` (motor de rangos = semver en `satisfiesShared`)
- Test: `packages/miniapp-contract/src/__tests__/shared.test.ts` (agregar casos de rangos reales)

**Interfaces:**
- `satisfiesShared` y `SkewResult` NO cambian de firma. `satisfiesRange` (mínimo) se conserva exportado.

- [ ] **Step 1: Agregar la dep** en `packages/miniapp-contract/package.json`:
```jsonc
"dependencies": { "semver": "^7.6.0" },
"devDependencies": { /* ...existentes..., */ "@types/semver": "^7.5.0" }
```
Correr `pnpm install` (desde la raíz del repo o el paquete).

- [ ] **Step 2: Test que falla** — agregar a `shared.test.ts` casos que el range-checker mínimo NO resolvía bien pero semver sí:

```ts
describe("satisfiesShared — semver real", () => {
  const shared = (range: string) => [{ name: "react-native", requiredRange: range, singleton: true }];

  it("resuelve rangos con operadores compuestos (>=x <y)", () => {
    const r = satisfiesShared({ "react-native": "0.76.6" } as never, shared(">=0.76.0 <0.77.0") as never);
    expect(r.compatible).toBe(true);
  });
  it("resuelve OR (||)", () => {
    const r = satisfiesShared({ "react-native": "0.76.6" } as never, shared("0.75.x || 0.76.x") as never);
    expect(r.compatible).toBe(true);
  });
  it("resuelve x-ranges (0.76.x)", () => {
    const ok = satisfiesShared({ "react-native": "0.76.6" } as never, shared("0.76.x") as never);
    const no = satisfiesShared({ "react-native": "0.77.0" } as never, shared("0.76.x") as never);
    expect(ok.compatible).toBe(true);
    expect(no.compatible).toBe(false);
  });
  it("mantiene el caso caret 0.x (^0.76.6 excluye 0.77)", () => {
    expect(satisfiesShared({ "react-native": "0.77.0" } as never, shared("^0.76.6") as never).compatible).toBe(false);
    expect(satisfiesShared({ "react-native": "0.76.9" } as never, shared("^0.76.6") as never).compatible).toBe(true);
  });
});
```

- [ ] **Step 3: Correr — falla** (los rangos compuestos/OR daban `incompatible` con el mínimo).

- [ ] **Step 4: `shared.ts`** — que `satisfiesShared` use semver

Importar arriba:
```ts
import semver from "semver";
```
En `satisfiesShared`, reemplazar la llamada a `satisfiesRange(providedVersion, dep.requiredRange)` por:
```ts
const inRange = semver.satisfies(providedVersion, dep.requiredRange, { includePrerelease: false });
const status: SkewStatus = inRange ? "ok" : "incompatible";
```
**No tocar** `satisfiesRange` (queda para el badge). Si `providedVersion`/`requiredRange` son inválidos para semver, `semver.satisfies` devuelve `false` → `incompatible` (fail-safe, correcto para un gate).

- [ ] **Step 5: Correr — pasa** (`pnpm --filter @dentvega/miniapp-contract test`) — nuevos casos verdes + los existentes de `shared.test.ts` sin regresión.
- [ ] **Step 6: Typecheck** limpio (con `@types/semver`).
- [ ] **Step 7: Build** (`pnpm --filter @dentvega/miniapp-contract build`) — `tsc -p tsconfig.build.json` sin errores (confirma que el `dist/` compila con la nueva dep).
- [ ] **Step 8: Commit**

```bash
git add packages/miniapp-contract/package.json packages/miniapp-contract/src/shared.ts packages/miniapp-contract/src/__tests__/shared.test.ts
# (incluir el lockfile si pnpm-lock.yaml cambió por semver — es esperado)
git add ../../pnpm-lock.yaml 2>/dev/null || true
git commit  # feat(contract): satisfiesShared uses real semver (satisfiesRange kept for badge)  (+ trailer)
```

---

## Cierre (post-tasks, controller)

1. Review final whole-branch (base = commit previo a Task 1) en el modelo más capaz.
2. En `packages/miniapp-contract`: `pnpm test && pnpm typecheck && pnpm build` — todo verde.
3. **Bump de versión del paquete** (0.1.0 → 0.2.0, minor) — lo hace el controller o un paso final; NO publicar acá.
4. **Push** de la rama del host repo (si aplica) — coordinar con el owner.

## Nota de alcance / follow-ups
- **`checkNativeModules` + `checkCompatibility`** son **Fase 2** (no van acá).
- **Republish del paquete** a GitHub Packages + bump de la dep en backstage-web / host / template = paso operacional posterior (necesita el workflow de publish del paquete). Hasta entonces, backstage-web sigue usando su copia local de `HostContract` y el `satisfiesShared` viejo; este plan deja el CÓDIGO listo.
- Tras el republish, backstage-web puede **borrar su `lib/host-contract/types.ts` local** e importar `HostContract`/`isHostContract` del paquete (dedup).
