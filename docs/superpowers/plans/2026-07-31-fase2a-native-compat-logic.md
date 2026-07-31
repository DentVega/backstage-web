# Fase 2-A — Native-check logic en el contract package — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** La lógica de compatibilidad NATIVA en `@dentvega/miniapp-contract`: `checkNativeModules` (qué módulos nativos de la miniapp NO están en el host) + `checkCompatibility` (compone skew + nativo). Cimiento de Fase 2 que consumen el host generator, el template check y el `/upload` de Backstage.

**Architecture:** Funciones puras en un nuevo `src/compat.ts` del contract package (TS, jest). `checkNativeModules` compara dos listas de nombres. `checkCompatibility(contract, miniappShared, miniappNativeModules)` compone `satisfiesShared(contract.shared, miniappShared)` (ya existe) + `checkNativeModules(contract.nativeModules, miniappNativeModules)`. Todo pure — sin fs/red.

**Tech Stack:** TypeScript, Jest + ts-jest. `HostContract`/`SharedDepSpec`/`SkewResult` ya existen (Fase 1-C, v0.2.0).

## Global Constraints

- **Owner:** DentVega. **Sin dependencias nuevas.**
- **Repo:** `/Volumes/SSDExterno/prodproyects/backstagereactnative`, paquete en `packages/miniapp-contract`. Trabajar desde ahí. Commits **locales** (no push; no publicar).
- Estilo del paquete: imports ESM con `.js`, inglés, tests con `pnpm --filter @dentvega/miniapp-contract test` (jest).
- `checkCompatibility` reusa `satisfiesShared` (no reimplementar). El `contract.shared` es `Record<string,string>`; `satisfiesShared` espera `Record<string,SemVer>` (branded) → castear con un comentario (mismo patrón ya usado en el gate de backstage-web; `SemVer` es brand compile-time, sin efecto runtime).
- Commits con **paths explícitos**; trailer en cada commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```

---

### Task 1: `checkNativeModules` + `NativeCheckResult`

**Files:**
- Create: `packages/miniapp-contract/src/compat.ts`
- Modify: `packages/miniapp-contract/src/index.ts` (exportar)
- Test: `packages/miniapp-contract/src/__tests__/compat.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface NativeCheckResult {
    readonly compatible: boolean;
    readonly missing: readonly string[];   // natives de la miniapp que el host NO tiene
  }
  export function checkNativeModules(
    hostNativeModules: readonly string[],
    miniappNativeModules: readonly string[],
  ): NativeCheckResult;
  ```

- [ ] **Step 1: Test que falla** — `packages/miniapp-contract/src/__tests__/compat.test.ts`

```ts
import { checkNativeModules } from "../compat.js";

describe("checkNativeModules", () => {
  const host = ["react-native-screens", "react-native-safe-area-context"];

  it("compatible cuando todos los natives de la miniapp están en el host", () => {
    const r = checkNativeModules(host, ["react-native-screens"]);
    expect(r.compatible).toBe(true);
    expect(r.missing).toEqual([]);
  });
  it("incompatible listando los que faltan", () => {
    const r = checkNativeModules(host, ["react-native-screens", "react-native-svg", "react-native-mmkv"]);
    expect(r.compatible).toBe(false);
    expect(r.missing).toEqual(["react-native-svg", "react-native-mmkv"]);
  });
  it("miniapp sin natives → compatible", () => {
    expect(checkNativeModules(host, [])).toEqual({ compatible: true, missing: [] });
  });
});
```

- [ ] **Step 2: Correr — falla** (`pnpm --filter @dentvega/miniapp-contract test`).

- [ ] **Step 3: `packages/miniapp-contract/src/compat.ts`**

```ts
/**
 * Compatibility checks that compose shared-version skew with native-module presence.
 * Pure — no fs/network. Consumed by the host generator, the template CI gate, and
 * Backstage's upload gate.
 */
import type { HostContract, SharedDepSpec, SemVer } from "./types.js";
import { satisfiesShared, type SkewResult } from "./shared.js";

export interface NativeCheckResult {
  readonly compatible: boolean;
  /** Native modules the miniapp needs that the host binary does NOT provide. */
  readonly missing: readonly string[];
}

/**
 * A native module can only run if it is compiled into the host binary. This flags
 * every native module the miniapp autolinks that the host's capability set lacks.
 */
export function checkNativeModules(
  hostNativeModules: readonly string[],
  miniappNativeModules: readonly string[],
): NativeCheckResult {
  const host = new Set(hostNativeModules);
  const missing = miniappNativeModules.filter((m) => !host.has(m));
  return { compatible: missing.length === 0, missing };
}
```

- [ ] **Step 4: `index.ts`** — exportar

```ts
export type { NativeCheckResult } from "./compat.js";
export { checkNativeModules } from "./compat.js";
```

- [ ] **Step 5: Correr — pasa** + `pnpm --filter @dentvega/miniapp-contract typecheck` limpio.
- [ ] **Step 6: Commit**

```bash
git add packages/miniapp-contract/src/compat.ts packages/miniapp-contract/src/index.ts packages/miniapp-contract/src/__tests__/compat.test.ts
git commit  # feat(contract): checkNativeModules — native capability check  (+ trailer)
```

---

### Task 2: `checkCompatibility` (compone skew + nativo) + version bump

**Files:**
- Modify: `packages/miniapp-contract/src/compat.ts` (agrega `checkCompatibility` + `CompatReport`)
- Modify: `packages/miniapp-contract/src/index.ts` (exportar)
- Modify: `packages/miniapp-contract/package.json` (version 0.2.0 → 0.3.0)
- Test: `packages/miniapp-contract/src/__tests__/compat.test.ts` (agregar describe)

**Interfaces:**
- Produces:
  ```ts
  export interface CompatReport {
    readonly compatible: boolean;
    readonly skew: SkewResult;
    readonly native: NativeCheckResult;
  }
  export function checkCompatibility(
    contract: HostContract,
    miniappShared: readonly SharedDepSpec[],
    miniappNativeModules: readonly string[],
  ): CompatReport;
  ```

- [ ] **Step 1: Test que falla** — agregar a `compat.test.ts`

```ts
import { checkCompatibility } from "../compat.js";
import type { HostContract } from "../types.js";

const contract: HostContract = {
  contractVersion: "1.0.0",
  reactNative: "0.76.6",
  shared: { react: "18.3.1", "react-native": "0.76.6" },
  nativeModules: ["react-native-screens"],
};

describe("checkCompatibility", () => {
  it("compatible: skew ok + natives presentes", () => {
    const r = checkCompatibility(
      contract,
      [{ name: "react-native", requiredRange: "^0.76.0", singleton: true }],
      ["react-native-screens"],
    );
    expect(r.compatible).toBe(true);
    expect(r.skew.compatible).toBe(true);
    expect(r.native.compatible).toBe(true);
  });
  it("incompatible por skew (RN fuera de rango)", () => {
    const r = checkCompatibility(
      contract,
      [{ name: "react-native", requiredRange: "^0.77.0", singleton: true }],
      [],
    );
    expect(r.compatible).toBe(false);
    expect(r.skew.compatible).toBe(false);
  });
  it("incompatible por native faltante", () => {
    const r = checkCompatibility(contract, [], ["react-native-svg"]);
    expect(r.compatible).toBe(false);
    expect(r.native.missing).toEqual(["react-native-svg"]);
  });
});
```

- [ ] **Step 2: Correr — falla**.

- [ ] **Step 3: Agregar `checkCompatibility` a `compat.ts`**

```ts
export interface CompatReport {
  readonly compatible: boolean;
  readonly skew: SkewResult;
  readonly native: NativeCheckResult;
}

/**
 * Full compatibility of a miniapp against a host contract: shared-version skew
 * (semver) AND native-module presence. Compatible only when both hold.
 */
export function checkCompatibility(
  contract: HostContract,
  miniappShared: readonly SharedDepSpec[],
  miniappNativeModules: readonly string[],
): CompatReport {
  // `contract.shared` is Record<string,string>; satisfiesShared wants the branded
  // SemVer form — the brand is compile-time only, so this cast has no runtime effect.
  const skew = satisfiesShared(
    contract.shared as Readonly<Record<string, SemVer>>,
    miniappShared,
  );
  const native = checkNativeModules(contract.nativeModules, miniappNativeModules);
  return { compatible: skew.compatible && native.compatible, skew, native };
}
```

- [ ] **Step 4: `index.ts`** — exportar `CompatReport` + `checkCompatibility`.

- [ ] **Step 5: `package.json`** — `"version": "0.3.0"`.

- [ ] **Step 6: Correr — pasa** (`pnpm --filter @dentvega/miniapp-contract test`) + `typecheck` + `pnpm --filter @dentvega/miniapp-contract build` (dist compila).

- [ ] **Step 7: Commit**

```bash
git add packages/miniapp-contract/src/compat.ts packages/miniapp-contract/src/index.ts packages/miniapp-contract/package.json packages/miniapp-contract/src/__tests__/compat.test.ts
git commit  # feat(contract): checkCompatibility (skew + native) + bump 0.3.0  (+ trailer)
```

---

## Cierre (post-tasks, controller)

1. Review final whole-branch (base = commit previo a Task 1).
2. `pnpm --filter @dentvega/miniapp-contract test && typecheck && build` — todo verde.
3. **Push** (repo del host).

## Nota de alcance / follow-ups (resto de Fase 2)
- **Host generator**: `gen-host-contract.mjs` puebla `nativeModules` vía `npx react-native config` (autolinking) — hoy emite `[]`.
- **Template check-compat**: enumera los natives de la miniapp (mismo autolinking) + usa `checkNativeModules` → bloquea missing (bajo `COMPAT_ENFORCE`). El manifest gana `nativeModules`.
- **Backstage /upload**: usa `checkCompatibility` completo (skew + nativo) contra el contract guardado.
- **Republish** del contract package (v0.3.0) + bump en los consumidores = operacional. El template check-compat es self-contained (semver) — la parte nativa puede reimplementar `checkNativeModules` inline (es trivial: set-difference) para no acoplar al republish, o consumir el paquete tras publicar.
