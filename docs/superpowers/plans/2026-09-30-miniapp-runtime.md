# `@dentvega/miniapp-runtime` (Fase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar el runtime del host (`@dentvega/host-runtime`) como `@dentvega/miniapp-runtime` en npm público, con `MiniappHost` headless, y que el host `backstagereactnative` lo consuma desde npm inyectando sus componentes de `ui-kit`.

**Architecture:** El código de `backstagereactnative/packages/host-runtime/src` se copia (sin historia) a `repack-miniapps/packages/miniapp-runtime`, se le agregan extensiones `.js` explícitas y empaquetado `tsc → dist` igual que `miniapp-contract`. `MiniappHost` deja de importar `@dentvega/ui-kit`: recibe `render.loading` / `render.error` por props y, sin ellos, usa primitivas RN crudas con copy en inglés. El host mueve su copy en español y sus componentes de `ui-kit` a `apps/host/src/miniappRender.tsx`, borra `packages/host-runtime` y consume el paquete publicado.

**Tech Stack:** TypeScript 5.6, React 18.3.1, React Native 0.76.6, Re.Pack 5 / Rspack, Jest 29 + `@testing-library/react-native` 13, pnpm 10 workspaces, npm público (scope `@dentvega`).

**Spec:** `docs/superpowers/specs/2026-09-22-repack-miniapps-libs-design.md` (sección "Package 3" y fase 4 de "Orden de implementación").

## Global Constraints

- Licencia **MIT**, scope **`@dentvega`**, `publishConfig.access: "public"`.
- `react` y `react-native` son **`peerDependencies`**; `@noble/curves` es **dependencia** (Ed25519).
- `@dentvega/ui-kit` **no se publica** y el runtime **no lo importa**.
- Re.Pack / Module Federation **quedan afuera**: el consumidor inyecta su `ChunkLoader`.
- **Todo import relativo del runtime lleva `.js` explícito** (bug real de la fase 3: sin eso el ESM publicado revienta al importarlo). Se verifica con `pnpm pack` + install real antes de publicar.
- Repo público `repack-miniapps`: commits con el email noreply `12928168+DentVega@users.noreply.github.com` (ya configurado en ese repo). Sin URLs internas, tokens, buckets ni nombres de clientes.
- **Criterio de aceptación de la fase:** la app host sigue montando miniapps en device y su suite queda verde.
- Publicar a npm lo hace **el usuario desde su terminal** (la cuenta `dentvega` tiene 2FA `auth-and-writes`; desde el shell del agente da EOTP).

## Hechos del código actual que el plan asume

- `host-runtime`: 18 archivos en `src/`, 15 archivos de test (75 `it`). Solo `MiniappHost.tsx` y su test importan `@dentvega/ui-kit`.
- `index.ts` **no exporta** `isRetryable`; el plan lo agrega (lo necesita el render del host).
- El host consume `@dentvega/host-runtime` en `src/hostProvided.ts`, `src/chunkLoader.ts`, `src/screens/HomeScreen.tsx`, `src/screens/MiniappScreen.tsx` y `src/dev/DevMountScreen.tsx`, y lo lista en `BUNDLED_DEPS` de `apps/host/shared-deps.mjs` (y en `scripts/__tests__/shared-deps.test.mjs`).
- **Bloqueo:** `backstagereactnative/.npmrc` tiene `@dentvega:registry=https://npm.pkg.github.com`, que manda **todo** el scope a GitHub Packages. Con esa línea, `@dentvega/miniapp-runtime` de npm público no se puede instalar. `ui-kit` y `miniapp-contract` ya declaran `publishConfig.registry` a GitHub Packages, así que quitar la línea del scope **no rompe su publicación**.
- `packages/miniapp-contract` del host (0.4.0) tiene el `src` **idéntico** al publicado `@dentvega/miniapp-contract@0.4.1` (verificado con `diff -rq`).
- El jest del host ignora `node_modules/.pnpm/*` salvo la familia RN y `@noble`. Un paquete ESM de npm (`@dentvega+...`) hay que dejarlo pasar por babel.

## Mapa de archivos

**`repack-miniapps` (rama `feat/miniapp-runtime`)**

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `packages/miniapp-runtime/package.json` | crear | nombre, exports, peer deps, scripts |
| `packages/miniapp-runtime/tsconfig.json` · `tsconfig.build.json` | crear | typecheck y build a `dist` |
| `packages/miniapp-runtime/jest.config.cjs` · `babel.config.cjs` | crear | jest con preset RN + mapeo de `.js` |
| `packages/miniapp-runtime/src/**` | copiar | lógica portable (sin `MiniappHost`) |
| `packages/miniapp-runtime/src/MiniappHost.tsx` | crear | componente headless |
| `packages/miniapp-runtime/src/__tests__/MiniappHost.test.tsx` | crear | tests headless |
| `packages/miniapp-runtime/README.md` | crear | uso público |
| `scripts/check-dist-imports.mjs` | crear | falla si un `dist/*.js` tiene imports relativos sin `.js` o rotos |
| `.github/workflows/ci.yml` | modificar | correr el check después del build |
| `README.md` | modificar | listar el tercer paquete |

**`backstagereactnative` (rama `feat/consume-miniapp-runtime`)**

| Archivo | Acción | Responsabilidad |
|---|---|---|
| `.npmrc` | modificar | quitar el ruteo del scope a GitHub Packages |
| `apps/host/package.json` | modificar | `@dentvega/miniapp-runtime` y `@dentvega/miniapp-contract` desde npm |
| `apps/host/jest.config.js` | modificar | transformar `@dentvega+*` |
| `apps/host/src/miniappRender.tsx` | crear | loading/fallback con `ui-kit` + copy en español |
| `apps/host/src/__tests__/miniappRender.test.tsx` | crear | tests de UX que antes vivían en el runtime |
| `apps/host/src/screens/MiniappScreen.tsx` | modificar | pasar `render={miniappRender}` |
| `apps/host/src/{hostProvided,chunkLoader}.ts`, `screens/HomeScreen.tsx`, `dev/DevMountScreen.tsx` | modificar | import renombrado |
| `apps/host/shared-deps.mjs` · `scripts/__tests__/shared-deps.test.mjs` | modificar | `BUNDLED_DEPS` renombrado |
| `packages/host-runtime/` | borrar | reemplazado por el paquete de npm |
| `README.md`, `README.es.md`, `docs/mounting-miniapps.md`, `apps/host/README.md` | modificar | nombre nuevo + prop `render` |

---

### Task 1: Paquete `miniapp-runtime` con la lógica portable

**Files:**
- Create: `repack-miniapps/packages/miniapp-runtime/{package.json,tsconfig.json,tsconfig.build.json,jest.config.cjs,babel.config.cjs}`
- Create (copia): `repack-miniapps/packages/miniapp-runtime/src/*` y `src/__tests__/*` **excepto** `MiniappHost.tsx` y `__tests__/MiniappHost.test.tsx`

**Interfaces:**
- Produces: paquete de workspace `@dentvega/miniapp-runtime` con todos los exports actuales de `host-runtime/src/index.ts` salvo `MiniappHost` / `MiniappHostProps` (vuelven en Task 2), **más** `isRetryable`.

- [x] **Step 1: Crear la rama y copiar el código**

```bash
cd /Volumes/SSDExterno/prodproyects/repack-miniapps
git switch -c feat/miniapp-runtime
mkdir -p packages/miniapp-runtime
cp -R ../backstagereactnative/packages/host-runtime/src packages/miniapp-runtime/src
rm packages/miniapp-runtime/src/MiniappHost.tsx packages/miniapp-runtime/src/__tests__/MiniappHost.test.tsx
```

- [x] **Step 2: Quitar `MiniappHost` del entry y exportar `isRetryable`**

En `packages/miniapp-runtime/src/index.ts`, borrar estas dos líneas:

```ts
export type { MiniappHostProps } from "./MiniappHost";
export { MiniappHost } from "./MiniappHost";
```

y reemplazar

```ts
export { initialLoaderState, nextLoaderState } from "./loaderState";
```

por

```ts
export { initialLoaderState, nextLoaderState, isRetryable } from "./loaderState";
```

- [x] **Step 3: Agregar `.js` a todos los imports relativos**

Crear `packages/miniapp-runtime/scripts/add-js-ext.mjs` **solo para esta corrida** (no se commitea):

```js
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.tsx?$/.test(p)) {
      const src = readFileSync(p, "utf8");
      const out = src.replace(
        /(from\s+|import\s*\(\s*)(["'])(\.{1,2}\/[^"']+?)(?<!\.js)\2/g,
        (_m, pre, q, spec) => `${pre}${q}${spec}.js${q}`,
      );
      if (out !== src) writeFileSync(p, out);
    }
  }
}
walk(new URL("../src", import.meta.url).pathname);
```

```bash
node packages/miniapp-runtime/scripts/add-js-ext.mjs
rm -r packages/miniapp-runtime/scripts
grep -rnE "from ['\"]\.{1,2}/" packages/miniapp-runtime/src | grep -vE "\.js['\"]"
```

Expected: el último `grep` no imprime nada (ningún import relativo sin `.js`).

- [x] **Step 4: `package.json`**

```json
{
  "name": "@dentvega/miniapp-runtime",
  "version": "0.1.0",
  "description": "Host-side runtime for Re.Pack miniapp platforms: resolve → verify (integrity + Ed25519 signature) → mount → fallback. Headless; bring your own ChunkLoader and UI.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" }
  },
  "files": ["dist"],
  "publishConfig": { "access": "public" },
  "keywords": ["repack", "module-federation", "react-native", "miniapp", "microfrontends"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "jest",
    "prepack": "pnpm build"
  },
  "dependencies": {
    "@dentvega/miniapp-contract": "workspace:^",
    "@noble/curves": "^2.3.0"
  },
  "peerDependencies": {
    "react": ">=18",
    "react-native": ">=0.76"
  },
  "devDependencies": {
    "@react-native/babel-preset": "0.76.6",
    "@testing-library/react-native": "^13.2.0",
    "@types/jest": "^29.5.14",
    "@types/react": "^18.3.12",
    "babel-jest": "^29.7.0",
    "jest": "^29.7.0",
    "react": "18.3.1",
    "react-native": "0.76.6",
    "react-test-renderer": "18.3.1",
    "typescript": "^5.6.3"
  }
}
```

`workspace:^` hace que pnpm publique `"^0.4.1"` (rango), no la versión exacta.

- [x] **Step 5: tsconfigs, jest y babel**

`packages/miniapp-runtime/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "rootDir": "src",
    "outDir": "dist",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM"],
    "types": ["jest", "react"],
    "verbatimModuleSyntax": false
  },
  "include": ["src"]
}
```

`packages/miniapp-runtime/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": { "types": ["react"] },
  "exclude": ["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/__tests__/**"]
}
```

`packages/miniapp-runtime/babel.config.cjs`:

```js
module.exports = {
  presets: ["module:@react-native/babel-preset"],
};
```

`packages/miniapp-runtime/jest.config.cjs`:

```js
/** @type {import('jest').Config} */
module.exports = {
  preset: "react-native",
  testMatch: ["**/*.test.tsx", "**/*.test.ts"],
  // Los imports relativos llevan .js (requisito del ESM publicado); en test apuntan al .ts.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
  transformIgnorePatterns: [
    "node_modules/\\.pnpm/(?!(?:react-native|react-native-|@react-native\\+|@react-native-community\\+|@testing-library\\+|@noble\\+|@dentvega\\+))",
  ],
};
```

- [x] **Step 6: Instalar y correr la suite portada**

```bash
cd /Volumes/SSDExterno/prodproyects/repack-miniapps
pnpm install
pnpm --filter @dentvega/miniapp-contract build
pnpm --filter @dentvega/miniapp-runtime typecheck
pnpm --filter @dentvega/miniapp-runtime test
```

Expected: typecheck limpio; **14 test suites** en verde (las 15 originales menos `MiniappHost`). Si jest falla resolviendo `@dentvega/miniapp-contract`, es porque falta su `dist`: el build del paso anterior lo resuelve.

- [x] **Step 7: Commit**

```bash
git add packages/miniapp-runtime pnpm-lock.yaml
git commit -m "feat(runtime): portar la lógica de host-runtime a @dentvega/miniapp-runtime"
```

---

### Task 2: `MiniappHost` headless

**Files:**
- Create: `packages/miniapp-runtime/src/MiniappHost.tsx`
- Create: `packages/miniapp-runtime/src/__tests__/MiniappHost.test.tsx`
- Modify: `packages/miniapp-runtime/src/index.ts`

**Interfaces:**
- Consumes: `useMiniapp(deps): { state, Entry, reload, retrying }` (`./useMiniapp.js`), `isRetryable`, `FallbackReason` (`./loaderState.js`).
- Produces (exportados desde el entry):
  ```ts
  interface MiniappLoadingProps { retrying: boolean }
  interface MiniappErrorProps { reason: FallbackReason; retryable: boolean; onRetry: () => void }
  interface MiniappHostRender {
    loading?: ComponentType<MiniappLoadingProps>;
    error?: ComponentType<MiniappErrorProps>;
  }
  interface MiniappHostProps { /* los props actuales */ render?: MiniappHostRender }
  const DEFAULT_FALLBACK_MESSAGES: Record<FallbackReason, string>
  function MiniappHost(props: MiniappHostProps): React.JSX.Element
  ```

- [x] **Step 1: Escribir el test que falla**

`packages/miniapp-runtime/src/__tests__/MiniappHost.test.tsx`:

```tsx
import React from 'react';
import {Text} from 'react-native';
import {fireEvent, render, screen} from '@testing-library/react-native';
import type {
  CapabilityGrant,
  Manifest,
  MiniappId,
  ResolveResponse,
  SemVer,
} from '@dentvega/miniapp-contract';
import {MiniappHost, type MiniappHostRender} from '../MiniappHost';
import type {ResolveClient} from '../ResolveClient';
import type {MetricsClient, MetricEvent} from '../MetricsClient';
import type {ChunkLoader, EntryComponent} from '../ChunkLoader';
import type {HostProvided} from '../evaluate';

const ID = 'account_dashboard' as MiniappId;
const hostProvided: HostProvided = {
  react: '18.3.1' as SemVer,
  'react-native': '0.76.6' as SemVer,
};
const grant: CapabilityGrant = {granted: ['accounts:read'], isRevoked: () => false};
const compatibleShared = [
  {name: 'react-native', requiredRange: '^0.76.0', singleton: true},
];

function manifest(shared: Manifest['shared']): Manifest {
  return {
    id: ID,
    version: '0.1.0' as SemVer,
    entry: './Entry',
    shared,
    capabilities: ['accounts:read'],
  };
}
function resolvedWith(m: unknown): ResolveResponse {
  return {id: ID, version: '0.1.0' as SemVer, url: 'http://h/chunk', manifest: m as Manifest};
}
function mockResolve(resp: ResolveResponse | Error): ResolveClient {
  return {
    resolve: async () => {
      if (resp instanceof Error) throw resp;
      return resp;
    },
  };
}
function flakyResolve(failures: number, resp: ResolveResponse): ResolveClient {
  let n = 0;
  return {
    resolve: async () => {
      if (n++ < failures) throw new Error('resolve failed: transient');
      return resp;
    },
  };
}
const FakeEntry: EntryComponent = ({capabilities}) => (
  <Text>mounted: {capabilities.granted.join(',')}</Text>
);
const mockChunk: ChunkLoader = {load: async () => FakeEntry};
const skewed = manifest([{name: 'react-native', requiredRange: '^0.99.0', singleton: true}]);

function renderHost(
  client: ResolveClient,
  opts: {loader?: ChunkLoader; metrics?: MetricsClient; render?: MiniappHostRender} = {},
) {
  render(
    <MiniappHost
      id={ID}
      resolveClient={client}
      chunkLoader={opts.loader ?? mockChunk}
      hostProvided={hostProvided}
      capabilities={grant}
      metrics={opts.metrics}
      retry={{backoffMs: 0}}
      render={opts.render}
    />,
  );
}

describe('MiniappHost (headless, sin render)', () => {
  it('monta el Entry remoto con las capabilities', async () => {
    renderHost(mockResolve(resolvedWith(manifest(compatibleShared))));
    expect(await screen.findByText(/mounted: accounts:read/)).toBeOnTheScreen();
  });

  it('muestra el loading por defecto mientras resuelve', () => {
    renderHost({resolve: () => new Promise(() => {})});
    expect(screen.getByTestId('miniapp-loading')).toBeOnTheScreen();
  });

  it('fallback por defecto: header + mensaje en inglés + Retry', async () => {
    renderHost(mockResolve(new Error('resolve failed: down')));
    expect(await screen.findByText('We could not locate this miniapp.')).toBeOnTheScreen();
    expect(screen.getByRole('header', {name: 'Miniapp unavailable'})).toBeOnTheScreen();
    expect(screen.getByRole('button', {name: 'Retry'})).toBeOnTheScreen();
  });

  it('fallback permanente (skew) sin botón Retry', async () => {
    renderHost(mockResolve(resolvedWith(skewed)));
    expect(await screen.findByText(/not compatible/)).toBeOnTheScreen();
    expect(screen.queryByRole('button', {name: 'Retry'})).toBeNull();
  });

  it('Retry manual recarga y monta', async () => {
    renderHost(flakyResolve(2, resolvedWith(manifest(compatibleShared))));
    fireEvent.press(await screen.findByRole('button', {name: 'Retry'}));
    expect(await screen.findByText(/mounted: accounts:read/)).toBeOnTheScreen();
  });

  it('reporta el fallback a métricas con la razón', async () => {
    const events: MetricEvent[] = [];
    renderHost(mockResolve(resolvedWith(skewed)), {metrics: {track: e => events.push(e)}});
    await screen.findByText(/not compatible/);
    expect(events).toContainEqual({type: 'fallback', id: ID, reason: 'skew'});
  });
});

describe('MiniappHost (render inyectado)', () => {
  it('usa el error del consumidor con reason y retryable', async () => {
    renderHost(mockResolve(new Error('resolve failed: down')), {
      render: {
        error: ({reason, retryable}) => (
          <Text>custom {reason} {String(retryable)}</Text>
        ),
      },
    });
    expect(await screen.findByText('custom resolve-failed true')).toBeOnTheScreen();
    expect(screen.queryByText('Miniapp unavailable')).toBeNull();
  });

  it('el onRetry del error inyectado recarga', async () => {
    renderHost(flakyResolve(2, resolvedWith(manifest(compatibleShared))), {
      render: {error: ({onRetry}) => <Text onPress={onRetry}>again</Text>},
    });
    fireEvent.press(await screen.findByText('again'));
    expect(await screen.findByText(/mounted: accounts:read/)).toBeOnTheScreen();
  });

  it('usa el loading del consumidor', () => {
    renderHost({resolve: () => new Promise(() => {})}, {
      render: {loading: ({retrying}) => <Text>cargando {String(retrying)}</Text>},
    });
    expect(screen.getByText('cargando false')).toBeOnTheScreen();
  });
});
```

- [x] **Step 2: Correrlo y verificar que falla**

Run: `pnpm --filter @dentvega/miniapp-runtime test -- MiniappHost`
Expected: FAIL, `Cannot find module '../MiniappHost'`.

- [x] **Step 3: Implementar `MiniappHost.tsx`**

```tsx
import React, { type ComponentType } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { CapabilityGrant, MiniappId } from "@dentvega/miniapp-contract";
import { useMiniapp } from "./useMiniapp.js";
import type { ResolveClient } from "./ResolveClient.js";
import type { MetricsClient } from "./MetricsClient.js";
import type { ChunkLoader } from "./ChunkLoader.js";
import type { HostProvided } from "./evaluate.js";
import type { IntegrityVerifier } from "./integrity.js";
import type { SignatureVerifier } from "./signature.js";
import type { SignatureMode } from "./signatureGate.js";
import { isRetryable, type FallbackReason } from "./loaderState.js";

export interface MiniappLoadingProps {
  retrying: boolean;
}

export interface MiniappErrorProps {
  reason: FallbackReason;
  retryable: boolean;
  onRetry: () => void;
}

/** Componentes de UI que inyecta el host. Sin ellos se usan primitivas RN sin estilo propio. */
export interface MiniappHostRender {
  loading?: ComponentType<MiniappLoadingProps>;
  error?: ComponentType<MiniappErrorProps>;
}

export interface MiniappHostProps {
  id: MiniappId;
  resolveClient: ResolveClient;
  chunkLoader: ChunkLoader;
  hostProvided: HostProvided;
  capabilities: CapabilityGrant;
  integrity?: IntegrityVerifier;
  /** Verificador de firma del chunk (autenticidad). Opcional → sin verificación. */
  signature?: SignatureVerifier;
  /** warn (monta + métrica) | enforce (bloquea). Default warn. */
  signatureMode?: SignatureMode;
  onRetry?: () => void;
  retry?: { maxAuto?: number; backoffMs?: number };
  /** contractVersion del host — habilita el guard host-too-old (minHostContract). */
  hostContractVersion?: string;
  /** Versión servida (del catálogo) — habilita el cache por-versión del resolve. */
  resolveVersion?: string;
  /** Telemetría de runtime (best-effort). */
  metrics?: MetricsClient;
  /** UI de carga y error. Opcional → primitivas RN por defecto. */
  render?: MiniappHostRender;
}

export const DEFAULT_FALLBACK_MESSAGES: Record<FallbackReason, string> = {
  "resolve-failed": "We could not locate this miniapp.",
  "download-failed": "We could not download this miniapp.",
  "invalid-manifest": "This miniapp has an invalid manifest.",
  skew: "This miniapp is not compatible with this version of the app. Update the app to use it.",
  "integrity-failed": "We could not verify the integrity of this miniapp.",
  "host-too-old": "Update the app to use this miniapp.",
  "invalid-signature": "We could not verify the signature of this miniapp.",
  "unknown-key": "This miniapp is not authorized to run.",
};

function DefaultLoading({ retrying }: MiniappLoadingProps): React.JSX.Element {
  return (
    <View testID="miniapp-loading" style={styles.center}>
      <ActivityIndicator />
      {retrying ? <Text>Retrying…</Text> : null}
    </View>
  );
}

function DefaultError({ reason, retryable, onRetry }: MiniappErrorProps): React.JSX.Element {
  return (
    <View style={styles.center}>
      <Text accessibilityRole="header">Miniapp unavailable</Text>
      <Text>{DEFAULT_FALLBACK_MESSAGES[reason]}</Text>
      {retryable ? (
        <Pressable accessibilityRole="button" onPress={onRetry}>
          <Text>Retry</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function MiniappHost(props: MiniappHostProps): React.JSX.Element {
  const { state, Entry, reload, retrying } = useMiniapp({
    id: props.id,
    resolveClient: props.resolveClient,
    chunkLoader: props.chunkLoader,
    hostProvided: props.hostProvided,
    integrity: props.integrity,
    signature: props.signature,
    signatureMode: props.signatureMode,
    retry: props.retry,
    hostContractVersion: props.hostContractVersion,
    resolveVersion: props.resolveVersion,
    metrics: props.metrics,
  });

  if (state.status === "fallback") {
    const ErrorView = props.render?.error ?? DefaultError;
    return (
      <ErrorView
        reason={state.reason}
        retryable={isRetryable(state.reason)}
        onRetry={props.onRetry ?? reload}
      />
    );
  }

  if (state.status === "mounted" && Entry !== null) {
    const MountedEntry = Entry;
    return <MountedEntry capabilities={props.capabilities} />;
  }

  const LoadingView = props.render?.loading ?? DefaultLoading;
  return <LoadingView retrying={retrying} />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: 8 },
});
```

- [x] **Step 4: Volver a exportarlo desde el entry**

Al final del bloque de exports de `src/index.ts` (antes del helper de capabilities):

```ts
export type {
  MiniappHostProps,
  MiniappHostRender,
  MiniappLoadingProps,
  MiniappErrorProps,
} from "./MiniappHost.js";
export { MiniappHost, DEFAULT_FALLBACK_MESSAGES } from "./MiniappHost.js";
```

- [x] **Step 5: Correr la suite completa**

Run: `pnpm --filter @dentvega/miniapp-runtime typecheck && pnpm --filter @dentvega/miniapp-runtime test`
Expected: typecheck limpio; 15 suites en verde (14 portadas + `MiniappHost` con 9 tests).

- [x] **Step 6: Commit**

```bash
git add packages/miniapp-runtime/src
git commit -m "feat(runtime): MiniappHost headless con render inyectable"
```

---

### Task 3: Empaquetado verificado + docs del paquete

**Files:**
- Create: `scripts/check-dist-imports.mjs`
- Create: `packages/miniapp-runtime/README.md`
- Modify: `.github/workflows/ci.yml`, `README.md`

**Interfaces:**
- Produces: `node scripts/check-dist-imports.mjs <dir...>` → exit 0 si cada import relativo en `<dir>/**/*.js` termina en `.js` y apunta a un archivo existente; exit 1 listando los que no.

- [x] **Step 1: Escribir el check**

`scripts/check-dist-imports.mjs`:

```js
#!/usr/bin/env node
// Falla si un dist/*.js tiene imports relativos sin extensión o que apuntan a archivos
// inexistentes. Es el bug de la fase 3: tsc compila, los tests pasan, y el ESM publicado
// revienta al importarlo.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RELATIVE = /(?:from\s+|import\s*\(\s*|export\s+\*\s+from\s+)["'](\.{1,2}\/[^"']+)["']/g;
const problems = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".js")) check(p);
  }
}

function check(file) {
  const src = readFileSync(file, "utf8");
  for (const [, spec] of src.matchAll(RELATIVE)) {
    if (!spec.endsWith(".js")) problems.push(`${file}: "${spec}" sin extensión .js`);
    else if (!existsSync(resolve(dirname(file), spec))) problems.push(`${file}: "${spec}" no existe`);
  }
}

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error("uso: check-dist-imports.mjs <dist-dir...>");
  process.exit(2);
}
for (const d of dirs) walk(d);
if (problems.length > 0) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`ok: ${dirs.join(", ")}`);
```

- [x] **Step 2: Probar que detecta el bug**

```bash
cd /Volumes/SSDExterno/prodproyects/repack-miniapps
pnpm build
BAD=$(mktemp -d) && printf 'export { a } from "./a";\n' > "$BAD/index.js"
node scripts/check-dist-imports.mjs "$BAD"; echo "exit=$?"
node scripts/check-dist-imports.mjs packages/*/dist; echo "exit=$?"
rm -r "$BAD"
```

Expected: el primero imprime `"./a" sin extensión .js` y `exit=1`; el segundo imprime `ok: ...` y `exit=0`.

- [x] **Step 3: Verificar el contenido del tarball**

```bash
cd packages/miniapp-runtime && pnpm pack && tar -tzf dentvega-miniapp-runtime-0.1.0.tgz | sort | head -60
tar -xzOf dentvega-miniapp-runtime-0.1.0.tgz package/package.json | grep -A3 '"dependencies"'
```

Expected: solo `package/package.json`, `package/README.md`, `package/LICENSE` (si está) y `package/dist/**`, sin `__tests__` ni `src/`. La dependencia sale como `"@dentvega/miniapp-contract": "^0.4.1"` (no `workspace:`). Borrar el `.tgz` después: `rm dentvega-miniapp-runtime-0.1.0.tgz`.

- [x] **Step 4: CI**

En `.github/workflows/ci.yml`, después de `- run: pnpm build`, agregar:

```yaml
      - run: node scripts/check-dist-imports.mjs packages/*/dist
```

- [x] **Step 5: README del paquete**

`packages/miniapp-runtime/README.md`:

````markdown
# @dentvega/miniapp-runtime

Host-side runtime for React Native apps that load miniapps with Re.Pack / Module Federation:
**resolve → verify → mount → fallback**.

- Resolves the served version from your registry (`httpResolveClient`, with a per-version cache).
- Checks shared-dependency skew and `minHostContract` before mounting.
- Verifies chunk integrity (SHA-256) and Ed25519 signatures against a signed trust bundle
  (`warn` or `enforce`).
- Auto-retries transient failures, reports metrics, and falls back without crashing.

It is **headless**: it ships no design system. Bring your own loading and error UI, and your own
`ChunkLoader` (the Re.Pack / Module Federation wiring stays in your app).

## Install

```bash
npm install @dentvega/miniapp-runtime
```

`react` (>=18) and `react-native` (>=0.76) are peer dependencies.

## Usage

```tsx
import {
  MiniappHost,
  httpResolveClient,
  sha256Verifier,
  createScopedGrant,
  type ChunkLoader,
} from "@dentvega/miniapp-runtime";

const resolveClient = httpResolveClient("https://registry.example.com");
const chunkLoader: ChunkLoader = { load: async (resolved) => loadWithRepack(resolved) };

export function MiniappScreen({ id }: { id: string }) {
  const { grant } = createScopedGrant(["accounts:read"]);
  return (
    <MiniappHost
      id={id as never}
      resolveClient={resolveClient}
      chunkLoader={chunkLoader}
      hostProvided={{ react: "18.3.1", "react-native": "0.76.6" } as never}
      capabilities={grant}
      integrity={sha256Verifier()}
      render={{ loading: MyLoading, error: MyError }}
    />
  );
}
```

### Custom UI

```ts
render?: {
  loading?: ComponentType<{ retrying: boolean }>;
  error?: ComponentType<{ reason: FallbackReason; retryable: boolean; onRetry: () => void }>;
}
```

Without `render`, plain React Native primitives are used, with the English messages in
`DEFAULT_FALLBACK_MESSAGES`.

## License

MIT
````

En el `README.md` raíz, en la lista de paquetes, agregar la fila/entrada de `@dentvega/miniapp-runtime` con la misma forma que las otras dos (leer el archivo y seguir su formato).

- [x] **Step 6: Commit**

```bash
git add scripts/check-dist-imports.mjs .github/workflows/ci.yml README.md packages/miniapp-runtime/README.md
git commit -m "chore(runtime): check de imports del dist en CI + README del paquete"
```

---

### Task 4: Publicar (lo ejecuta el usuario)

- [x] **Step 1: Push y PR en `repack-miniapps`**, esperar el CI en verde y mergear a `main`.

```bash
git push -u origin feat/miniapp-runtime
gh pr create --title "feat: @dentvega/miniapp-runtime (MiniappHost headless)" --body "..."
```

- [x] **Step 2: El usuario publica desde su terminal** (2FA):

```bash
cd /Volumes/SSDExterno/prodproyects/repack-miniapps && git switch main && git pull
pnpm --filter @dentvega/miniapp-runtime publish --no-git-checks
```

- [x] **Step 3: Verificar**

Run: `npm view @dentvega/miniapp-runtime version dependencies peerDependencies`
Expected: `0.1.0`, `@dentvega/miniapp-contract: '^0.4.1'`, peers `react >=18` / `react-native >=0.76`.

---

### Task 5: El host consume el paquete publicado

**Files (en `backstagereactnative`, rama `feat/consume-miniapp-runtime`):**
- Modify: `.npmrc`, `apps/host/package.json`, `apps/host/jest.config.js`
- Create: `apps/host/src/miniappRender.tsx`, `apps/host/src/__tests__/miniappRender.test.tsx`
- Modify: `apps/host/src/screens/MiniappScreen.tsx`, `apps/host/src/hostProvided.ts`, `apps/host/src/chunkLoader.ts`, `apps/host/src/screens/HomeScreen.tsx`, `apps/host/src/dev/DevMountScreen.tsx`

**Interfaces:**
- Consumes: `MiniappHost`, `MiniappHostRender`, `MiniappLoadingProps`, `MiniappErrorProps`, `FallbackReason` de `@dentvega/miniapp-runtime@^0.1.0` (Task 2).
- Produces: `miniappRender: MiniappHostRender` en `apps/host/src/miniappRender.tsx`.

- [x] **Step 1: Rama y `.npmrc`**

```bash
cd /Volumes/SSDExterno/prodproyects/backstagereactnative
git switch -c feat/consume-miniapp-runtime
```

En `.npmrc`, reemplazar el bloque inicial:

```
# GitHub Packages registry for the @dentvega scope (ADR-002).
# Replace @org with your real GitHub org/user and provide a token with read:packages
# (and write:packages in CI to publish) via the GITHUB_TOKEN env var.
@dentvega:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

por:

```
# El scope @dentvega se instala desde npm público (@dentvega/miniapp-runtime y
# @dentvega/miniapp-contract). ui-kit y miniapp-contract se siguen PUBLICANDO a
# GitHub Packages: lo fija `publishConfig.registry` en cada package.json.
# El token solo hace falta para publicar (write:packages).
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

- [x] **Step 2: Dependencias y jest**

En `apps/host/package.json`, `dependencies`: reemplazar

```json
    "@dentvega/host-runtime": "workspace:*",
    "@dentvega/miniapp-contract": "workspace:*",
```

por

```json
    "@dentvega/miniapp-contract": "^0.4.1",
    "@dentvega/miniapp-runtime": "^0.1.0",
```

En `apps/host/jest.config.js`, agregar `@dentvega\\+` a la lista del `transformIgnorePatterns`:

```js
    'node_modules/\\.pnpm/(?!(?:react-native|react-native-|@react-native\\+|@react-native-community\\+|@react-navigation\\+|@testing-library\\+|@noble\\+|@dentvega\\+))',
```

```bash
pnpm install
```

Expected: instala `@dentvega/miniapp-runtime@0.1.0` y `@dentvega/miniapp-contract@0.4.1` desde `registry.npmjs.org` **sin `GITHUB_TOKEN`** en el entorno.

- [x] **Step 3: Renombrar los imports**

```bash
grep -rl "@dentvega/host-runtime" apps/host/src | xargs sed -i '' 's#@dentvega/host-runtime#@dentvega/miniapp-runtime#g'
grep -rn "@dentvega/host-runtime" apps/host/src
```

Expected: el último `grep` no imprime nada.

- [x] **Step 4: Escribir el test que falla del render del host**

`apps/host/src/__tests__/miniappRender.test.tsx` (son los tests de UX en español que antes vivían en el runtime):

```tsx
import React from 'react';
import {Text} from 'react-native';
import {fireEvent, render, screen} from '@testing-library/react-native';
import {ThemeProvider} from '@dentvega/ui-kit';
import {
  MiniappHost,
  type ChunkLoader,
  type EntryComponent,
  type HostProvided,
  type ResolveClient,
} from '@dentvega/miniapp-runtime';
import type {
  CapabilityGrant,
  Manifest,
  MiniappId,
  ResolveResponse,
  SemVer,
} from '@dentvega/miniapp-contract';
import {miniappRender} from '../miniappRender';

const ID = 'account_dashboard' as MiniappId;
const hostProvided: HostProvided = {
  react: '18.3.1' as SemVer,
  'react-native': '0.76.6' as SemVer,
};
const grant: CapabilityGrant = {granted: ['accounts:read'], isRevoked: () => false};

function manifest(range: string): Manifest {
  return {
    id: ID,
    version: '0.1.0' as SemVer,
    entry: './Entry',
    shared: [{name: 'react-native', requiredRange: range, singleton: true}],
    capabilities: ['accounts:read'],
  };
}
function resolvedWith(m: Manifest): ResolveResponse {
  return {id: ID, version: '0.1.0' as SemVer, url: 'http://h/chunk', manifest: m};
}
function flakyResolve(failures: number, resp: ResolveResponse): ResolveClient {
  let n = 0;
  return {
    resolve: async () => {
      if (n++ < failures) throw new Error('resolve failed: transient');
      return resp;
    },
  };
}
const FakeEntry: EntryComponent = () => <Text>montada</Text>;
const mockChunk: ChunkLoader = {load: async () => FakeEntry};

function renderHost(client: ResolveClient) {
  render(
    <ThemeProvider scheme="light">
      <MiniappHost
        id={ID}
        resolveClient={client}
        chunkLoader={mockChunk}
        hostProvided={hostProvided}
        capabilities={grant}
        retry={{backoffMs: 0}}
        render={miniappRender}
      />
    </ThemeProvider>,
  );
}

describe('miniappRender (UI del host inyectada en MiniappHost)', () => {
  it('falla retryable → copy en español + Reintentar', async () => {
    renderHost(flakyResolve(99, resolvedWith(manifest('^0.76.0'))));
    expect(await screen.findByText(/No pudimos localizar/)).toBeOnTheScreen();
    expect(screen.getByRole('header', {name: 'Miniapp no disponible'})).toBeOnTheScreen();
    expect(screen.getByText('Reintentar')).toBeOnTheScreen();
  });

  it('skew → copy de incompatibilidad, sin Reintentar', async () => {
    renderHost(flakyResolve(0, resolvedWith(manifest('^0.99.0'))));
    expect(await screen.findByText(/no es compatible/)).toBeOnTheScreen();
    expect(screen.queryByText('Reintentar')).toBeNull();
  });

  it('Reintentar recarga y monta', async () => {
    renderHost(flakyResolve(2, resolvedWith(manifest('^0.76.0'))));
    fireEvent.press(await screen.findByText('Reintentar'));
    expect(await screen.findByText('montada')).toBeOnTheScreen();
  });

  it('loading con el testID del host', () => {
    renderHost({resolve: () => new Promise(() => {})});
    expect(screen.getByTestId('miniapp-loading')).toBeOnTheScreen();
  });
});
```

Run: `pnpm --filter @app/host test -- miniappRender`
Expected: FAIL, `Cannot find module '../miniappRender'`.

- [x] **Step 5: Implementar `apps/host/src/miniappRender.tsx`**

```tsx
import React from 'react';
import {ActivityIndicator, StyleSheet, View} from 'react-native';
import {AppText, Box, Button, useTheme} from '@dentvega/ui-kit';
import type {
  FallbackReason,
  MiniappErrorProps,
  MiniappHostRender,
  MiniappLoadingProps,
} from '@dentvega/miniapp-runtime';

// Copy del host (es-AR). El runtime publicado es headless y trae su propio copy en inglés.
const FALLBACK_COPY: Record<FallbackReason, string> = {
  'resolve-failed': 'No pudimos localizar esta miniapp.',
  'download-failed': 'No pudimos descargar esta miniapp.',
  'invalid-manifest': 'La miniapp tiene un manifiesto inválido.',
  skew: 'Esta miniapp no es compatible con esta versión de la app. Actualizá la app para usarla.',
  'integrity-failed': 'No pudimos verificar la integridad de la miniapp.',
  'host-too-old': 'Actualizá la app para usar esta miniapp.',
  'invalid-signature': 'No pudimos verificar la firma de esta miniapp.',
  'unknown-key': 'Esta miniapp no está autorizada para ejecutarse.',
};

function MiniappLoading({retrying}: MiniappLoadingProps): React.JSX.Element {
  const theme = useTheme();
  return (
    <View
      testID="miniapp-loading"
      style={[styles.center, {backgroundColor: theme.colors.background}]}>
      <ActivityIndicator color={theme.colors.primary} />
      {retrying ? (
        <AppText variant="body" color="textMuted">
          Reintentando…
        </AppText>
      ) : null}
    </View>
  );
}

function MiniappFallback({reason, retryable, onRetry}: MiniappErrorProps): React.JSX.Element {
  return (
    <Box padding="xl" gap="sm" style={styles.center}>
      <AppText variant="title" color="danger" accessibilityRole="header">
        Miniapp no disponible
      </AppText>
      <AppText variant="body" color="textMuted">
        {FALLBACK_COPY[reason]}
      </AppText>
      {retryable ? <Button label="Reintentar" onPress={onRetry} /> : null}
    </Box>
  );
}

export const miniappRender: MiniappHostRender = {
  loading: MiniappLoading,
  error: MiniappFallback,
};

const styles = StyleSheet.create({
  center: {flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8},
});
```

- [x] **Step 6: Inyectarlo en `MiniappScreen.tsx`**

Agregar el import junto a los demás locales:

```tsx
import {miniappRender} from '../miniappRender';
```

y el prop en `<MiniappHost ...>`, después de `signatureMode={SIGNATURE_MODE}`:

```tsx
        render={miniappRender}
```

- [x] **Step 7: Correr el test y la suite del host**

```bash
pnpm --filter @app/host test
pnpm --filter @app/host typecheck
```

Expected: todo en verde, incluido `miniappRender.test.tsx` (4 tests). Si falla con `SyntaxError: Cannot use import statement outside a module` apuntando a `@dentvega+miniapp-runtime`, falta el cambio del `transformIgnorePatterns` del Step 2.

- [x] **Step 8: Commit**

```bash
git add .npmrc apps/host pnpm-lock.yaml
git commit -m "feat(host): consumir @dentvega/miniapp-runtime desde npm e inyectar la UI de ui-kit"
```

---

### Task 6: Borrar `host-runtime` y actualizar clasificación y docs

**Files:**
- Delete: `packages/host-runtime/`
- Modify: `apps/host/shared-deps.mjs:78`, `apps/host/scripts/__tests__/shared-deps.test.mjs:72-75`
- Modify: `README.md`, `README.es.md`, `docs/mounting-miniapps.md`, `apps/host/README.md`

- [x] **Step 1: Borrar el paquete viejo**

```bash
git rm -r packages/host-runtime
pnpm install
```

- [x] **Step 2: Renombrar en la clasificación de deps**

`apps/host/shared-deps.mjs:78`:

```js
export const BUNDLED_DEPS = ["@dentvega/miniapp-runtime", "@dentvega/miniapp-contract"];
```

`apps/host/scripts/__tests__/shared-deps.test.mjs:72-75`: reemplazar las dos apariciones de `"@dentvega/host-runtime"` por `"@dentvega/miniapp-runtime"`.

- [x] **Step 3: Docs**

```bash
sed -i '' 's#@dentvega/host-runtime#@dentvega/miniapp-runtime#g' README.md README.es.md docs/mounting-miniapps.md apps/host/README.md
sed -i '' 's#packages/host-runtime#repack-miniapps/packages/miniapp-runtime (npm)#g' README.md README.es.md docs/mounting-miniapps.md apps/host/README.md
```

Después, leer las secciones donde aparece `MiniappHost` en `docs/mounting-miniapps.md` y agregar un párrafo: el runtime es headless, el host inyecta `render={miniappRender}` desde `apps/host/src/miniappRender.tsx`, y ahí vive el copy en español. **No** tocar `memory-bank/` ni `docs/superpowers/` (son registro histórico).

- [x] **Step 4: Verificación completa (lo mismo que corre el CI `tests.yml`)**

```bash
pnpm build:packages
pnpm -r --if-present typecheck
pnpm -r --if-present test
node --test apps/host/scripts/__tests__/*.test.mjs scripts/*.test.mjs
grep -rn "host-runtime" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=memory-bank --exclude-dir=superpowers --exclude-dir=build --exclude-dir=android --exclude-dir=ios . | grep -v pnpm-lock
```

Expected: todo en verde; el `grep` final no imprime nada.

- [x] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(host): borrar packages/host-runtime (reemplazado por @dentvega/miniapp-runtime)"
```

---

### Task 7: Verificación en device (criterio de aceptación)

- [x] **Step 1: Bundle de release (verifica que Rspack resuelve el `dist` ESM)**

```bash
cd /Volumes/SSDExterno/prodproyects/backstagereactnative
pnpm --filter @app/host bundle:android
```

Expected: el bundle termina sin errores de resolución de `@dentvega/miniapp-runtime`.

- [x] **Step 2: Correr en device (lo hace el usuario)**

> **Resultado (2026-10-07):** emulador Android, Metro con `BACKSTAGE_URL` = prod → catálogo con las 3 miniapps y las 3 montan. El fallback (`miniappRender`) no se probó a mano; lo cubren los 4 tests de `miniappRender.test.tsx`. Mergeado en backstagereactnative#44 + docs en backstage-web#9.

`pnpm --filter @app/host android` y `pnpm --filter @app/host ios` en device o simulador. Checklist:
- El Home lista las 3 miniapps (`hellow_widget`, `cards_wallet`, `account_dashboard`).
- Las 3 montan.
- Con el backend apagado o una miniapp inexistente, aparece el fallback **en español con el estilo de `ui-kit`** y el botón "Reintentar" funciona.

- [x] **Step 3: PR del host**, con el CI (`tests.yml`, `host-compat.yml`) en verde. Mergear cuando el usuario confirme el paso 2.

---

## Fuera de alcance

- Borrar `packages/miniapp-contract` del host: las miniapps externas lo siguen consumiendo desde GitHub Packages (`.npmrc` de cada miniapp). Migrarlas a npm público es otro plan; hasta entonces el drift entre las dos copias del contract sigue siendo un riesgo, igual que hoy.
- Copy traducible (i18n) en el runtime: el consumidor ya lo resuelve con `render`.
- `presignPut()` y el resto de las limitaciones del storage.
