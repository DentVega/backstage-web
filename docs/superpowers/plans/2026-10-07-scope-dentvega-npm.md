# Scope `@dentvega` 100% en npm público — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que todo `@dentvega/*` se instale desde npm público sin `GITHUB_TOKEN`: publicar `@dentvega/ui-kit@0.1.1` en npm, migrar `miniapp-template` y las 3 miniapps a `miniapp-contract@^0.4.1` + `ui-kit@^0.1.1` de npm, quitar el token de los workflows y borrar `backstagereactnative/packages/miniapp-contract`.

**Architecture:** `ui-kit` se queda en `backstagereactnative` (el host lo consume por `workspace:*` desde `src`) y se publica a npm con el patrón de `miniapp-contract`: imports relativos con `.js` explícito, `dist` verificado por `check-dist-imports`. Para que el host siga leyendo el `src` con imports `.js`, Rspack usa `resolve.extensionAlias` y jest un `moduleNameMapper`. Los consumidores se migran en orden (template → miniapps → token → host → docs) con un PR revertible por paso.

**Tech Stack:** pnpm 10, TypeScript 5.9 (`moduleResolution: Bundler`), React Native 0.76.6, Re.Pack 5 / Rspack 1.7, Jest 29 (preset `react-native`), GitHub Actions (workflows reutilizables `@main`), npm público (scope `@dentvega`, staged publishing).

**Spec:** `docs/superpowers/specs/2026-10-07-scope-dentvega-npm-design.md`

## Global Constraints

- Registry único: `https://registry.npmjs.org`. Al terminar, ningún `.npmrc` ni workflow de los repos tocados referencia `npm.pkg.github.com`.
- Versiones: `@dentvega/miniapp-contract` `^0.4.1`; `@dentvega/ui-kit` **0.1.1** (publicado) y `^0.1.1` en los consumidores.
- El singleton de Module Federation sigue en `requiredVersion: '^0.1.0'` (host y miniapps): **no se toca**.
- `ui-kit`: licencia **MIT**, `publishConfig.access: "public"`, sin `publishConfig.registry`. React y React Native siguen como `peerDependencies`.
- **Todo import relativo de `ui-kit/src` lleva `.js` explícito.** Se verifica con `check-dist-imports` sobre el `dist`.
- Publicar a npm lo hace **el usuario desde su terminal** (2FA). El primer publish de un paquete nuevo queda *staged*: npm crea un placeholder `0.0.0-stage` y la versión real se aprueba en npmjs.com → pestaña **Staged Packages** → **Approve**. Un token vencido da **E404** en el PUT → `npm login` primero.
- `package.json` y `README*.md` están en `.templatesyncignore`: se migran con PR directo en cada miniapp. `.npmrc` y `pnpm-lock.yaml` sí se sincronizan.
- El paso de token en los workflows del template se quita **recién en la Task 5**, con las 3 miniapps ya migradas.
- GitHub Packages **no se borra** (rollback).
- Branches nuevas en cada repo; commits con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; PRs terminan con `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.

## Review Focus

1. **El host bundlea `ui-kit` desde `src` con imports `.js`** → sin `resolve.extensionAlias` Rspack no encuentra `./theme/light.js` (solo existe `.ts`). Cubierto en Task 1 Step 8 (`bundle:android`).
2. **Jest del host y de `ui-kit` resuelven `.js` → `.ts`** → sin `moduleNameMapper`, `Cannot find module './theme/light.js'`. Cubierto en Task 1 Step 7 (suites completas).
3. **Una miniapp con `ui-kit@0.1.1` instalado monta contra el host que comparte su `ui-kit`** como singleton `^0.1.0` → debe montar sin warning de versión. Cubierto en Task 8 (publish + emulador).
4. **Instalar sin token desde cero** (scaffold nuevo o clone limpio) → debe funcionar. Cubierto en Task 3 Step 4 y Task 4 Step 4 (`env -u GITHUB_TOKEN pnpm install` + grep del lockfile).
5. **El próximo template-sync** no debe conflictuar con el `.npmrc` migrado → el `.npmrc` de cada miniapp queda byte-idéntico al del template. Cubierto en Task 4 Step 3 (`cmp`).

## Hechos del código actual que el plan asume

- `backstagereactnative/packages/ui-kit/package.json`: v0.1.0, `license: UNLICENSED`, `main: src/index.ts`, `publishConfig` con `registry: https://npm.pkg.github.com`, `access: restricted`, y `main/types/exports` a `dist` (patrón doble consumo, ADR-010). Sin `type`, sin `repository`, sin `LICENSE`.
- `ui-kit/src` tiene 28 imports relativos sin extensión, en: `index.ts`, `primitives/{AppText,Box,Button,Card}.tsx`, `theme/{dark,light,resolveTheme}.ts`, `theme/ThemeProvider.tsx`.
- Probado (spike descartado): `rewriteRelativeImportExtensions` reescribe los `.js` del `dist` pero **no** los `.d.ts` → descartado. Se usa `.js` en el `src`.
- `apps/host/rspack.config.mjs:70-75`: `resolve: { ...Repack.getResolveOptions(), alias: {...devMiniappAliases} }`, sin `extensionAlias`.
- `apps/host/jest.config.js`: preset `react-native`, sin `moduleNameMapper`.
- `repack-miniapps/scripts/check-dist-imports.mjs` es el check de `dist` a copiar. `repack-miniapps/LICENSE` es el MIT a copiar.
- Template y las 3 miniapps: `.npmrc` = `@dentvega:registry=https://npm.pkg.github.com` + `//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}`. `package.json`: `"@dentvega/miniapp-contract": "^0.1.0"`, `"@dentvega/ui-kit": "^0.1.0"` (template/hellow/cards en líneas 14-15; account-dashboard 17-18). Las miniapps solo importan **tipos** del contrato.
- Los workflows reutilizables del template (`publish.yml:37-45`, `check-compat.yml:29-37`, `tests.yml:18-23`) escriben el token a `~/.npmrc` antes de `pnpm install --frozen-lockfile=false`. `tests.yml` corre en los PRs del propio template.
- `miniapp-template/scripts/bootstrap-lib.mjs` procesa `.npmrc` al renombrar el scope (`bootstrap.test.mjs:45` lo asserta). Por eso `.npmrc` **se conserva** (solo con comentarios), no se borra.
- `scripts/publish.mjs` del template auto-incrementa el patch (el registry es inmutable): disparar `ci.yml` por `workflow_dispatch` publica una versión nueva.
- `backstagereactnative/.npmrc:1-5`: comentario + `//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}`. `.github/workflows/host-compat.yml:43-45`: step "Build contract package". Nadie del workspace consume `packages/miniapp-contract`.
- `backstage-web/.github/workflows/ci.yml:24-30`: step "Install deps (GitHub Packages)" con el token sobrante.

## Mapa de archivos

| Repo | Archivo | Task |
|---|---|---|
| backstagereactnative | `packages/ui-kit/src/**` (9 archivos), `packages/ui-kit/package.json`, `packages/ui-kit/jest.config.cjs`, `packages/ui-kit/LICENSE`, `packages/ui-kit/README.md` | 1 |
| backstagereactnative | `scripts/check-dist-imports.mjs`, `.github/workflows/tests.yml`, `apps/host/rspack.config.mjs`, `apps/host/jest.config.js` | 1 |
| miniapp-template | `.npmrc`, `package.json`, `pnpm-lock.yaml`, `README.md`, `README.es.md` | 3 |
| miniapp-{hellow_widget,cards_wallet,account-dashboard} | `.npmrc`, `package.json`, `pnpm-lock.yaml`, `README*.md` | 4 |
| miniapp-template | `.github/workflows/{publish,check-compat,tests}.yml` | 5 |
| backstage-web | `.github/workflows/ci.yml` | 5 |
| backstagereactnative | `packages/miniapp-contract/` (borrar), `.npmrc`, `.github/workflows/host-compat.yml`, `packages/PUBLISHING.md`, `README.md`, `README.es.md`, `apps/host/README.md` | 6 |
| backstage-web | `.claude/docs-map.json`, `docs/SETUP.md`, `docs/HOST-CONTRACT.md`, `docs/GLOSARIO.md` | 7 |

---

### Task 1: `ui-kit` listo para npm (sin publicar)

**Files (en `backstagereactnative`, rama `feat/ui-kit-npm`):**
- Create: `scripts/check-dist-imports.mjs`, `packages/ui-kit/LICENSE`, `packages/ui-kit/README.md`
- Modify: `packages/ui-kit/src/index.ts`, `packages/ui-kit/src/primitives/{AppText,Box,Button,Card}.tsx`, `packages/ui-kit/src/theme/{dark,light,resolveTheme}.ts`, `packages/ui-kit/src/theme/ThemeProvider.tsx`
- Modify: `packages/ui-kit/package.json`, `packages/ui-kit/jest.config.cjs`, `apps/host/rspack.config.mjs:70-75`, `apps/host/jest.config.js`, `.github/workflows/tests.yml`

**Interfaces:**
- Produces: tarball `@dentvega/ui-kit@0.1.1` (exports `.` → `dist/index.js` / `dist/index.d.ts`), script `pnpm --filter @dentvega/ui-kit check:dist`.

- [ ] **Step 1: Rama + check de `dist`**

```bash
cd /Volumes/SSDExterno/prodproyects/backstagereactnative
git switch main && git pull --ff-only && git switch -c feat/ui-kit-npm
cp ../repack-miniapps/scripts/check-dist-imports.mjs scripts/check-dist-imports.mjs
```

En `packages/ui-kit/package.json`, `scripts`, agregar:

```json
    "check:dist": "node ../../scripts/check-dist-imports.mjs dist",
```

- [ ] **Step 2: Correr el check y verlo fallar**

```bash
pnpm --filter @dentvega/ui-kit build && pnpm --filter @dentvega/ui-kit check:dist
```

Expected: FAIL (exit 1), una línea por import, p. ej. `dist/index.js: "./theme/light" sin extensión .js` (los 28 imports, en `.js` y `.d.ts`).

- [ ] **Step 3: `.js` explícito en todos los imports relativos**

```bash
cd packages/ui-kit
sed -E -i '' "s#(from ['\"])(\.{1,2}/[^'\"]+)(['\"])#\1\2.js\3#g" \
  src/index.ts src/primitives/AppText.tsx src/primitives/Box.tsx src/primitives/Button.tsx \
  src/primitives/Card.tsx src/theme/dark.ts src/theme/light.ts src/theme/resolveTheme.ts \
  src/theme/ThemeProvider.tsx
grep -rnE "from ['\"]\.\.?/" src | grep -v __tests__ | grep -vE "\.js['\"]"
cd ../..
```

Expected: el último `grep` no imprime nada. Ejemplos del resultado: `export { lightTheme } from "./theme/light.js";`, `import { AppText } from "./AppText.js";`. (Los tests en `src/__tests__` no se tocan.)

- [ ] **Step 4: Jest de `ui-kit` resuelve `.js` → `.ts`**

`packages/ui-kit/jest.config.cjs`, agregar dentro de `module.exports`, después de `testMatch`:

```js
  // Los imports relativos llevan `.js` (ESM publicable); en jest apuntan al `.ts`/`.tsx`.
  moduleNameMapper: {
    "^(\\.{1,2}/.*)\\.js$": "$1",
  },
```

- [ ] **Step 5: El host resuelve `.js` → `.ts` (Rspack + jest)**

`apps/host/rspack.config.mjs`, en `resolve` (línea ~70):

```js
  resolve: {
    ...Repack.getResolveOptions(),
    // ui-kit (workspace, se consume desde `src`) usa imports `.js` para que su dist sea ESM
    // válido; acá apuntan al `.ts`/`.tsx` real.
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js'],
    },
    alias: {
      ...devMiniappAliases,
    },
```

`apps/host/jest.config.js`, agregar después de `transformIgnorePatterns`:

```js
  // ui-kit (workspace) importa con `.js` explícito; en jest apunta al `.ts`/`.tsx`.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
```

- [ ] **Step 6: Empaquetado de `ui-kit`**

`packages/ui-kit/package.json` — reemplazar el bloque desde `"version"` hasta el cierre de `publishConfig` por:

```json
  "version": "0.1.1",
  "description": "Themed React Native primitives and design tokens used by the miniapp host and its miniapps (shared as a Module Federation singleton).",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/DentVega/backstagereactnative.git",
    "directory": "packages/ui-kit"
  },
  "homepage": "https://github.com/DentVega/backstagereactnative/tree/main/packages/ui-kit#readme",
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "files": ["dist"],
  "publishConfig": {
    "access": "public",
    "main": "./dist/index.js",
    "types": "./dist/index.d.ts",
    "exports": {
      ".": {
        "types": "./dist/index.d.ts",
        "default": "./dist/index.js"
      }
    }
  },
```

```bash
cp ../repack-miniapps/LICENSE packages/ui-kit/LICENSE
```

`packages/ui-kit/README.md`:

```markdown
# @dentvega/ui-kit

Themed React Native primitives (`AppText`, `Box`, `Button`, `Card`) and design tokens
(`ThemeProvider`, `useTheme`, light/dark themes) for the miniapp host
[`backstagereactnative`](https://github.com/DentVega/backstagereactnative) and its miniapps.

The host bundles it and shares it as a **Module Federation singleton**: miniapps declare it as a
dependency for types and local dev, and at runtime they get the host's copy.

```bash
pnpm add @dentvega/ui-kit
```

`react` and `react-native` are peer dependencies. ESM only. MIT.
```

- [ ] **Step 7: Suites verdes (host + ui-kit)**

```bash
pnpm install
pnpm build:packages
pnpm -r --if-present typecheck
pnpm -r --if-present test
node --test apps/host/scripts/__tests__/*.test.mjs scripts/*.test.mjs
pnpm --filter @dentvega/ui-kit check:dist
```

Expected: todo verde; `check:dist` imprime `ok: dist`. Si jest falla con `Cannot find module './theme/light.js'`, falta el `moduleNameMapper` del Step 4 o 5.

- [ ] **Step 8: El host bundlea con `ui-kit` desde `src`**

```bash
pnpm --filter @app/host bundle:android
```

Expected: `compiled with 1 warning` (el warning preexistente de `@react-native-masked-view/masked-view`; `main` da el mismo). Ningún `Module not found` de `ui-kit`.

- [ ] **Step 9: Tarball instalado en un proyecto limpio**

```bash
S=$(mktemp -d)
pnpm --filter @dentvega/ui-kit pack --pack-destination "$S"
tar -tzf "$S"/dentvega-ui-kit-0.1.1.tgz | sort
tar -xzOf "$S"/dentvega-ui-kit-0.1.1.tgz package/package.json | grep -E '"(main|types|license|version)"'
(cd "$S" && npm init -y >/dev/null && npm install ./dentvega-ui-kit-0.1.1.tgz --no-save --legacy-peer-deps)
node scripts/check-dist-imports.mjs "$S"/node_modules/@dentvega/ui-kit/dist
```

Expected: el tarball contiene `package/LICENSE`, `package/README.md`, `package/package.json` y solo `package/dist/**` (sin `src`, sin tests); `main` = `./dist/index.js`, `license` = `MIT`, `version` = `0.1.1`; el check sobre el paquete instalado imprime `ok:`.

- [ ] **Step 10: CI corre el check de `dist`**

`.github/workflows/tests.yml`, después del step `Build packages`:

```yaml
      - name: Check ui-kit dist (ESM imports con extensión)
        run: pnpm --filter @dentvega/ui-kit check:dist
```

- [ ] **Step 11: Commit + PR**

```bash
git add scripts/check-dist-imports.mjs packages/ui-kit apps/host/rspack.config.mjs apps/host/jest.config.js .github/workflows/tests.yml pnpm-lock.yaml
git commit -m "feat(ui-kit): publicable en npm público (ESM con .js, MIT, 0.1.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin feat/ui-kit-npm
gh pr create --title "feat(ui-kit): publicable en npm público (0.1.1)" --body "<qué cambia + verificación de los Steps 7-9>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: CI (`tests.yml`, `host-compat.yml`) verde. Mergear con el OK del usuario.

---

### Task 2: Publicar `@dentvega/ui-kit@0.1.1` (lo ejecuta el usuario)

- [ ] **Step 1: El usuario publica** (2FA; si `npm whoami` da 401, `npm login` primero)

```bash
cd /Volumes/SSDExterno/prodproyects/backstagereactnative && git switch main && git pull
pnpm --filter @dentvega/ui-kit publish --no-git-checks
```

- [ ] **Step 2: El usuario aprueba el stage** en https://www.npmjs.com/package/@dentvega/ui-kit → pestaña **Staged Packages** → versión 0.1.1 → **Approve** (2FA).

- [ ] **Step 3: Verificar**

```bash
npm view @dentvega/ui-kit dist-tags version license peerDependencies --prefer-online
```

Expected: `latest: '0.1.1'`, `version = '0.1.1'`, `license = 'MIT'`, peers `react: '*'`, `react-native: '*'`. Si `latest` es `0.0.0-stage`, el stage no está aprobado.

---

### Task 3: `miniapp-template` consume npm público

**Files (en `miniapp-template`, rama `chore/npm-public-scope`):**
- Modify: `.npmrc`, `package.json:14-15`, `pnpm-lock.yaml`, `README.md:57`, `README.es.md:57`

**Interfaces:**
- Consumes: `@dentvega/ui-kit@0.1.1` (Task 2), `@dentvega/miniapp-contract@0.4.1` (npm).
- Produces: el `.npmrc` canónico que la Task 4 copia byte a byte.

- [ ] **Step 1: Rama + `.npmrc`**

```bash
cd /Volumes/SSDExterno/prodproyects/miniapp-template
git switch main && git pull --ff-only && git switch -c chore/npm-public-scope
```

Reemplazar todo `.npmrc` por:

```
# @dentvega/* (miniapp-contract, ui-kit) se instala desde npm público: no hace falta
# configurar registry ni token. Este archivo se mantiene para que bootstrap y
# template-sync lo sigan tratando como parte del template.
```

- [ ] **Step 2: Dependencias**

En `package.json`:

```json
    "@dentvega/miniapp-contract": "^0.4.1",
    "@dentvega/ui-kit": "^0.1.1",
```

- [ ] **Step 3: Lockfile desde npm, sin token**

```bash
rm -rf node_modules
env -u GITHUB_TOKEN -u NODE_AUTH_TOKEN pnpm install
grep -c "npm.pkg.github.com" pnpm-lock.yaml
grep -A2 "'@dentvega/miniapp-contract@\|'@dentvega/ui-kit@\|^  '@dentvega" pnpm-lock.yaml | head -12
```

Expected: el `grep -c` imprime `0`; el lock resuelve `@dentvega/miniapp-contract@0.4.1` y `@dentvega/ui-kit@0.1.1`.

- [ ] **Step 4: Verificar el template**

```bash
pnpm exec tsc --noEmit
pnpm test
node --test scripts/*.test.mjs scripts/__tests__/*.test.mjs
pnpm bundle:android
```

Expected: typecheck sin errores (`MiniappEntryProps` sigue existiendo en 0.4.1); tests verdes (incluye `bootstrap.test.mjs`, que sigue procesando `.npmrc`); el bundle compila.

- [ ] **Step 5: READMEs**

`README.md:57`, reemplazar la línea por:

```markdown
Node 20+, pnpm or npm. `@dentvega/miniapp-contract` and `@dentvega/ui-kit` install from the **public npm registry** — no token or registry config needed.
```

`README.es.md:57`:

```markdown
Node 20+, pnpm o npm. `@dentvega/miniapp-contract` y `@dentvega/ui-kit` se instalan desde **npm público** — sin token ni configuración de registry.
```

- [ ] **Step 6: Commit + PR**

```bash
git add .npmrc package.json pnpm-lock.yaml README.md README.es.md
git commit -m "chore: @dentvega/* desde npm público (contract ^0.4.1, ui-kit ^0.1.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin chore/npm-public-scope
gh pr create --title "chore: @dentvega/* desde npm público" --body "<qué cambia + Steps 3-4>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: `tests.yml` del PR verde (todavía escribe el token: inocuo). Mergear con el OK del usuario.

---

### Task 4: Las 3 miniapps consumen npm público

Se repite **por repo**, en este orden: `miniapp-hellow_widget`, `miniapp-cards_wallet`, `miniapp-account-dashboard`. Un PR por repo, rama `chore/npm-public-scope`.

**Files (por repo):** `.npmrc`, `package.json` (hellow/cards: líneas 14-15; account-dashboard: 17-18), `pnpm-lock.yaml`, `README.md`, `README.es.md`

**Interfaces:**
- Consumes: `.npmrc` canónico del template (Task 3), `@dentvega/ui-kit@0.1.1`, `@dentvega/miniapp-contract@0.4.1`.

- [ ] **Step 1: Rama**

```bash
R=miniapp-hellow_widget   # luego miniapp-cards_wallet, miniapp-account-dashboard
cd /Volumes/SSDExterno/prodproyects/$R
git switch main && git pull --ff-only && git switch -c chore/npm-public-scope
```

- [ ] **Step 2: Dependencias**

En `package.json`:

```json
    "@dentvega/miniapp-contract": "^0.4.1",
    "@dentvega/ui-kit": "^0.1.1",
```

- [ ] **Step 3: `.npmrc` idéntico al del template**

```bash
cp ../miniapp-template/.npmrc .npmrc
cmp .npmrc ../miniapp-template/.npmrc && echo identico
```

Expected: `identico` (así el próximo template-sync no conflictúa).

- [ ] **Step 4: Lockfile sin token + verificación**

```bash
rm -rf node_modules
env -u GITHUB_TOKEN -u NODE_AUTH_TOKEN pnpm install
grep -c "npm.pkg.github.com" pnpm-lock.yaml
pnpm exec tsc --noEmit
pnpm test
pnpm bundle:android
```

Expected: `0`; typecheck verde (account-dashboard además importa `Capability`/`CapabilityGrant` en `src/__tests__/Entry.test.tsx`, sin cambios en 0.4.1); tests verdes; bundle compila.

- [ ] **Step 5: READMEs**

Si existe la línea de requisitos (`grep -n "GitHub Packages" README.md README.es.md`; en hellow/cards es la `:54`), reemplazarla por el mismo texto del Task 3 Step 5 (EN en `README.md`, ES en `README.es.md`). account-dashboard no tiene esa línea: no se toca.

- [ ] **Step 6: Commit + PR**

```bash
git add .npmrc package.json pnpm-lock.yaml README.md README.es.md
git commit -m "chore: @dentvega/* desde npm público (contract ^0.4.1, ui-kit ^0.1.1)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin chore/npm-public-scope
gh pr create --title "chore: @dentvega/* desde npm público" --body "<qué cambia + Step 4>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch
```

Expected: `check-compat` verde (instala con el `.npmrc` nuevo). Al mergear, `ci.yml` corre `publish.yml` en `main` y publica un patch nuevo: verificar que el run termine verde (`gh run list -L 1`).

---

### Task 5: Quitar el token de los workflows

**Files:**
- Modify (en `miniapp-template`, rama `chore/drop-gh-packages-token`): `.github/workflows/publish.yml:37-45`, `.github/workflows/check-compat.yml:29-37`, `.github/workflows/tests.yml:18-23`
- Modify (en `backstage-web`, rama `chore/drop-gh-packages-token`): `.github/workflows/ci.yml:24-30`

Precondición: los 3 PRs de la Task 4 mergeados.

- [ ] **Step 1: Template — reemplazar el step de install en los 3 workflows**

En `publish.yml`, `check-compat.yml` y `tests.yml`, el step `Install deps (GitHub Packages)` completo (nombre, comentarios, `run` con el `echo ... _authToken` y el `env: NODE_AUTH_TOKEN`) pasa a:

```yaml
      - name: Install deps
        run: pnpm install --frozen-lockfile=false
```

```bash
cd /Volumes/SSDExterno/prodproyects/miniapp-template
git switch main && git pull --ff-only && git switch -c chore/drop-gh-packages-token
grep -rn "npm.pkg.github.com\|NODE_AUTH_TOKEN" .github/
```

Expected: el `grep` no imprime nada.

- [ ] **Step 2: Commit + PR del template**

```bash
git add .github/workflows
git commit -m "ci: install sin token de GitHub Packages (@dentvega/* en npm público)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin chore/drop-gh-packages-token
gh pr create --title "ci: install sin token de GitHub Packages" --body "<...>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch
```

Expected: `tests.yml` del PR (usa el archivo de la rama) verde sin token. Mergear con el OK del usuario.

- [ ] **Step 3: backstage-web — mismo cambio en `ci.yml`**

`.github/workflows/ci.yml:24-30` → `- name: Install deps` / `run: pnpm install --frozen-lockfile=false`.

```bash
cd /Volumes/SSDExterno/prodproyects/backstage-web
git switch main && git pull --ff-only && git switch -c chore/drop-gh-packages-token
grep -rn "npm.pkg.github.com\|NODE_AUTH_TOKEN" .github/
git add .github/workflows/ci.yml
git commit -m "ci: install sin token de GitHub Packages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin chore/drop-gh-packages-token
gh pr create --title "ci: install sin token de GitHub Packages" --body "<...>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch
```

Expected: `grep` vacío; `test` + preview de Vercel verdes.

---

### Task 6: Host — borrar `packages/miniapp-contract` y el rastro de GitHub Packages

**Files (en `backstagereactnative`, rama `chore/drop-local-contract`):**
- Delete: `packages/miniapp-contract/`
- Modify: `.npmrc:1-5`, `.github/workflows/host-compat.yml:43-45`, `packages/PUBLISHING.md`, `README.md:19,32,43`, `README.es.md:19,32,43`, `apps/host/README.md:23`

- [ ] **Step 1: Borrar el paquete + lockfile**

```bash
cd /Volumes/SSDExterno/prodproyects/backstagereactnative
git switch main && git pull --ff-only && git switch -c chore/drop-local-contract
git rm -rq packages/miniapp-contract && rm -rf packages/miniapp-contract
env -u GITHUB_TOKEN pnpm install --lockfile-only
env -u GITHUB_TOKEN pnpm install --frozen-lockfile
grep -c "packages/miniapp-contract" pnpm-lock.yaml
```

Expected: `0` (si no, el importer viejo sigue: `--lockfile-only` lo poda).

- [ ] **Step 2: `.npmrc`** — reemplazar las líneas 1-5 por:

```
# Todo @dentvega/* (miniapp-contract, miniapp-runtime, ui-kit) vive en npm público:
# instalar no necesita token. ui-kit se publica desde packages/ui-kit (ver packages/PUBLISHING.md).
```

- [ ] **Step 3: `host-compat.yml`** — borrar el step completo:

```yaml
      - name: Build contract package
        if: steps.changes.outputs.hostdeps == 'true'
        run: pnpm --filter @dentvega/miniapp-contract build # dist para el import del script
```

- [ ] **Step 4: `packages/PUBLISHING.md`** — reemplazar todo por:

````markdown
# Publicar `@dentvega/ui-kit`

`ui-kit` es el único paquete publicado desde este repo. Va a **npm público** (MIT). El resto del
scope vive en [`repack-miniapps`](https://github.com/DentVega/repack-miniapps):
`@dentvega/miniapp-contract`, `@dentvega/miniapp-runtime`, `@dentvega/miniapp-storage`.

**Doble consumo (ADR-010):** en el monorepo el host lo consume como **fuente** (`main: src`); al
publicar, `publishConfig` lo cambia a **`dist`**. Los imports relativos llevan `.js` explícito
(ESM válido); el host los resuelve al `.ts` con `resolve.extensionAlias` (Rspack) y
`moduleNameMapper` (jest).

## Publicar

```bash
pnpm --filter @dentvega/ui-kit build
pnpm --filter @dentvega/ui-kit check:dist      # todo import relativo del dist con .js
pnpm --filter @dentvega/ui-kit pack            # revisar: solo dist/, LICENSE, README
npm whoami                                     # si da 401: npm login
pnpm --filter @dentvega/ui-kit publish --no-git-checks
```

La cuenta tiene 2FA: publica una persona desde su terminal. Si npm deja la versión *staged*,
aprobarla en npmjs.com → paquete → **Staged Packages** → **Approve**.

## Consumir (miniapps)

```json
{ "dependencies": { "@dentvega/miniapp-contract": "^0.4.1", "@dentvega/ui-kit": "^0.1.1" } }
```

Sin `.npmrc` especial. `react` y `react-native` son peers: los provee la app. En runtime la miniapp
usa el `ui-kit` del host (singleton de Module Federation, `requiredVersion: '^0.1.0'`).

## Versionado

Semver. Un cambio incompatible de `ui-kit` es una release del host: el host es quien lo comparte.
````

- [ ] **Step 5: READMEs**

`README.md` y `README.es.md`:
- `:19` (diagrama): `RT --> C[miniapp-contract]` → `RT --> C[miniapp-contract<br/>npm]`
- `:32` (layout): borrar la línea `  miniapp-contract/ ...`
- `:43`: `` `@org/miniapp-contract` `` → `` `@dentvega/miniapp-contract` (npm) ``

`apps/host/README.md:23`:

```bash
pnpm build:packages    # compila ui-kit (dist); contract y runtime vienen de npm
```

- [ ] **Step 6: Verificación completa**

```bash
pnpm build:packages
pnpm -r --if-present typecheck
pnpm -r --if-present test
node --test apps/host/scripts/__tests__/*.test.mjs scripts/*.test.mjs
pnpm --filter @app/host bundle:android
grep -rn "packages/miniapp-contract\|npm.pkg.github.com" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=memory-bank --exclude-dir=superpowers --exclude-dir=build --exclude-dir=android --exclude-dir=ios . | grep -v pnpm-lock
```

Expected: todo verde; el `grep` final no imprime nada.

- [ ] **Step 7: Commit + PR**

```bash
git add -A
git commit -m "chore(host): borrar packages/miniapp-contract y el rastro de GitHub Packages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin chore/drop-local-contract
gh pr create --title "chore(host): borrar packages/miniapp-contract" --body "<...>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
gh pr checks --watch
```

Expected: `tests.yml` + `host-compat.yml` verdes.

---

### Task 7: Docs de `backstage-web`

**Files (en `backstage-web`, rama `docs/npm-public-scope`):**
- Modify: `.claude/docs-map.json:9,15`, `docs/SETUP.md` (`:14`, `:146-158`, `:366`, `:736`, `:756-758`), `docs/HOST-CONTRACT.md:150,220`, `docs/GLOSARIO.md:161`

- [ ] **Step 1: `docs-map.json`** — en las reglas de las líneas 9 y 15:
`../backstagereactnative/packages/miniapp-contract/src/shared.ts` → `../repack-miniapps/packages/miniapp-contract/src/shared.ts`, y lo mismo con `types.ts`.

- [ ] **Step 2: Docs con el skill del proyecto `docs-sync`**, con este alcance:
  - `HOST-CONTRACT.md:150,220` y `GLOSARIO.md:161`: las rutas `packages/miniapp-contract/src/{types,shared}.ts` pasan a `repack-miniapps/packages/miniapp-contract/src/...` (paquete npm `@dentvega/miniapp-contract`).
  - `SETUP.md:14`: `PUBLISHING.md` ahora documenta publicar `ui-kit` a npm.
  - `SETUP.md:146-158`: borrar el bloque "públicos en GitHub Packages" + `.npmrc` con scope; en su lugar: los paquetes `@dentvega/*` están en npm público y no requieren `.npmrc`.
  - `SETUP.md:366`: `pnpm build:packages   # build de ui-kit (contract y runtime vienen de npm)`.
  - `SETUP.md:736`: la fila `GITHUB_TOKEN` (publicar a GitHub Packages) se borra.
  - `SETUP.md:756-758`: el `GITHUB_TOKEN` de Vercel ya no necesita `read:packages` (backstage-web no instala nada de GitHub Packages) y se borra la fila "Scope de paquetes debe ser público".
  Leer el código real antes de cada cambio (regla del skill).

- [ ] **Step 3: Verificar + commit + PR**

```bash
grep -rn "npm.pkg.github.com\|read:packages\|packages/miniapp-contract" docs/*.md
pnpm build
git add .claude/docs-map.json docs/*.md
git commit -m "docs: @dentvega/* 100% en npm público (sin GitHub Packages)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u origin docs/npm-public-scope
gh pr create --title "docs: @dentvega/* en npm público" --body "<...>

🤖 Generated with [Claude Code](https://claude.com/claude-code)"
```

Expected: el `grep` no imprime nada (salvo `repack-miniapps/packages/miniapp-contract`, que es correcto); build verde; CI verde.

---

### Task 8: Verificación end-to-end (criterio de aceptación)

- [ ] **Step 1: Publish sin token** — con la Task 5 mergeada:

```bash
gh workflow run ci.yml -R DentVega/miniapp-hellow_widget --ref main
sleep 10; gh run watch -R DentVega/miniapp-hellow_widget $(gh run list -R DentVega/miniapp-hellow_widget -w ci.yml -L 1 --json databaseId -q '.[0].databaseId')
curl -s https://backstage-web-blond.vercel.app/api/miniapps | python3 -c 'import json,sys;[print(m["id"],m.get("latest") or m.get("version")) for m in json.load(sys.stdin)]'
```

Expected: el run verde, sin step de token; `hellow_widget` con un patch nuevo en el catálogo.

- [ ] **Step 2: Montar en el emulador (lo hace el usuario)**

```bash
export BACKSTAGE_URL=https://backstage-web-blond.vercel.app
cd /Volumes/SSDExterno/prodproyects/backstagereactnative/apps/host && pnpm start
# otra terminal: pnpm --filter @app/host android
```

Checklist: el Home lista las 3 miniapps; las 3 montan (incluida la versión nueva de `hellow_widget`, compilada contra `ui-kit@0.1.1` + `miniapp-contract@0.4.1`).

- [ ] **Step 3: Barrido final**

```bash
cd /Volumes/SSDExterno/prodproyects
for r in miniapp-template miniapp-hellow_widget miniapp-cards_wallet miniapp-account-dashboard backstagereactnative backstage-web; do
  (cd $r && git switch -q main && git pull -q --ff-only && echo "== $r" && \
   grep -rln "npm.pkg.github.com" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=memory-bank --exclude-dir=superpowers . | grep -v pnpm-lock)
done
```

Expected: solo los encabezados `== <repo>`, ningún archivo listado.

---

## Fuera de alcance

- Borrar los paquetes de GitHub Packages (manual, después).
- El `publish.yml` local sin uso de `miniapp-cards_wallet` (huérfano: `ci.yml` no lo llama). Sigue escribiendo el token, inocuo con el `.npmrc` nuevo. Se anota, no se toca.
- Subir `requiredVersion` del singleton `ui-kit`.
- Mover `ui-kit` a `repack-miniapps`.
