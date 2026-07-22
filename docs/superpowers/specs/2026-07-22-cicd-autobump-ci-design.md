# CI/CD hardening — auto-bump de versión (#4) + CI en backstage-web (#5)

**Fecha:** 2026-07-22
**Estado:** Diseño aprobado — listo para plan de implementación
**Owner:** DentVega

Dos mejoras independientes de CI/CD, agrupadas en un spec por ser el mismo tema
(endurecer el pipeline). Cada una es un deliverable separado.

---

## 1. Contexto y objetivos

**#4 — Auto-bump.** Hoy `scripts/publish.mjs` publica la versión estática de
`manifest.json`. El registry es **inmutable** (`publishVersion` lanza
`VersionExistsError` → 409 al repetir una versión). Consecuencia: re-deployar la
misma versión falla, y el **botón Deploy** de Backstage (que dispara el CI sobre
la versión actual) es inservible para re-deploys. Objetivo: cada publish
**auto-incrementa** la versión sin colisión, sin intervención manual.

**#5 — CI propio en backstage-web.** Hoy `backstage-web` no tiene
`.github/workflows`. Los 135 tests + `tsc` solo corren en local, así que una
regresión llega a `main` → Vercel sin que nada la detenga. Objetivo: un workflow
que corra `tsc --noEmit` + `vitest run` en cada PR y push a `main`.

---

## 2. #4 — Auto-bump de versión

### 2.1 Decisión: efímero desde el registry

La versión a publicar se calcula **en tiempo de publish, leyendo el registry** —
sin commitear nada de vuelta al repo (evita el loop de CI que causaría un
`git push` del bump). `manifest.json` queda como *piso*: un bump intencional de
minor/major ahí se respeta; si no, se auto-incrementa el patch.

### 2.2 Ubicación

Toda la lógica vive en `scripts/publish.mjs` (ya lee `manifest.json`,
`BACKSTAGE_URL`, `PUBLISH_TOKEN`). Nada cambia en el workflow reutilizable
`publish.yml`. Propagación:
- **Scaffolds nuevos:** heredan el `publish.mjs` actualizado del template.
- **Miniapps existentes** (hello_widget, cards_wallet, account-dashboard):
  `publish.mjs` es template-owned (no está en `.templatesyncignore`) → llega vía
  un **Capa 2 sync PR** (o backfill manual).

### 2.3 Algoritmo

Funciones puras en un módulo nuevo **`scripts/version.mjs`** (importable y
testeable sin ejecutar el flujo de publish; sin dependencias — las versiones en
uso son `x.y.z` simples, sin pre-release):

```js
// scripts/version.mjs
// "0.1.2" -> [0,1,2]
export function parseVer(v) { return String(v).split(".").map(Number); }

// -1 | 0 | 1
export function cmpVer(a, b) {
  const pa = parseVer(a), pb = parseVer(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// "0.1.2" -> "0.1.3"
export function bumpPatch(v) {
  const [maj, min, pat] = parseVer(v);
  return `${maj}.${min}.${(pat ?? 0) + 1}`;
}

// latest: string | null (registry), want: string (manifest.version)
export function nextVersion(latest, want) {
  if (latest == null) return want;            // primer publish
  if (cmpVer(want, latest) > 0) return want;  // dev subió minor/major a propósito
  return bumpPatch(latest);                    // auto-incremento
}
```

### 2.4 Flujo en `publish.mjs`

1. Leer `manifest.json` (`id`, `version`) como hoy.
2. `GET {BACKSTAGE_URL}/api/miniapps` → localizar `{ id }` → `latestVersion`
   (`null` si no existe o sin versiones).
3. `version = nextVersion(latestVersion, manifest.version)`.
4. Publicar con esa `version` (el multipart ya envía
   `manifest: {...manifest, version}` — satisface el check
   `manifest.version === version` de `publishVersion`).
5. Log claro: `published <id>@<version> (was latest <latestVersion>)`.

### 2.5 Manejo de errores

- **GET al registry falla** (red / 5xx): `console.warn` + fallback a
  `manifest.version`. Si eso choca, el 409 posterior surge el problema real (no
  se oculta). No abortar por el fetch en sí.
- **`latestVersion` con formato inesperado:** `parseVer` produce `NaN` →
  tratado defensivamente; en la práctica el registry solo guarda semver válido.

### 2.6 Efectos

- **Adiós 409:** cada publish/dispatch produce una versión inédita.
- **Botón Deploy usable:** re-deploy siempre publica una versión nueva y montable.
- El host sigue resolviendo la **última** → el re-deploy queda live.

---

## 3. #5 — CI en backstage-web

Nuevo `backstage-web/.github/workflows/ci.yml`:

```yaml
name: CI
on:
  pull_request:
  push:
    branches: [main]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with: { version: 10 }
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm
      - name: Install deps (GitHub Packages)
        run: |
          echo "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" >> ~/.npmrc
          pnpm install --frozen-lockfile=false
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
      - name: Typecheck
        run: pnpm exec tsc --noEmit
      - name: Test
        run: pnpm exec vitest run
```

- Node 24 (mata los warnings de deprecación de Node 20).
- Install autentica `@dentvega/*` (públicos) con el `GITHUB_TOKEN` automático,
  igual que el CI de miniapps.
- **`next build` NO** en el gate: Vercel ya buildea al deployar; `tsc + vitest`
  es la red rápida y esencial (YAGNI). Se puede sumar después.

---

## 4. Testing

**#4:**
- **Unit (zero-dep):** `scripts/publish.test.mjs` con el runner nativo `node:test`
  (Node ≥18). Cubre `nextVersion` + `bumpPatch` + `cmpVer`:
  - `nextVersion(null, "0.1.0") === "0.1.0"` (primer publish)
  - `nextVersion("0.1.2", "0.1.0") === "0.1.3"` (auto-patch; want ≤ latest)
  - `nextVersion("0.1.2", "0.2.0") === "0.2.0"` (dev bump intencional)
  - `nextVersion("0.1.9", "0.1.0") === "0.1.10"` (patch de dos dígitos)
  - `bumpPatch("0.7.0") === "0.7.1"`, `cmpVer("0.2.0","0.1.9") === 1`
  - Importa desde `scripts/version.mjs` (funciones puras aisladas del flujo de
    publish → el test no ejecuta ningún upload).
- **e2e real:** deployar una miniapp existente dos veces seguidas y confirmar que
  la versión publicada auto-incrementa (`0.1.x → 0.1.(x+1)`), sin 409.

**#5:**
- Validar que el YAML parsea.
- La prueba real es que el workflow **corra verde** en un push/PR (el propio run
  es el test). Confirmar tras el push.

---

## 5. Estructura de archivos

**miniapp-template:**
- `scripts/version.mjs` (crear): funciones puras `parseVer`/`cmpVer`/`bumpPatch`/
  `nextVersion` (`export`), sin efectos.
- `scripts/publish.mjs` (modificar): importar de `./version.mjs`; añadir el fetch
  `GET {BACKSTAGE_URL}/api/miniapps` para obtener `latestVersion` y calcular
  `nextVersion(...)` antes del upload. Sigue ejecutable como entrypoint.
- `scripts/publish.test.mjs` (crear): tests `node:test` que importan de
  `./version.mjs` (nunca ejecutan el flujo de publish).

**backstage-web:**
- `.github/workflows/ci.yml` (crear).

---

## 6. Rollout

1. **#5 primero** (independiente, red de seguridad): agregar `ci.yml` a
   backstage-web, push, confirmar verde. (Protege el resto del trabajo.)
2. **#4:** actualizar `publish.mjs` + `publish.test.mjs` en el template; correr
   los tests; commit + push. Nuevos scaffolds lo tienen ya.
3. **Propagar #4 a existentes:** disparar un Capa 2 sync para hello_widget +
   cards_wallet (trae el nuevo `publish.mjs` vía PR) **o** backfill directo.
4. **Verificación e2e #4:** re-deployar una miniapp dos veces → versión sube sola.

---

## 7. Fuera de alcance (YAGNI)

- Conventional-commits / bump automático de minor/major por tipo de commit (solo
  patch automático; minor/major = bump manual en `manifest.json`).
- Commit-back del bump al repo (se descartó por el loop de CI).
- `next build` en el CI de backstage-web.
- Tags de git por versión / changelog.
- Rollback / pin de versión en el host (es el punto #10 del roadmap, aparte).
