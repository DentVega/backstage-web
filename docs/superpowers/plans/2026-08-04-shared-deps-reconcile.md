# Check de reconciliación package.json ↔ SHARED_DEPS — Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Agregar `BUNDLED_DEPS` + `reconcileDeps` a `shared-deps.mjs` y tests que gaten el `package.json` real, para forzar clasificar cada runtime dep (shared/native/bundled).

## Global Constraints

- **Repo:** `backstagereactnative`, `/Volumes/SSDExterno/prodproyects/backstagereactnative`.
- **`main` protegido** (`blast-radius` + `test` required, enforce_admins) → entra por **PR**.
- Solo `dependencies` (no devDeps). `native ⊆ dependencies` NO se exige.
- El código completo está en el spec `2026-08-04-shared-deps-reconcile-design.md`.

---

### Task 1: `reconcileDeps` + `BUNDLED_DEPS` + tests (local green)

**Files:**
- Modify: `apps/host/shared-deps.mjs`
- Modify: `apps/host/scripts/__tests__/shared-deps.test.mjs`

- [ ] **Step 1** Agregar `BUNDLED_DEPS` + `reconcileDeps` a `shared-deps.mjs` (código del spec §Diseño).
- [ ] **Step 2** Agregar los 5 tests a `shared-deps.test.mjs` (4 unitarios + 1 integración con el package.json real; código del spec).
- [ ] **Step 3** Correr: `node --test apps/host/scripts/__tests__/shared-deps.test.mjs` → todo verde (el gate real pasa sobre las 12 deps actuales). Si `unclassified` no está vacío → alguna dep del package.json no está clasificada; revisar la clasificación (bug del plan) antes de seguir.
- [ ] **Step 4** Prueba negativa: agregar temporalmente `"lodash": "^4"` a `apps/host/package.json` dependencies → correr el test → debe fallar con "sin clasificar: lodash" → **revertir** el package.json → verde de nuevo.
- [ ] **Step 5** Correr toda la suite de scripts: `node --test apps/host/scripts/__tests__/*.test.mjs` → verde.

---

### Task 2: PR + merge

- [ ] **Step 1** Branch `feat/reconcile-shared-deps` desde `origin/main`, commit, push, `gh pr create`.
- [ ] **Step 2** Esperar checks (`blast-radius` + `test`); el `test` ahora incluye la reconciliación → debe salir verde. Si rojo → leer log.
- [ ] **Step 3** `gh pr merge --squash --delete-branch`.

---

## Notas

- No hay CLI: el test node:test ES el gate (corre en `tests.yml` del host).
- Behavior-preserving para todo lo demás (solo se AGREGA una función + una lista + tests).
