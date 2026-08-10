# Cache host-side de resolve — Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans. Código completo en el spec `2026-08-09-host-resolve-cache-design.md`.

**Goal:** Cache in-memory por-versión del resolve en el host (baja lecturas a KV, respeta rollback).

## Global Constraints

- Todo en **`backstagereactnative`** (`/Volumes/SSDExterno/prodproyects/backstagereactnative`). Tests = jest + node:test. `main` protegido → **PR** (checks `blast-radius` + `test`).
- Solo cachear cuando el request trae `version` (determinístico/inmutable). Sin versión → pasa derecho. Fallos NO se cachean.
- `backstage-web` no cambia (`/api/resolve` ya acepta `?version`).
- In-memory por sesión (sin storage).

---

### Task 1: host-runtime — cache + plumbing del client

**Files:** `packages/miniapp-contract/src/types.ts`, `packages/host-runtime/src/{ResolveClient.ts, cachingResolveClient.ts (nuevo), useMiniapp.ts, MiniappHost.tsx}` + tests.

- [ ] **Step 1** `miniapp-contract/types.ts`: `ResolveRequest` += `readonly version?: SemVer`.
- [ ] **Step 2** `ResolveClient.ts` (httpResolveClient): sumar `&version=${encodeURIComponent(request.version)}` cuando `request.version` está (igual que `hostVersion`).
- [ ] **Step 3** Crear `cachingResolveClient.ts` (código del spec §3) + `index.ts` export.
- [ ] **Step 4** `useMiniapp.ts`: `deps` += `resolveVersion?: string`; `resolve({ id, version: deps.resolveVersion })`; agregar `deps.resolveVersion` a las deps del efecto.
- [ ] **Step 5** `MiniappHost.tsx`: prop `resolveVersion?: string` → pasarla a `useMiniapp`.
- [ ] **Step 6** Test `cachingResolveClient.test.ts` (jest): hit misma (id,versión) no re-llama; miss versión distinta re-llama; sin version pasa derecho (no cachea); fallo del inner no se cachea. + (si aplica) un test de `httpResolveClient` con `&version=`.
- [ ] **Step 7** `pnpm build:packages` + jest de host-runtime → verde.

---

### Task 2: apps/host — plumbing del servedVersion + wrap del cache

**Files:** `apps/host/src/{navigation.ts, screens/HomeScreen.tsx, screens/MiniappScreen.tsx}` + tests.

- [ ] **Step 1** `navigation.ts`: `Miniapp: {id: MiniappId; title: string; servedVersion?: string}`.
- [ ] **Step 2** `HomeScreen.tsx`: `navigation.navigate('Miniapp', { id, title, servedVersion: served })` (ya se computa `served` en `MiniappCard` — pasar el valor al onOpen/navigate).
- [ ] **Step 3** `MiniappScreen.tsx`: envolver el client con `cachingResolveClient(...)` (singleton de módulo); pasar `resolveVersion={route.params.servedVersion}` a `<MiniappHost>`.
- [ ] **Step 4** Tests: `HomeScreen` navega con `servedVersion` (extender App.test.tsx); `MiniappScreen` pasa `resolveVersion` (si hay test; si no, cubrir con el de host-runtime).
- [ ] **Step 5** `pnpm -r typecheck` + jest apps/host → verde.

---

### Task 3: verificación total + PR

- [ ] **Step 1** `pnpm build:packages`, `pnpm -r --if-present typecheck`, `pnpm -r --if-present test`, `node --test` de los scripts → todo verde local.
- [ ] **Step 2** Branch `feat/host-resolve-cache`, commit, push, PR. Esperar `test` + `blast-radius`.
- [ ] **Step 3** Merge squash.

---

## Notas
- Bastante plumbing pero bajo riesgo (backend intacto).
- La capa `cachingResolveClient` queda como hook para métricas (#12) más adelante.
