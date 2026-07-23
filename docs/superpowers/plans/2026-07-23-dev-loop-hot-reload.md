# Dev-loop con hot reload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two `__DEV__`-gated dev-loop modes so a dev iterates fast on a miniapp inside the host: Mode 1 (dev-mount, real Fast Refresh of a local miniapp's `Entry`) and Mode 2 (host consumes the miniapp's live `:9000` dev server), Mode 2 gated by a feasibility spike.

**Architecture:** Mode 1 adds an rspack `@dev-miniapp` alias (→ a local miniapp's `src/Entry`, else a `NoMiniapp` placeholder) + a dev-gated `DevMountScreen`. Mode 2 wraps the resolve client so, under `__DEV__`, listed ids resolve to their `:9000` dev-server URL with a synthetic manifest and `noopVerifier`. Everything is additive and gated so release builds are unaffected.

**Tech Stack:** React Native + Re.Pack (rspack) + Module Federation v2, `@dentvega/host-runtime`, jest (host-runtime), React Navigation.

## Global Constraints

- Host repo: `/Volumes/SSDExterno/prodproyects/backstagereactnative` (`apps/host` + `packages/host-runtime`). Owner DentVega. Docs in `/Volumes/SSDExterno/prodproyects/backstage-web/docs/LOCAL-DEV.md`.
- **Additive + `__DEV__`-gated:** nothing may change the release path. The alias falls back to `NoMiniapp` when `DEV_MINIAPP_PATH` is unset; `devResolveClient`/`noopVerifier`/the DevMount nav entry are used only under `__DEV__`.
- `noopVerifier` ALREADY EXISTS in `packages/host-runtime/src/integrity.ts` (exported from `index.ts`) — Mode 2 imports it, does not build it.
- Types: `ResolveResponse = { id: MiniappId; version: SemVer; url: string; manifest: Manifest }`; `Manifest = { id; version; entry; shared: SharedDepSpec[]; capabilities: Capability[]; integrity? }`; `MiniappEntryProps = { capabilities: CapabilityGrant }`; `createScopedGrant(caps): { grant }`.
- Mode 2 tasks (4–5) run ONLY if the Task 3 spike returns **go**.
- Commit trailer for every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```

---

## Task 1: Mode 1 rspack wiring — alias, DefinePlugin, NoMiniapp, globals

**Files (in `/Volumes/SSDExterno/prodproyects/backstagereactnative/apps/host`):**
- Modify: `rspack.config.mjs`
- Create: `src/dev/NoMiniapp.tsx`
- Modify: `src/globals.d.ts`

**Interfaces:**
- Produces: rspack alias `@dev-miniapp` (→ `${DEV_MINIAPP_PATH}/src/Entry` or `src/dev/NoMiniapp`), and DefinePlugin globals `__DEV_MINIAPP_CAPS__: string[]`, `__DEV_REMOTES__: string`.

- [ ] **Step 1: Create the placeholder**

Create `src/dev/NoMiniapp.tsx`:

```tsx
import React from 'react';
import type {MiniappEntryProps} from '@dentvega/miniapp-contract';
import {AppText, Box} from '@dentvega/ui-kit';

/**
 * Default `@dev-miniapp` target when DEV_MINIAPP_PATH is unset (incl. release
 * builds). Renders instructions instead of a real miniapp. Never imports
 * external code, so it is safe in prod.
 */
export default function NoMiniapp(_: MiniappEntryProps): React.JSX.Element {
  return (
    <Box padding="xl" gap="sm">
      <AppText variant="title" accessibilityRole="header">
        Dev Mount
      </AppText>
      <AppText variant="body" color="textMuted">
        Seteá DEV_MINIAPP_PATH=../miniapp-&lt;id&gt; y reiniciá el dev server
        (pnpm start) para montar el Entry de tu miniapp con Fast Refresh.
      </AppText>
    </Box>
  );
}
```

- [ ] **Step 2: Add the alias + DefinePlugin to `rspack.config.mjs`**

At the top of `rspack.config.mjs`, after the existing `createRequire` line, add a helper that reads the dev miniapp's capabilities at config time:

```js
// Dev-mount (Mode 1): resolve @dev-miniapp to a local miniapp's Entry when
// DEV_MINIAPP_PATH is set, else a harmless placeholder. Read its declared
// capabilities so the dev grant satisfies the Entry gate.
const devMiniappPath = process.env.DEV_MINIAPP_PATH;
const devMiniappEntry = devMiniappPath
  ? path.resolve(devMiniappPath, 'src/Entry')
  : path.resolve(__dirname, 'src/dev/NoMiniapp');
let devMiniappCaps = [];
if (devMiniappPath) {
  try {
    devMiniappCaps =
      require(path.resolve(devMiniappPath, 'manifest.json')).capabilities ?? [];
  } catch {
    devMiniappCaps = [];
  }
}
```

In the `resolve` block, add the alias alongside the spread:

```js
  resolve: {
    ...Repack.getResolveOptions(),
    alias: {
      '@dev-miniapp': devMiniappEntry,
    },
  },
```

In the `DefinePlugin`, add the two dev globals next to `__BACKSTAGE_URL__`:

```js
    new rspack.DefinePlugin({
      __BACKSTAGE_URL__: JSON.stringify(
        process.env.BACKSTAGE_URL ?? 'http://localhost:3999',
      ),
      __DEV_MINIAPP_CAPS__: JSON.stringify(devMiniappCaps),
      __DEV_REMOTES__: JSON.stringify(process.env.DEV_REMOTES ?? ''),
    }),
```

- [ ] **Step 3: Declare the globals**

Replace `src/globals.d.ts` with:

```ts
/** Injected by rspack DefinePlugin (host rspack.config.mjs). */
declare const __BACKSTAGE_URL__: string | undefined;
/** Dev-mount (Mode 1): capabilities of the local miniapp at DEV_MINIAPP_PATH. */
declare const __DEV_MINIAPP_CAPS__: string[];
/** Dev remotes (Mode 2): raw "id=url,id2=url2" from DEV_REMOTES env. */
declare const __DEV_REMOTES__: string;
```

- [ ] **Step 4: Typecheck**

Run: `cd /Volumes/SSDExterno/prodproyects/backstagereactnative && pnpm --filter @app/host typecheck`
Expected: no type errors. (`NoMiniapp` satisfies `MiniappEntryProps`; globals declared.)

- [ ] **Step 5: Commit**

```bash
cd /Volumes/SSDExterno/prodproyects/backstagereactnative
git add apps/host/rspack.config.mjs apps/host/src/dev/NoMiniapp.tsx apps/host/src/globals.d.ts
git commit -m "feat(host/dev): @dev-miniapp alias + dev globals + NoMiniapp placeholder"
```

---

## Task 2: Mode 1 — DevMountScreen + dev-gated navigation

**Files (in `apps/host`):**
- Create: `src/dev/DevMountScreen.tsx`
- Modify: `src/navigation.ts`
- Modify: `App.tsx`

**Interfaces:**
- Consumes: `@dev-miniapp` alias + `__DEV_MINIAPP_CAPS__` (Task 1).

- [ ] **Step 1: Create `DevMountScreen.tsx`**

Create `src/dev/DevMountScreen.tsx`:

```tsx
import React, {useMemo} from 'react';
import {SafeAreaView} from 'react-native';
import {useTheme} from '@dentvega/ui-kit';
import {createScopedGrant} from '@dentvega/host-runtime';
import type {Capability} from '@dentvega/miniapp-contract';
// Alias → the local miniapp's ./Entry (or NoMiniapp placeholder). Fast Refresh
// applies because the aliased file is part of the host's module graph.
import Entry from '@dev-miniapp';

/**
 * Dev-only: renders a LOCAL miniapp's Entry directly (no federation) with a
 * mock capability grant built from its manifest, so you get real Fast Refresh
 * while building the UI. Gated behind __DEV__ at the nav level.
 */
export function DevMountScreen(): React.JSX.Element {
  const theme = useTheme();
  const grant = useMemo(
    () => createScopedGrant(__DEV_MINIAPP_CAPS__ as Capability[]).grant,
    [],
  );
  return (
    <SafeAreaView style={{flex: 1, backgroundColor: theme.colors.background}}>
      <Entry capabilities={grant} />
    </SafeAreaView>
  );
}
```

- [ ] **Step 2: Add the route type (dev)**

In `src/navigation.ts`, add `DevMount` to the param list:

```ts
import type {MiniappId} from '@dentvega/miniapp-contract';

export type RootStackParamList = {
  Home: undefined;
  Miniapp: {id: MiniappId; title: string};
  DevMount: undefined;
};
```

- [ ] **Step 3: Register the dev-gated screen in `App.tsx`**

In `App.tsx`, add the import (near the other screen imports):

```tsx
import {DevMountScreen} from './src/dev/DevMountScreen';
```

Inside `<Stack.Navigator>`, after the `Miniapp` screen, add:

```tsx
            {__DEV__ ? (
              <Stack.Screen
                name="DevMount"
                component={DevMountScreen}
                options={{title: 'Dev Mount'}}
              />
            ) : null}
```

- [ ] **Step 4: Add a dev entry point from Home**

In `src/screens/HomeScreen.tsx`, add a dev-only button that navigates to `DevMount`. Locate the component's returned JSX (it uses a `navigation` prop or `useNavigation`); add, guarded by `__DEV__`, a button. If the screen has a `navigation` prop typed to the stack:

```tsx
{__DEV__ ? (
  <Button title="▶ Dev Mount (local miniapp)" onPress={() => navigation.navigate('DevMount')} />
) : null}
```

(Use the existing button/press pattern already in `HomeScreen.tsx`; import `Button` from `react-native` if not already imported. If `HomeScreen` uses a themed button from ui-kit, use that instead to match.)

- [ ] **Step 5: Typecheck**

Run: `cd /Volumes/SSDExterno/prodproyects/backstagereactnative && pnpm --filter @app/host typecheck`
Expected: no type errors.

- [ ] **Step 6: Commit**

```bash
cd /Volumes/SSDExterno/prodproyects/backstagereactnative
git add apps/host/src/dev/DevMountScreen.tsx apps/host/src/navigation.ts apps/host/App.tsx apps/host/src/screens/HomeScreen.tsx
git commit -m "feat(host/dev): DevMount screen + dev-gated nav entry (Mode 1)"
```

- [ ] **Step 7: Manual verification note (controller/user)**

Not automatable. To verify Fast Refresh: `DEV_MINIAPP_PATH=../miniapp-account-dashboard pnpm --filter @app/host start`, run the app, open "Dev Mount", edit the miniapp's `src/Screen.tsx` → the change should hot-reload. Record the result; do not block the commit on it.

---

## Task 3: SPIKE — Mode 2 feasibility (go/no-go)

**Files:** none committed — a throwaway experiment. This gates Tasks 4–5.

- [ ] **Step 1: Serve a miniapp's dev container**

```bash
cd /Volumes/SSDExterno/prodproyects/miniapp-account-dashboard
pnpm start &   # react-native webpack-start --port 9000 (or its configured port)
sleep 20
```

- [ ] **Step 2: Probe the container URL**

```bash
curl -s -o /dev/null -w "%{http_code}\n" \
  "http://localhost:9000/account_dashboard.container.js.bundle?platform=android"
```
Expected (go): `200`. If 404, try variants the dev server actually serves (`/index.bundle?...`, the MF `mf-manifest.json`, or the name from the miniapp's `rspack.config`) and record the URL that returns 200. If nothing serves the federated container, record **NO-GO**.

- [ ] **Step 3: Confirm the host can mount it (end-to-end)**

Temporarily point the host at the dev container by hand: in `apps/host/src/screens/MiniappScreen.tsx`, TEMPORARILY replace `resolveClient` with an inline stub that returns `{ id, version: '0.0.0' as SemVer, url: '<the 200 URL from Step 2>', manifest: { id, version: '0.0.0', entry: './Entry', shared: [], capabilities: [] } }` and `integrity={noopVerifier}`. Run the host (`pnpm --filter @app/host start` + `pnpm --filter @app/host android`, with `adb reverse tcp:9000 tcp:9000`), open the miniapp, and see whether it mounts.

- [ ] **Step 4: Record go/no-go + the confirmed shapes**

Write to the report: the exact URL that served the container, whether the host mounted it, and the exact minimal `manifest` that passed `MiniappHost`'s validation (adjust `shared`/`capabilities` if the empty ones were rejected). **Revert the temporary edit** (`git checkout apps/host/src/screens/MiniappScreen.tsx`). Status: **GO** (Tasks 4–5 proceed with these confirmed shapes) or **NO-GO** (stop; controller replans Mode 2).

---

## Task 4: Mode 2 — `parseDevRemotes` + `devResolveClient` (host-runtime, TDD)

> Run ONLY if Task 3 = GO. Use the URL pattern + minimal manifest confirmed by the spike.

**Files (in `packages/host-runtime`):**
- Create: `src/devResolveClient.ts`
- Test: `src/__tests__/devResolveClient.test.ts`
- Modify: `src/index.ts` (export)

**Interfaces:**
- Produces: `parseDevRemotes(raw: string): Record<string,string>`; `devResolveClient(base: string, devRemotes: Record<string,string>): ResolveClient`; `isDevRemote(id: string, devRemotes): boolean`.

- [ ] **Step 1: Write the failing test**

Create `src/__tests__/devResolveClient.test.ts`:

```ts
import {parseDevRemotes, devResolveClient} from '../devResolveClient';
import type {ResolveClient} from '../ResolveClient';

describe('parseDevRemotes', () => {
  it('parses id=url pairs', () => {
    expect(parseDevRemotes('a=http://localhost:9000,b=http://localhost:9100')).toEqual({
      a: 'http://localhost:9000',
      b: 'http://localhost:9100',
    });
  });
  it('returns {} for empty/whitespace', () => {
    expect(parseDevRemotes('')).toEqual({});
    expect(parseDevRemotes('   ')).toEqual({});
  });
  it('ignores malformed entries (no =)', () => {
    expect(parseDevRemotes('a=http://x,garbage,b=http://y')).toEqual({
      a: 'http://x',
      b: 'http://y',
    });
  });
});

describe('devResolveClient', () => {
  const base = 'http://localhost:3999';
  it('resolves a dev-remote id to its :9000 container url, no integrity', async () => {
    const client = devResolveClient(base, {cards_wallet: 'http://localhost:9000'});
    const res = await client.resolve({id: 'cards_wallet' as never});
    expect(res.url).toBe('http://localhost:9000/cards_wallet.container.js.bundle?platform=android');
    expect(res.manifest.integrity).toBeUndefined();
    expect(res.id).toBe('cards_wallet');
  });
  it('delegates non-dev ids to the wrapped HTTP client', async () => {
    const delegate: ResolveClient = {resolve: jest.fn(async () => ({looked: 'up'} as never))};
    const client = devResolveClient(base, {cards_wallet: 'http://localhost:9000'}, delegate);
    const out = await client.resolve({id: 'account_dashboard' as never});
    expect(delegate.resolve).toHaveBeenCalledWith({id: 'account_dashboard'});
    expect(out).toEqual({looked: 'up'});
  });
});
```

- [ ] **Step 2: Run it — fails**

Run: `cd /Volumes/SSDExterno/prodproyects/backstagereactnative && pnpm --filter @dentvega/host-runtime test devResolveClient`
Expected: FAIL — cannot find `../devResolveClient`.

- [ ] **Step 3: Implement `devResolveClient.ts`**

Create `src/devResolveClient.ts` (use the manifest shape confirmed by the Task 3 spike; the empty `shared`/`capabilities` below are the starting point — adjust to the spike's finding if it required specific entries):

```ts
import type {ResolveResponse} from '@dentvega/miniapp-contract';
import {httpResolveClient, type ResolveClient} from './ResolveClient';

/** Parse DEV_REMOTES ("id=url,id2=url2") into a map. Malformed entries skipped. */
export function parseDevRemotes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of raw.split(',')) {
    const i = pair.indexOf('=');
    if (i <= 0) continue;
    const id = pair.slice(0, i).trim();
    const url = pair.slice(i + 1).trim();
    if (id && url) out[id] = url;
  }
  return out;
}

export function isDevRemote(id: string, devRemotes: Record<string, string>): boolean {
  return Object.prototype.hasOwnProperty.call(devRemotes, id);
}

/**
 * Dev-only ResolveClient: for ids in `devRemotes`, resolve to the miniapp's live
 * dev-server container (no integrity — pair with noopVerifier). Others delegate
 * to the real HTTP client. NEVER used outside __DEV__.
 */
export function devResolveClient(
  base: string,
  devRemotes: Record<string, string>,
  delegate: ResolveClient = httpResolveClient(base),
): ResolveClient {
  return {
    async resolve(request): Promise<ResolveResponse> {
      const devUrl = devRemotes[request.id];
      if (devUrl === undefined) return delegate.resolve(request);
      const id = request.id;
      return {
        id,
        version: '0.0.0' as ResolveResponse['version'],
        url: `${devUrl.replace(/\/+$/, '')}/${id}.container.js.bundle?platform=android`,
        manifest: {
          id,
          version: '0.0.0' as ResolveResponse['version'],
          entry: './Entry',
          shared: [],
          capabilities: [],
        } as ResolveResponse['manifest'],
      };
    },
  };
}
```

- [ ] **Step 4: Export from `index.ts`**

In `src/index.ts`, after the `httpResolveClient` export, add:

```ts
export { parseDevRemotes, devResolveClient, isDevRemote } from "./devResolveClient";
```

- [ ] **Step 5: Run tests — pass**

Run: `cd /Volumes/SSDExterno/prodproyects/backstagereactnative && pnpm --filter @dentvega/host-runtime test devResolveClient`
Expected: PASS (all cases).

- [ ] **Step 6: Commit**

```bash
cd /Volumes/SSDExterno/prodproyects/backstagereactnative
git add packages/host-runtime/src/devResolveClient.ts packages/host-runtime/src/__tests__/devResolveClient.test.ts packages/host-runtime/src/index.ts
git commit -m "feat(host-runtime): devResolveClient + parseDevRemotes (Mode 2, dev-only)"
```

---

## Task 5: Mode 2 — wire `MiniappScreen` to dev remotes

> Run ONLY if Task 3 = GO.

**Files (in `apps/host`):**
- Modify: `src/screens/MiniappScreen.tsx`

**Interfaces:**
- Consumes: `parseDevRemotes`, `devResolveClient`, `isDevRemote`, `noopVerifier` (host-runtime); `__DEV_REMOTES__` global (Task 1).

- [ ] **Step 1: Make the resolve client + verifier dev-aware**

In `src/screens/MiniappScreen.tsx`, update the imports and the module-level clients:

```tsx
import {
  MiniappHost,
  createScopedGrant,
  httpResolveClient,
  sha256Verifier,
  noopVerifier,
  parseDevRemotes,
  devResolveClient,
  isDevRemote,
} from '@dentvega/host-runtime';
// ...
// Dev remotes (Mode 2): under __DEV__, listed ids resolve to their live dev
// server (no integrity). In release, __DEV_REMOTES__ is '' → empty map → the
// real HTTP client + sha256 verifier, unchanged.
const devRemotes = __DEV__ ? parseDevRemotes(__DEV_REMOTES__) : {};
const resolveClient = __DEV__
  ? devResolveClient(BACKSTAGE_BASE_URL, devRemotes)
  : httpResolveClient(BACKSTAGE_BASE_URL);
const integrityVerifier = sha256Verifier();
```

Then in the component's returned JSX, choose the verifier per id:

```tsx
      <MiniappHost
        id={id}
        resolveClient={resolveClient}
        chunkLoader={repackChunkLoader}
        hostProvided={HOST_PROVIDED}
        capabilities={grant}
        integrity={isDevRemote(id, devRemotes) ? noopVerifier : integrityVerifier}
      />
```

- [ ] **Step 2: Typecheck**

Run: `cd /Volumes/SSDExterno/prodproyects/backstagereactnative && pnpm --filter @app/host typecheck`
Expected: no type errors.

- [ ] **Step 3: Manual verification note (controller/user)**

Not automatable. Verify: miniapp `pnpm start` (:9000); host `DEV_REMOTES="account_dashboard=http://localhost:9000" pnpm --filter @app/host start` + `adb reverse tcp:9000 tcp:9000`; open the miniapp from Home → it loads from the live dev server; edit → RR → change visible. Record; don't block the commit.

- [ ] **Step 4: Commit**

```bash
cd /Volumes/SSDExterno/prodproyects/backstagereactnative
git add apps/host/src/screens/MiniappScreen.tsx
git commit -m "feat(host/dev): MiniappScreen consumes dev remotes under __DEV__ (Mode 2)"
```

---

## Task 6: Docs — LOCAL-DEV.md "Hot reload / dev-loop rápido"

**Files:**
- Modify: `/Volumes/SSDExterno/prodproyects/backstage-web/docs/LOCAL-DEV.md`

- [ ] **Step 1: Add a section**

Add a new section (before "## 7. Troubleshooting") titled `## 6b. Hot reload — dev-loop rápido (Modo 1 y 2)` documenting:
- **Modo 1 (Fast Refresh):** `DEV_MINIAPP_PATH=../miniapp-<id> pnpm --filter @app/host start` → abrir "Dev Mount" → editar `Screen.tsx` → refresco instantáneo. Límite: no prueba federación; solo deps compartidas.
- **Modo 2 (dev server):** miniapp `pnpm start` (:9000) + host `DEV_REMOTES="<id>=http://localhost:9000" pnpm --filter @app/host start` + `adb reverse tcp:9000 tcp:9000` → abrir desde Home → editar → RR. Prueba la federación real; sin publish.
- Tabla "qué modo para qué tarea" (Modo 1 UI, Modo 2 integración federada, build→publish para release).
- Nota: ambos son `__DEV__`-only; no afectan release.

Only if Tasks 4–5 were skipped (spike NO-GO), document Modo 1 only and note Modo 2 as pending.

- [ ] **Step 2: Verify fences balanced + commit**

```bash
cd /Volumes/SSDExterno/prodproyects/backstage-web
test $(( $(grep -c '```' docs/LOCAL-DEV.md) % 2 )) -eq 0 && echo "fences ok"
git add docs/LOCAL-DEV.md
git commit -m "docs(local-dev): hot reload dev-loop (Modo 1 dev-mount + Modo 2 dev server)"
git push origin main
```

---

## Self-Review notes (author)

- **Spec coverage:** §3 Mode 1 → Tasks 1–2; §4 spike → Task 3; §4.2 Mode 2 → Tasks 4–5; §6 testing → Task 4 (units) + manual notes; §7 gating invariant → Task 1 (alias fallback), Task 5 (`__DEV__` map ''); docs → Task 6.
- **Spike gate:** Tasks 4–5 explicitly conditioned on Task 3 = GO; the synthetic manifest is confirmed by the spike before Task 4 hardcodes it.
- **Additive/no-break:** release path untouched — alias → NoMiniapp, `__DEV_REMOTES__=''` → empty map → real client + sha256. Verified by `typecheck` per task (a full `bundle:android` is the fuller check the controller can run once at the end).
- **Type consistency:** `parseDevRemotes`/`devResolveClient`/`isDevRemote`/`__DEV_MINIAPP_CAPS__`/`__DEV_REMOTES__` names identical across tasks.
