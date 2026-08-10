# Auth con ownership por-miniapp (#3) — Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans. Código en el spec `2026-08-10-miniapp-ownership-design.md`.

**Goal:** Maintainers por-miniapp (`canManageMiniapp` = admin ∪ maintainer, binario, self-govern).

## Global Constraints

- Todo en **backstage-web** (vitest, push directo a main).
- **Sin regresión:** `canManageMiniapp` es superset de `canScaffold` (miniapps sin maintainers → los platform-admins siguen gestionando todo).
- Publish (upload) NO cambia (token-gated). Acciones globales (crear/reseed/sync-all/storage-default) siguen `canScaffold`.

---

### Task 1: Core — tipos + authz + registry

**Files:** `lib/registry/types.ts`, `lib/scaffold-authz.ts`, `lib/registry/registry.ts` + tests.

- [ ] **Step 1** `types.ts`: `MiniappRecord` += `readonly maintainers?: string[]`; `MiniappDetail` += `readonly maintainers?: string[]`.
- [ ] **Step 2** `scaffold-authz.ts`: `canManageMiniapp(login, maintainers, allowlist)` (código spec §2).
- [ ] **Step 3** `registry.ts`: `setMaintainers(reg, id, list)` (normaliza/dedup, vacío borra el campo); `getMiniappDetail` proyecta `maintainers`.
- [ ] **Step 4** Tests: `canManageMiniapp` (admin/maintainer case-insensitive/tercero/sin-login); `setMaintainers` (set/dedup/vacío/404/no-muta); detail proyecta.
- [ ] **Step 5** `npx vitest run lib` verde.

---

### Task 2: Swap del gate en las 6 rutas por-miniapp

**Files:** `deploy`, `sync-template`, `pin`, `storage-provider`, `versions/[version]`, `[id]` routes.

- [ ] **Step 1** En cada una: importar `canManageMiniapp`; **cargar el reg ANTES del gate** (deploy/sync-template lo cargan nuevo; el resto mover el `load` arriba); gate `if (!canManageMiniapp(session?.githubLogin, reg[id]?.maintainers, scaffoldAllowedLogins())) throw new ScaffoldForbiddenError()`. Reusar el `reg` cargado para el resto.
- [ ] **Step 2** Ajustar los tests de esas rutas si asertan el 403 (siguen dando 403 para no-admin sin maintainers). Agregar 1 test: un maintainer no-admin puede (en `pin` o `versions`).
- [ ] **Step 3** `npx vitest run app/api` verde.

---

### Task 3: Ruta maintainers + UI + detalle

**Files:** `app/api/miniapps/[id]/maintainers/route.ts` (nuevo), `app/components/MaintainersControl.tsx` (nuevo), `app/miniapp/[id]/page.tsx` + tests.

- [ ] **Step 1** `maintainers/route.ts`: `PUT` gated por `canManageMiniapp` (admin o maintainer); body `{maintainers: string[]}` → `setMaintainers` → detail.
- [ ] **Step 2** `MaintainersControl.tsx` (client): chips con ✕ + input para agregar + Guardar → `PUT /api/miniapps/:id/maintainers` → refresh.
- [ ] **Step 3** `page.tsx`: `canManage = canManageMiniapp(login, detail.maintainers, allowlist)`; los controles admin usan `canManage`; montar `<MaintainersControl>`.
- [ ] **Step 4** Tests: ruta (admin/maintainer setea; tercero 403; 404); `MaintainersControl` (render + agregar + save).
- [ ] **Step 5** `npx vitest run` + `npx tsc --noEmit` verde.

---

### Task 4: Push
- [ ] Commit + push main (Vercel). Env: la allowlist ahora = platform-admins; los maintainers se asignan por-miniapp desde la UI.

## Notas
- Riesgo bajo: superset del gate. Lo más sensible = no romper los tests de las rutas al mover el `load`.
