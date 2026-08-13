# Catálogo refleja la versión servida — Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Que el catálogo (host + web) muestre `servedVersion` con indicador de rollback. Código en el spec `2026-08-08-catalog-served-version-design.md`.

## Global Constraints

- **backstage-web** (`backstage-web`): vitest, push directo a main (Vercel deploy).
- **backstagereactnative** (`backstagereactnative`): jest, main **protegido** → entra por PR (checks `blast-radius` + `test`).
- `servedVersion` es **requerido** en `CatalogEntry` (backend) pero **opcional** en `MiniappSummary` (host, fallback a `latestVersion`).
- Solo arregla la etiqueta; `resolveMiniapp` no se toca.

---

### Task 1: Backend + web (backstage-web)

**Files:** `lib/registry/types.ts`, `lib/registry/registry.ts`, `app/components/CatalogList.tsx` + tests.

- [ ] **Step 1** `types.ts`: `CatalogEntry` += `readonly servedVersion: SemVer | null`.
- [ ] **Step 2** `registry.ts`: `listCatalog` → `servedVersion: record.pinnedVersion ?? latest?.version ?? null`.
- [ ] **Step 3** `CatalogList.tsx`: card muestra `servedVersion`; si `servedVersion !== latestVersion` → indicador `🔒 · última vX`.
- [ ] **Step 4** Arreglar fixtures/tests que arman `CatalogEntry` a mano (tsc te dice cuáles) + test: `listCatalog` incluye `servedVersion = pinned ?? latest`; `CatalogList` muestra servida + indicador cuando difieren.
- [ ] **Step 5** `npx vitest run` + `npx tsc --noEmit` → verde.
- [ ] **Step 6** Commit + `git push origin main` (Vercel deploy). Verificar post-deploy: `/api/miniapps` incluye `servedVersion` (hellow_widget = 0.1.12).

---

### Task 2: Host (backstagereactnative) — vía PR

**Files:** `packages/host-runtime/src/CatalogClient.ts`, `apps/host/src/screens/HomeScreen.tsx` + tests.

- [ ] **Step 1** `CatalogClient.ts`: `MiniappSummary` += `readonly servedVersion?: string | null`.
- [ ] **Step 2** `HomeScreen.tsx`: `const served = item.servedVersion ?? item.latestVersion; const rolledBack = served != null && item.latestVersion != null && served !== item.latestVersion;` → card muestra `v${served}`; si `rolledBack`, línea/nota `🔒 fijada (última v${item.latestVersion})` con color de acento.
- [ ] **Step 3** Tests: card muestra la servida; `servedVersion` ausente → cae a `latestVersion`; indicador cuando difieren. `pnpm -r --if-present test` local (o el subset host-runtime + host).
- [ ] **Step 4** Branch `feat/catalog-served-version`, commit, push, PR; esperar `test` + `blast-radius` verdes; merge squash.

---

### Task 3: e2e

- [ ] **Step 1** Con hellow_widget pinneado a 0.1.12: `GET /api/miniapps` → `servedVersion: "0.1.12"`, `latestVersion: "0.1.13"`.
- [ ] **Step 2** El usuario recarga el emulador → la card de Hello Widget muestra v0.1.12 + el indicador de rollback. (Reporte + guía; el reload es del usuario.)

---

## Notas
- Backend primero (deploy) → host después (consume `servedVersion`, backward-safe si falta).
- El emulador corre del checkout local del host → reload de Metro refleja el cambio en dev.
