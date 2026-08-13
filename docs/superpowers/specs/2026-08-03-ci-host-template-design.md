# CI en host + template (test-gating de PRs) — Design

**Fecha:** 2026-08-03
**Estado:** Aprobado (listo para plan)
**Repos afectados:** `backstagereactnative` (host monorepo) y `miniapp-template`
**Owner:** <owner>
**Roadmap:** #17 (CI en los otros repos). #6 (test del merge engine de Capa 2) **diferido** a un follow-up.

---

## Goal

Correr las suites de test **ya existentes** de `backstagereactnative` y `miniapp-template` en cada Pull Request, y hacer que **bloqueen el merge** (required check). Hoy el motor de gobernanza (blast-radius, check-compat, gen-host-contract, el merge de Capa 2) descansa sobre scripts cuyos tests **nunca corren en CI** → se podría romper y mergear sin aviso.

## Problema / estado actual

- **`backstage-web`** ya tiene CI (tsc + vitest). ✅
- **`backstagereactnative`** (monorepo pnpm): `pnpm -r test` corre **jest** en `packages/*` (host-runtime, miniapp-contract, ui-kit) + `apps/host`. Pero los scripts críticos usan **`node:test`** (`apps/host/scripts/__tests__/*.test.mjs` — gen-host-contract, check-host-compat, shared-deps, publish-host-contract — y `scripts/bootstrap.test.mjs`) → **jest no los corre** (jest está configurado para ignorar `scripts/`). `main` tiene branch protection (`blast-radius` required, enforce_admins=true) pero **sin** gate de tests.
- **`miniapp-template`**: `package.json` tiene `"test": "jest"` + `jest.config.js`, pero **todos** sus tests son `node:test` (`scripts/bootstrap.test.mjs`, `scripts/publish.test.mjs`, `scripts/__tests__/check-compat.test.mjs`, `scripts/__tests__/gen-manifest-shared.test.mjs`) → el `jest` actual corre ~nada. `main` **no** está protegido.

**Conclusión:** los `.mjs` `node:test` no los ejecuta nadie en PR, en ninguno de los dos repos.

## Approach

Un workflow `tests.yml` por repo, disparado en `pull_request`, que corre **typecheck + todas las suites** (jest donde aplica + `node --test` para los `.mjs`), marcado como **required status check** vía branch protection. No se agrega lógica ni tests nuevos: solo se cablea lo que ya existe (y se corrige el `test` script del template, que hoy miente).

Alternativas descartadas:
- **Meter los tests dentro de los workflows existentes** (`host-compat.yml`, `ci.yml`): mezclaría responsabilidades (gobernanza/publish vs. unit tests) y complica los triggers. Un `tests.yml` dedicado es más claro.
- **Solo `pnpm -r test`** sin `node --test`: dejaría fuera justo los scripts críticos (los `.mjs`), que es el hueco que este spec cierra.

## Diseño detallado

### 1. `backstagereactnative/.github/workflows/tests.yml`

```yaml
name: Tests

on:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - name: Install
        run: pnpm install --frozen-lockfile
      - name: Typecheck
        run: pnpm -r --if-present typecheck
      - name: Unit tests (jest — packages + host)
        run: pnpm -r --if-present test
      - name: Script tests (node:test — .mjs)
        run: node --test apps/host/scripts/__tests__/*.test.mjs scripts/*.test.mjs
```

- **`@dentvega/*` son workspace packages** (`packages/miniapp-contract`, `packages/ui-kit`) → el install es local, **no** necesita auth de GitHub Packages.
- El job se llama **`test`** → el status check context será **`test`** (a confirmar desde un run real antes de marcarlo required — ver §3).
- Node 20 (matchea `engines: >=20`). El bump a 24 es el ítem #15, separado.

### 2. `miniapp-template/.github/workflows/tests.yml`

```yaml
name: Tests

on:
  pull_request:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm
      - name: Install deps (GitHub Packages)
        run: |
          echo "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" >> ~/.npmrc
          pnpm install --frozen-lockfile=false
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Typecheck
        run: pnpm typecheck
      - name: Script tests (node:test)
        run: node --test scripts/*.test.mjs scripts/__tests__/*.test.mjs
```

- El template **sí** depende de `@dentvega/*` (público) → replica el paso `~/.npmrc` de `publish.yml` con el `GITHUB_TOKEN` automático (y `--frozen-lockfile=false`, como publish).
- El job se llama **`test`** → context **`test`**.

### 3. Corregir el script `test` del template (hoy apunta a jest vacío)

En `miniapp-template/package.json`, cambiar:
```json
"test": "jest"
```
por algo que corra los tests reales (node:test) y deje jest para cuando haya tests de componente:
```json
"test": "node --test scripts/*.test.mjs scripts/__tests__/*.test.mjs && jest --passWithNoTests"
```
`package.json` **no** está en `.templatesyncignore` → este fix se propaga a las miniapps por template-sync (bien: sus scripts sincronizados quedan testeables con `pnpm test`).

### 4. `.templatesyncignore` — excluir el nuevo `tests.yml` del template

**Crítico (lección de hoy, ver [[template-sync-no-propaga-workflows]]):** el nuevo `tests.yml` es un workflow. Si no se excluye, template-sync intentará copiarlo a cada miniapp y **chocará con el muro de `workflows`** (el `GITHUB_TOKEN` no puede pushear `.github/workflows/*`). Agregar a `.templatesyncignore`:
```
.github/workflows/tests.yml
```
(El test-CI del template es para los PRs **del template**; las miniapps no lo necesitan — su compat ya se chequea con el gate `check-compat` en PR.)

### 5. Branch protection (required check en ambos)

Confirmar primero el context exacto desde un run real (patrón aprendido con `compat / compat`), luego:

- **`backstagereactnative/main`** — ya está protegido (`blast-radius` required, `enforce_admins=true`). **Agregar** `test` a `required_status_checks.contexts` (queda `["blast-radius", "test"]`), manteniendo `enforce_admins=true` (coherente con lo existente en este repo; sus PRs son de dev, no hay PRs de `GITHUB_TOKEN` acá).
- **`miniapp-template/main`** — habilitar branch protection nueva: `required_status_checks: { strict: false, contexts: ["test"] }`, **`enforce_admins: false`** (el owner conserva el push directo, que usamos para propagar cambios del template rápido), `required_pull_request_reviews: null`, `restrictions: null`. Es public → branch protection disponible en plan free.

## Qué NO cambia

- No se escribe ni un test nuevo (salvo el fix del script `test` del template).
- `host-compat.yml`, `host-contract.yml`, `ci.yml`, `publish.yml`, `check-compat.yml`, `template-sync.yml` — intactos.
- El sistema de compat — intacto.

## Verificación (e2e)

Es CI (YAML + config), la lógica testeada ya está cubierta. Se valida de punta a punta:
1. **host:** abrir un PR trivial en `backstagereactnative` → el check `test` corre y sale **verde** (typecheck + jest + node:test todos pasan sobre el estado actual de main). Confirmar el context name.
2. **host — rojo:** (opcional) romper un test a propósito en una rama → el check sale **rojo** y (con branch protection) bloquea el merge. Revertir.
3. **template:** abrir un PR trivial en `miniapp-template` → el check `test` corre verde. Confirmar context.
4. Confirmar branch protection activa en ambos (`GET .../branches/main/protection` lista `test` como required).

## Fuera de alcance

- **#6 — test de regresión del merge engine de Capa 2** (3-way merge de `template-sync.yml`). Es otra naturaleza (fixtures de repos git + correr el merge + assertar). Merece su propio spec. **Diferido.**
- **#15 — bump Node 20→24** en los repos. Separado; este spec usa Node 20 para matchear el estado actual.
- ESLint como gate (el host tiene `lint` pero no todos los workspaces) — YAGNI por ahora.

## Archivos afectados

- **Crear:** `backstagereactnative/.github/workflows/tests.yml`
- **Crear:** `miniapp-template/.github/workflows/tests.yml`
- **Modificar:** `miniapp-template/package.json` (script `test`)
- **Modificar:** `miniapp-template/.templatesyncignore` (excluir `tests.yml`)
- **Config (API, no archivos):** branch protection en `backstagereactnative/main` (agregar context) y `miniapp-template/main` (habilitar).
