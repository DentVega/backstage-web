# PR-time Compat Gate (shift-left miniapp→host) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correr el gate `check-compat` en cada Pull Request de una miniapp para que un cambio incompatible con el Host Contract muestre una ✗ antes del merge, sin tocar la lógica de los scripts ni el gate de publish.

**Architecture:** Un nuevo workflow reusable `check-compat.yml` (solo chequeo, sin build/publish) en `miniapp-template`, invocado desde `ci.yml` en el evento `pull_request`. Reusa los scripts existentes `gen-manifest-shared.mjs` + `check-compat.mjs` tal cual. El gate de publish (`publish.yml`) queda intacto como red final post-merge. Se propaga a la flota por template-sync.

**Tech Stack:** GitHub Actions (reusable workflows / `workflow_call`), pnpm, Node 20, los scripts `.mjs` existentes (`node:test` ya los cubre). Ruby (psych, viene con macOS) para validar YAML localmente.

## Global Constraints

- **Repo de trabajo:** `miniapp-template` en `miniapp-template`. El spec vive en `backstage-web` pero **el código es todo en `miniapp-template`**.
- **`miniapp-template/main` NO está protegido** → push directo a `main` permitido (patrón del proyecto).
- **Cero cambios en `scripts/*.mjs` y en `publish.yml`.** Solo YAML nuevo/modificado. Si un task necesita tocar un `.mjs`, algo salió mal — parar y preguntar.
- **`check-compat.yml` usa `COMPAT_ENFORCE: "1"` fijo** (literal string), NO `${{ vars.COMPAT_ENFORCE }}`. El enforce de rollout ya terminó; el PR check siempre bloquea/rojo.
- **El reusable solo recibe el secreto `BACKSTAGE_URL`** (URL pública). NO `PUBLISH_TOKEN`.
- **El job `publish` NO debe correr en PRs:** lleva `if: github.event_name != 'pull_request'`.
- **Referencias reusables:** `uses: DentVega/miniapp-template/.github/workflows/<file>.yml@main`.
- **Rollout-safe (copiar el patrón de `publish.yml`):** si `scripts/gen-manifest-shared.mjs` o `scripts/check-compat.mjs` no existen (miniapp no sincronizada) → `echo ... skipping`, no romper.
- **Setup del job** (pnpm v10 + node 20 + install con `~/.npmrc` de GitHub Packages usando `secrets.GITHUB_TOKEN`) se copia **verbatim** de `publish.yml` para consistencia.

---

### Task 1: Reusable workflow `check-compat.yml`

**Files:**
- Create: `miniapp-template/.github/workflows/check-compat.yml`

**Interfaces:**
- Consumes: los scripts existentes `scripts/gen-manifest-shared.mjs` y `scripts/check-compat.mjs` (sin cambios); el secreto `BACKSTAGE_URL`; el `secrets.GITHUB_TOKEN` automático (para leer `@dentvega/*` de GitHub Packages).
- Produces: workflow reusable `check-compat.yml` con `on: workflow_call` que declara `secrets.BACKSTAGE_URL` (required). Lo invoca Task 2 con `uses: DentVega/miniapp-template/.github/workflows/check-compat.yml@main` + `secrets: inherit`.

- [ ] **Step 1: Crear el archivo con el contenido exacto**

Crear `miniapp-template/.github/workflows/check-compat.yml`:

```yaml
name: Compat check (reusable)

# Chequeo de compatibilidad miniapp→host para correr EN PRs (shift-left).
# No buildea ni publica: instala deps, re-deriva el manifest y corre el gate.
# El gate de publish (publish.yml) sigue siendo la red final post-merge.
#
# Fijar este archivo arregla el PR check de todas las miniapps a la vez
# (referencian @main), igual que publish.yml.

on:
  workflow_call:
    secrets:
      BACKSTAGE_URL:
        required: true

jobs:
  compat:
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
        # pnpm ignora el ${TOKEN} de un .npmrc committeado; escribimos la auth a
        # un ~/.npmrc con el token literal. @dentvega/* son públicos, así que el
        # GITHUB_TOKEN automático alcanza para leerlos.
        run: |
          echo "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" >> ~/.npmrc
          pnpm install --frozen-lockfile=false
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Compat gate (miniapp → host contract)
        # Mismo GUARD que publish.yml: si los scripts todavía no llegaron a este
        # repo (miniapp no sincronizada), se saltea en vez de romper el check.
        # gen re-deriva manifest.shared + nativeModules de las deps reales; check
        # falla (exit 1) si hay skew o un nativo que el host no tiene.
        # COMPAT_ENFORCE=1 FIJO: un check que solo advierte no sirve como gate de PR.
        run: |
          if [ -f scripts/gen-manifest-shared.mjs ] && [ -f scripts/check-compat.mjs ]; then
            node scripts/gen-manifest-shared.mjs
            node scripts/check-compat.mjs
          else
            echo "compat gate scripts not present (miniapp not yet synced) — skipping"
          fi
        env:
          BACKSTAGE_URL: ${{ secrets.BACKSTAGE_URL }}
          COMPAT_ENFORCE: "1"
```

- [ ] **Step 2: Validar que el YAML parsea**

Run:
```bash
ruby -ryaml -e "YAML.load_file('miniapp-template/.github/workflows/check-compat.yml'); puts 'YAML OK'"
```
Expected: `YAML OK` (sin excepción de psych).

- [ ] **Step 3: Verificar las invariantes del spec con grep**

Run:
```bash
cd miniapp-template
grep -q 'COMPAT_ENFORCE: "1"' .github/workflows/check-compat.yml && echo "enforce-fijo OK"
grep -q 'workflow_call' .github/workflows/check-compat.yml && echo "reusable OK"
! grep -q 'PUBLISH_TOKEN' .github/workflows/check-compat.yml && echo "sin-publish-token OK"
! grep -qE 'webpack-bundle|publish\.mjs|zip ' .github/workflows/check-compat.yml && echo "sin-build OK"
```
Expected: las 4 líneas `... OK`.

- [ ] **Step 4: Commit**

```bash
cd miniapp-template
git add .github/workflows/check-compat.yml
git commit -m "ci: reusable check-compat.yml (PR-time compat gate, no build/publish)"
```

---

### Task 2: Wire `ci.yml` — trigger `pull_request` + job `compat` + guard en `publish`

**Files:**
- Modify: `miniapp-template/.github/workflows/ci.yml`

**Interfaces:**
- Consumes: el reusable `check-compat.yml@main` de Task 1.
- Produces: `ci.yml` con trigger `pull_request` añadido, un job `compat` que invoca el reusable, y el job `publish` guardado con `if: github.event_name != 'pull_request'`. Este `ci.yml` es lo que template-sync propaga a cada miniapp (Task 3).

Estado actual del archivo (referencia — NO es lo que hay que escribir, es el punto de partida):
```yaml
name: Publish miniapp

on:
  push:
    branches: [main]
    tags: ["v*"]
  workflow_dispatch:

jobs:
  publish:
    uses: DentVega/miniapp-template/.github/workflows/publish.yml@main
    secrets: inherit
```

- [ ] **Step 1: Reemplazar el contenido completo de `ci.yml`**

Escribir `miniapp-template/.github/workflows/ci.yml` con:

```yaml
name: Publish miniapp

# Thin caller — el build+publish real vive en el reusable publish.yml, y el
# gate de compat en PRs vive en check-compat.yml. Un fix en cualquiera de esos
# alcanza a todas las miniapps a la vez (referencian @main), sin update por repo.

on:
  push:
    branches: [main]
    tags: ["v*"]
  # Deja que el botón "Deploy" de Backstage dispare un build+publish on demand.
  workflow_dispatch:
  # Gate de compat en el PR (shift-left): la ✗ aparece antes del merge.
  pull_request:

jobs:
  # Corre en PRs: chequea compat contra el host contract SIN buildear/publicar.
  compat:
    uses: DentVega/miniapp-template/.github/workflows/check-compat.yml@main
    secrets: inherit

  publish:
    # El publish NO corre en PRs — solo en push a main / tag / botón Deploy.
    if: github.event_name != 'pull_request'
    uses: DentVega/miniapp-template/.github/workflows/publish.yml@main
    secrets: inherit
```

- [ ] **Step 2: Validar que el YAML parsea**

Run:
```bash
ruby -ryaml -e "YAML.load_file('miniapp-template/.github/workflows/ci.yml'); puts 'YAML OK'"
```
Expected: `YAML OK`.

- [ ] **Step 3: Verificar las invariantes del spec con grep**

Run:
```bash
cd miniapp-template
grep -q 'pull_request:' .github/workflows/ci.yml && echo "trigger-pr OK"
grep -q "if: github.event_name != 'pull_request'" .github/workflows/ci.yml && echo "publish-guard OK"
grep -q 'check-compat.yml@main' .github/workflows/ci.yml && echo "llama-reusable OK"
```
Expected: las 3 líneas `... OK`.

- [ ] **Step 4: Commit**

```bash
cd miniapp-template
git add .github/workflows/ci.yml
git commit -m "ci: run compat gate on pull_request (shift-left); publish skips PRs"
```

---

### Task 3: Ship a `main` + verificación e2e (PR incompatible rojo / compatible verde)

**Files:**
- No modifica archivos. Push de Task 1+2 + verificación operativa con `gh`.

**Interfaces:**
- Consumes: los commits de Task 1 y Task 2 en `miniapp-template`.
- Produces: workflows live en `miniapp-template/main`; una miniapp sincronizada (`hellow_widget`) con el PR check activo; evidencia de que un PR incompatible sale rojo, uno compatible verde, y `publish` no corre en PRs.

- [ ] **Step 1: Push a `main` de `miniapp-template`**

```bash
cd miniapp-template
git push origin main
```
Expected: push OK (main no protegido).

- [ ] **Step 2: Propagar `ci.yml` a `hellow_widget` (la miniapp de prueba)**

El reusable `check-compat.yml` ya está live `@main`, pero el caller `ci.yml` (con el trigger `pull_request`) llega a cada miniapp por template-sync. Para probar ya, disparar el sync de `hellow_widget` desde Backstage (botón "Actualizar desde template") o vía la ruta `sync-template`, y **mergear el PR de sync** que actualiza `ci.yml`.

Verificar que el `ci.yml` de `hellow_widget` en su `main` ya tiene el trigger:
```bash
gh api repos/DentVega/miniapp-hellow_widget/contents/.github/workflows/ci.yml --jq '.content' | base64 -d | grep -q 'pull_request:' && echo "hellow_widget synced OK"
```
Expected: `hellow_widget synced OK`. Si falla: el sync aún no se mergeó — completar el sync antes de seguir.

- [ ] **Step 3: Caso INCOMPATIBLE — el PR de demo #4 debe salir rojo**

PR #4 (`demo/miniapp-adds-native`, agrega `react-native-mmkv`) ya existe. Al estar `ci.yml` sincronizado con el trigger `pull_request`, empujar un commit vacío a su branch para re-disparar los checks:
```bash
cd <repos>
# refrescar el branch del PR para gatillar el nuevo trigger
gh api repos/DentVega/miniapp-hellow_widget/git/refs/heads/demo/miniapp-adds-native --jq '.object.sha'
gh pr checks 4 --repo DentVega/miniapp-hellow_widget --watch
```
Expected: aparece el check **`compat`** y termina en **fail (✗)**. Ver el log:
```bash
gh run list --repo DentVega/miniapp-hellow_widget --workflow "Publish miniapp" --event pull_request -L 1
```
Expected en el log del job `compat`: `check-compat: INCOMPATIBLE with host contract v0.1.0 — react-native-mmkv (native module not in host)` y el job falla. Confirmar además que el job `publish` **no corrió** (skipped/ausente en ese run).

- [ ] **Step 4: Caso COMPATIBLE — un PR trivial debe salir verde**

Crear un PR con un cambio inocuo (sin tocar deps):
```bash
cd <repos>
BR="demo/compat-green-check"
gh api repos/DentVega/miniapp-hellow_widget/git/refs/heads/main --jq '.object.sha'   # base sha
# crear branch + commit trivial (editar README) vía API o checkout local del repo hellow_widget
gh pr create --repo DentVega/miniapp-hellow_widget --head "$BR" --base main \
  --title "[DEMO · NO MERGEAR] PR compatible — el gate lo deja pasar ✅" \
  --body "Cambio trivial sin tocar deps. El check compat debe salir verde."
gh pr checks --repo DentVega/miniapp-hellow_widget --watch
```
Expected: el check **`compat`** termina en **success (✓)** con `check-compat: OK vs host contract v0.1.0`; `publish` no corre.

- [ ] **Step 5: Dejar ambos PRs de demo en estado limpio**

Marcar el PR compatible como Draft (como los otros demos) y confirmar que ninguno se mergea:
```bash
cd <repos>
gh pr ready "$(gh pr list --repo DentVega/miniapp-hellow_widget --head demo/compat-green-check --json number --jq '.[0].number')" --repo DentVega/miniapp-hellow_widget --undo
```
Expected: PR compatible en Draft. Reportar al usuario los dos PRs (rojo #4 + verde nuevo) como evidencia e2e; **no mergear ninguno**.

- [ ] **Step 6: (Sin commit)** No hay cambios de código en este task. Reportar el resultado de la verificación.

---

## ⚠️ Corrección durante la ejecución (Task 3)

El plan asumía que template-sync entregaría el `ci.yml` a la flota. **No puede:** el `GITHUB_TOKEN` del sync no puede pushear `.github/workflows/*` (falta el permiso `workflows`, no otorgable en YAML), y `.templatesyncignore` ya excluía todos los workflows a propósito. Ajustes reales aplicados:

1. **`check-compat.yml` agregado a `.templatesyncignore`** (commit `b01a352` en el template) — es un reusable template-only, no debe copiarse a las miniapps. Sin esto, el sync intenta copiarlo y choca con el muro de `workflows`.
2. **El `ci.yml` se entrega out-of-band** con un token con scope `workflow` (push directo a `main` de la miniapp). Para `hellow_widget`: commit `e90e5df`.
3. **Trigger de un PR pre-existente:** un PR abierto antes de que su rama tuviera el trigger no dispara el check (GitHub usa el `ci.yml` de la **rama del PR** en eventos `pull_request`). Se resolvió mergeando `main` en la rama del PR (evento `synchronize`).

Evidencia e2e (`hellow_widget`): PR #4 (nativo `react-native-mmkv`) → `compat: failure` + `publish: skipped`; PR #5 (cambio trivial) → `compat: success` + `publish: skipped`. Ambos en Draft, sin mergear. Ver [[template-sync-no-propaga-workflows]].

## Notas de ejecución

- **No hay TDD clásico:** el entregable es YAML de CI, y la lógica del gate ya está cubierta por los `node:test` de `check-compat.mjs`/`gen-manifest-shared.mjs`. Por eso cada task de código valida con parse de YAML + grep de invariantes, y la verificación real es el e2e de Task 3.
- **Fuera de alcance (fase 2):** branch protection en repos de miniapp con `compat` como *required check* para convertir la ✗ en bloqueo duro. Este plan solo deja el check corriendo y rojo/verde correctamente.
- **Propagación a toda la flota:** una vez validado en `hellow_widget`, el resto de las miniapps recibe el `ci.yml` nuevo por template-sync en su cadencia normal; hasta entonces siguen sin PR check (rollout-safe, no rompe).
