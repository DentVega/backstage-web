# CI en host + template (test-gating de PRs) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correr las suites de test existentes de `backstagereactnative` y `miniapp-template` en cada PR y hacerlas bloquear el merge (required check), sin escribir tests nuevos.

**Architecture:** Un `tests.yml` por repo (trigger `pull_request`) que corre typecheck + jest (donde aplica) + `node --test` (los `.mjs` que jest no toca), marcado como required status check. Se corrige el `test` script del template (hoy apunta a jest vacío) y se excluye el nuevo workflow del template-sync.

**Tech Stack:** GitHub Actions, pnpm 10, Node 20, jest (existente) + node:test (existente). Ruby (psych) para validar YAML local.

## Global Constraints

- **Repos:** `backstagereactnative` en `backstagereactnative`; `miniapp-template` en `miniapp-template`.
- **`backstagereactnative/main` está PROTEGIDO** (`blast-radius` required, enforce_admins=true) → **no se puede push directo**; los cambios entran por **PR**.
- **`miniapp-template/main` NO está protegido** → push directo permitido (se protege al final de este plan).
- **Cero tests nuevos.** El único cambio de código es el script `test` del template. Si un task necesita escribir un test, algo salió mal — parar.
- **Node 20, pnpm 10** en ambos workflows (el bump a 24 es otro ítem, fuera de alcance).
- **Job name = `test`** en ambos → el status check context será `test` (confirmar desde un run real antes de marcarlo required).
- **El `tests.yml` del template va a `.templatesyncignore`** (es workflow → el sync no puede propagarlo, choca con el muro de `workflows`). Ver [[template-sync-no-propaga-workflows]].
- **El PR check ES la verificación:** si los tests están rojos sobre el estado actual, el check lo revela → parar y reportar (no mergear un required-check rojo).
- El token local tiene scope `workflow` → puede crear/mergear PRs con archivos de workflow.

---

### Task 1: `tests.yml` en `backstagereactnative` (vía PR — main protegido)

**Files:**
- Create: `backstagereactnative/.github/workflows/tests.yml`

**Interfaces:**
- Consumes: los scripts `test`/`typecheck` existentes (root `pnpm -r --if-present`), los `.mjs` node:test (`apps/host/scripts/__tests__/*.test.mjs`, `scripts/*.test.mjs`). `@dentvega/*` son workspace packages → install local sin auth.
- Produces: workflow `Tests` con job `test` (context `test`), que corre en cada PR.

- [ ] **Step 1: Crear el archivo con el contenido exacto**

Crear `backstagereactnative/.github/workflows/tests.yml`:

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

- [ ] **Step 2: Validar YAML**

Run:
```bash
ruby -ryaml -e "YAML.load_file('backstagereactnative/.github/workflows/tests.yml'); puts 'YAML OK'"
```
Expected: `YAML OK`.

- [ ] **Step 3: Crear branch, commitear y abrir PR**

```bash
cd backstagereactnative
git checkout -b ci/tests-workflow
git add .github/workflows/tests.yml
git commit -m "ci: run test suites on PR (typecheck + jest + node:test)"
git push -u origin ci/tests-workflow
gh pr create --repo DentVega/backstagereactnative --base main --head ci/tests-workflow \
  --title "ci: test-gating en PRs (typecheck + jest + node:test)" \
  --body "Corre las suites existentes en cada PR. Los .mjs node:test hoy no los corría nadie. Cierra roadmap #17 (parte host)."
```
Expected: PR creado.

- [ ] **Step 4: Esperar los checks y confirmar `test` verde**

Run:
```bash
cd backstagereactnative
gh pr checks --repo DentVega/backstagereactnative --watch
```
Expected: aparece el check **`test`** y termina en **success**; `blast-radius` también verde.
**Si `test` sale rojo:** hay un test que falla sobre main → PARAR, leer el log (`gh run view <id> --log-failed`), reportar. No mergear.

- [ ] **Step 5: Capturar el context name exacto y mergear**

```bash
cd backstagereactnative
HEAD_SHA=$(gh pr view --repo DentVega/backstagereactnative --json headRefOid --jq '.headRefOid')
gh api repos/DentVega/backstagereactnative/commits/$HEAD_SHA/check-runs --jq '.check_runs[].name'   # anotar el context de tests (debería ser "test")
gh pr merge --repo DentVega/backstagereactnative --squash --delete-branch
```
Expected: contexts listados (anotar `test`); PR mergeado a main.

---

### Task 2: `tests.yml` + fix del `test` script + `.templatesyncignore` en `miniapp-template` (push directo)

**Files:**
- Create: `miniapp-template/.github/workflows/tests.yml`
- Modify: `miniapp-template/package.json` (script `test`)
- Modify: `miniapp-template/.templatesyncignore` (excluir `tests.yml`)

**Interfaces:**
- Consumes: los `.mjs` node:test del template (`scripts/*.test.mjs`, `scripts/__tests__/*.test.mjs`); `@dentvega/*` público (auth vía `~/.npmrc` + `GITHUB_TOKEN`, como `publish.yml`).
- Produces: workflow `Tests` con job `test` (context `test`); `pnpm test` local corre los tests reales; el sync ya no intentará copiar `tests.yml`.

- [ ] **Step 1: Crear `tests.yml`**

Crear `miniapp-template/.github/workflows/tests.yml`:

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

- [ ] **Step 2: Corregir el `test` script en `package.json`**

En `miniapp-template/package.json`, reemplazar la línea del script `test`:
```json
    "test": "jest"
```
por:
```json
    "test": "node --test scripts/*.test.mjs scripts/__tests__/*.test.mjs && jest --passWithNoTests"
```

- [ ] **Step 3: Agregar `tests.yml` a `.templatesyncignore`**

En `miniapp-template/.templatesyncignore`, agregar bajo el bloque de workflows (después de `.github/workflows/check-compat.yml`):
```
.github/workflows/tests.yml
```

- [ ] **Step 4: Validar YAML + que el `test` script parsea**

Run:
```bash
cd miniapp-template
ruby -ryaml -e "YAML.load_file('.github/workflows/tests.yml'); puts 'YAML OK'"
node -e "require('./package.json').scripts.test.includes('node --test') && console.log('test-script OK')"
grep -q 'tests.yml' .templatesyncignore && echo "ignore OK"
```
Expected: `YAML OK`, `test-script OK`, `ignore OK`.

- [ ] **Step 5: Commit + push directo a main**

```bash
cd miniapp-template
git add .github/workflows/tests.yml package.json .templatesyncignore
git commit -m "ci: run node:test suites on PR; fix test script; exclude tests.yml from sync"
git push origin main
```
Expected: push OK (main no protegido).

---

### Task 3: Verificación e2e + branch protection (required check en ambos)

**Files:** ninguno (operativo con `gh`).

**Interfaces:**
- Consumes: `tests.yml` mergeado (host) y pusheado (template).
- Produces: check `test` verificado verde en ambos; branch protection con `test` required en `backstagereactnative/main` (junto a blast-radius) y en `miniapp-template/main` (nueva).

- [ ] **Step 1: Template — PR trivial para verificar el check + capturar context**

```bash
cd <repos>
R=miniapp-template; BR=ci/verify-tests
MAIN=$(gh api repos/DentVega/$R/git/refs/heads/main --jq '.object.sha')
gh api -X POST repos/DentVega/$R/git/refs -f ref="refs/heads/$BR" -f sha="$MAIN" >/dev/null
RM=$(gh api "repos/DentVega/$R/contents/README.md?ref=$BR" --jq '.sha')
gh api "repos/DentVega/$R/contents/README.md?ref=$BR" --jq '.content' | base64 -d > /tmp/_t.md
printf '\n<!-- verify tests CI -->\n' >> /tmp/_t.md
gh api -X PUT "repos/DentVega/$R/contents/README.md" -f message="chore: verify tests CI" \
  -f content="$(base64 -i /tmp/_t.md)" -f sha="$RM" -f branch="$BR" >/dev/null
PR=$(gh pr create --repo DentVega/$R --head "$BR" --base main --title "chore: verify tests CI (throwaway)" --body "Se cierra al confirmar verde." | tail -1)
gh pr checks "$(echo $PR|grep -oE '[0-9]+$')" --repo DentVega/$R --watch
gh api repos/DentVega/$R/commits/$(gh api repos/DentVega/$R/git/refs/heads/$BR --jq '.object.sha')/check-runs --jq '.check_runs[].name'
```
Expected: check **`test`** en **success**; anotar el context. **Si sale rojo:** PARAR, leer el log, reportar.

- [ ] **Step 2: Template — habilitar branch protection con `test` required**

Escribir el JSON y aplicar:
```bash
cat > /tmp/bp-template.json <<'JSON'
{
  "required_status_checks": { "strict": false, "contexts": ["test"] },
  "enforce_admins": false,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
gh api -X PUT repos/DentVega/miniapp-template/branches/main/protection --input /tmp/bp-template.json \
  --jq '"template: required=[\(.required_status_checks.contexts|join(","))] enforce_admins=\(.enforce_admins.enabled)"'
```
Expected: `template: required=[test] enforce_admins=false`.

- [ ] **Step 3: Template — cerrar el PR throwaway**

```bash
cd <repos>
gh pr close "$(gh pr list --repo DentVega/miniapp-template --head ci/verify-tests --json number --jq '.[0].number')" --repo DentVega/miniapp-template --delete-branch
```
Expected: PR cerrado, branch borrada.

- [ ] **Step 4: Host — agregar `test` al branch protection existente (preservando lo demás)**

Leer la protección actual y re-aplicar con el context sumado:
```bash
cd <repos>
CUR=$(gh api repos/DentVega/backstagereactnative/branches/main/protection)
STRICT=$(echo "$CUR" | python3 -c "import json,sys;print(str(json.load(sys.stdin)['required_status_checks']['strict']).lower())")
ADMINS=$(echo "$CUR" | python3 -c "import json,sys;print(str(json.load(sys.stdin)['enforce_admins']['enabled']).lower())")
echo "actual: strict=$STRICT enforce_admins=$ADMINS contexts=$(echo "$CUR"|python3 -c "import json,sys;print(json.load(sys.stdin)['required_status_checks']['contexts'])")"
cat > /tmp/bp-host.json <<JSON
{
  "required_status_checks": { "strict": $STRICT, "contexts": ["blast-radius", "test"] },
  "enforce_admins": $ADMINS,
  "required_pull_request_reviews": null,
  "restrictions": null
}
JSON
gh api -X PUT repos/DentVega/backstagereactnative/branches/main/protection --input /tmp/bp-host.json \
  --jq '"host: required=[\(.required_status_checks.contexts|join(","))] enforce_admins=\(.enforce_admins.enabled) strict=\(.required_status_checks.strict)"'
```
Expected: `host: required=[blast-radius,test] enforce_admins=true strict=...`.
**Nota:** si el `CUR` mostrara `required_pull_request_reviews` no-null, ajustar el JSON para preservarlo antes del PUT.

- [ ] **Step 5: Confirmar protección en ambos**

```bash
cd <repos>
for R in backstagereactnative miniapp-template; do
  gh api repos/DentVega/$R/branches/main/protection --jq '"'"'\(env.R): required=[\(.required_status_checks.contexts|join(","))]"'"'"' 2>/dev/null || \
  gh api repos/DentVega/$R/branches/main/protection --jq '.required_status_checks.contexts'
done
```
Expected: host → `[blast-radius, test]`; template → `[test]`.

- [ ] **Step 6: (Sin commit)** Reportar el resultado de la verificación.

---

## Correcciones durante la ejecución

El CI hizo su trabajo y destapó 3 cosas (todas resueltas):

1. **Host — conflicto de versión de pnpm:** `pnpm/action-setup` con `version: 10` choca con `packageManager: pnpm@10.14.0` del `package.json` del host. Fix: sacar el `version:` (lee del `packageManager`). Solo aplica al host (el template no tiene `packageManager` → mantiene `version: 10`).
2. **Host — workspace packages sin buildear:** `packages/host-runtime` typecheck fallaba (`Cannot find module '@dentvega/miniapp-contract'`) porque los workspace packages necesitan su `dist/.d.ts`. Fix: agregar `pnpm build:packages` antes del typecheck. El `tests.yml` real del host quedó: install → **build:packages** → typecheck → jest → node:test. (~5m51s, jest RN es lento.)
3. **Template — `compat / compat` rojo en los PRs del propio template:** efecto colateral del feature anterior (el trigger `pull_request` en el `ci.yml` del template corría el gate sobre su manifest **placeholder**). Fix (commit `ced1219`): guardar los jobs `compat` **y** `publish` del `ci.yml` del template con `if: github.repository != 'DentVega/miniapp-template'` — el template no es una miniapp, no corre compat ni se publica a sí mismo. En las miniapps ambos jobs siguen corriendo normal.

Evidencia e2e: host PR #12 (`test` verde 5m51s → mergeado `03f9ffa`); template PR #1 throwaway (`test` verde, `compat`/`publish` skipped tras el guard → cerrado). Branch protection final: host `[blast-radius, test]` (enforce_admins=true), template `[test]` (enforce_admins=false).

## Notas de ejecución

- **No hay TDD clásico:** el entregable es CI (YAML + config) y la lógica ya está testeada por las suites que cablémos. Cada task valida con parse de YAML + el propio PR check como verificación real.
- **Orden importa:** Task 1 (host) entra por PR porque main está protegido; Task 2 (template) por push directo porque aún no lo está; Task 3 protege el template al final (después de verificar que el check corre verde).
- **Fuera de alcance:** #6 (test del merge engine de Capa 2), #15 (Node 24), ESLint como gate.
