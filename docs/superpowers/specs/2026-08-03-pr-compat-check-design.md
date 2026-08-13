# Gate de compatibilidad miniapp→host en el PR ("shift-left") — Design

**Fecha:** 2026-08-03
**Estado:** Aprobado (listo para plan)
**Repo principal afectado:** `miniapp-template` (los cambios se propagan a la flota vía template-sync)
**Owner:** <owner>

---

## Goal

Correr el gate de compatibilidad (`gen-manifest-shared` + `check-compat`) **en cada Pull Request** de una miniapp, para que un cambio incompatible con el Host Contract muestre una ✗ **antes del merge a `main`** — en vez de recién al publicar. El gate de publish se mantiene intacto como red final.

## Background — cómo está hoy

El gate vive dentro del workflow reusable `publish.yml` (`.github/workflows/publish.yml` en `miniapp-template`), que las miniapps invocan desde su `ci.yml`:

```yaml
# ci.yml (por miniapp, se sincroniza vía template-sync)
on:
  push:
    branches: [main]
    tags: ["v*"]
  workflow_dispatch:
jobs:
  publish:
    uses: <owner>/miniapp-template/.github/workflows/publish.yml@main
    secrets: inherit
```

Dentro de `publish.yml`, el paso "Derive truthful manifest.shared + compat gate" corre:

```sh
node scripts/gen-manifest-shared.mjs   # re-deriva manifest.shared + nativeModules de las deps reales ∩ contract
node scripts/check-compat.mjs          # falla (exit 1) si hay skew o un nativo que el host no tiene, con COMPAT_ENFORCE=1
```

Como `ci.yml` solo se dispara en **push a `main` / tag / botón Deploy**, el gate corre **después del merge**, al publicar. Consecuencia: un PR incompatible se mergea con "Checks 0" (verde de git), y el dev se entera recién cuando el publish falla.

`check-compat.mjs` ya:
- Fetchea `${BACKSTAGE_URL}/api/host-contract` (endpoint público, sin secreto).
- Es rollout-safe: sin contract publicado → `exit 0` (no bloquea).
- Con `COMPAT_ENFORCE=1` e incompatibilidad → imprime `check-compat: INCOMPATIBLE with host contract vX — <detalle>` y `exit 1`.
- Cubre **ambas** fallas: skew de shared singletons **y** nativos faltantes.

**No requiere ningún cambio en los scripts `.mjs`.** Ya hacen exactamente lo que necesitamos; solo falta correrlos en el evento `pull_request`.

## Problema

El feedback de compatibilidad llega tarde (post-merge). Queremos moverlo al PR ("shift-left"): rojo temprano, `main` de la miniapp siempre compatible.

## Approach elegido

**Un nuevo workflow reusable `check-compat.yml` (solo chequeo, sin build/publish), invocado desde `ci.yml` en el evento `pull_request`.**

Por qué este, y no las alternativas:

- **A (elegido): reusable `check-compat.yml` separado + caller `pull_request` en `ci.yml`.**
  El reusable se referencia `@main`, así que un fix llega a toda la flota al instante (mismo patrón que `publish.yml`). El caller (trigger `pull_request`) vive en `ci.yml` y se propaga por template-sync. Chequeo puro: instala deps, corre los dos scripts, no buildea ni publica → rápido (~1–2 min) y no necesita `PUBLISH_TOKEN`.
- **B (descartado): agregar `pull_request` a `publish.yml`.**
  `publish.yml` buildea y publica; correrlo en cada PR gastaría minutos de build y arriesgaría publicar desde un PR. Mezcla dos responsabilidades (validar vs. publicar).
- **C (descartado): correr el gate solo en `main` con branch protection que exija el check.**
  GitHub no puede exigir como *required check* algo que corre post-merge. El check tiene que correr en el PR para bloquear el merge.

## Diseño detallado

### 1. Nuevo reusable: `miniapp-template/.github/workflows/check-compat.yml`

`workflow_call`, un solo job. Reusa el bloque de setup de `publish.yml` (pnpm + node 20 + install deps con el `~/.npmrc` de GitHub Packages), pero **termina en el gate** — sin build, zip ni publish.

```yaml
name: Compat check (reusable)

# Chequeo de compatibilidad miniapp→host para correr EN PRs (shift-left).
# No buildea ni publica: instala deps, re-deriva el manifest y corre el gate.
# El gate de publish (publish.yml) sigue siendo la red final post-merge.

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
        run: |
          echo "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" >> ~/.npmrc
          pnpm install --frozen-lockfile=false
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Compat gate (miniapp → host contract)
        # Mismo GUARD que publish.yml: si los scripts todavía no llegaron a este
        # repo (miniapp no sincronizada), se saltea en vez de romper el check.
        # COMPAT_ENFORCE=1 fijo: un check que solo advierte no sirve como gate de PR.
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

Notas de diseño:
- **`COMPAT_ENFORCE: "1"` fijo (no lee la repo/org var).** El gate de publish lee `vars.COMPAT_ENFORCE` para el rollout gradual, pero ese rollout **ya terminó** (enforce live) → los `main` de la flota ya son compatibles, así que ningún PR va a fallar por código preexistente. Un check de PR que solo advierte (verde) no cumple su función. Decisión: el PR check **siempre** enforce.
- **Solo `BACKSTAGE_URL`** (URL pública). Sin `PUBLISH_TOKEN` → menos superficie.
- **`gen-manifest-shared.mjs` reescribe `manifest.json` en el runner efímero**; no se commitea. Necesario para detectar el nativo/skew que introduce el PR (re-deriva `nativeModules` vía `react-native config` y `shared` de las versiones instaladas). Idéntico a lo que hace publish.
- **Rollout-safe idéntico a publish:** scripts ausentes → skip; contract no publicado → `check-compat` sale 0.

### 2. Caller en `ci.yml` (se propaga por template-sync)

Se agrega el trigger `pull_request` y un job que invoca el nuevo reusable. El job de publish existente queda igual.

```yaml
name: Publish miniapp

on:
  push:
    branches: [main]
    tags: ["v*"]
  workflow_dispatch:
  pull_request:            # NUEVO: gate de compat en el PR (shift-left)

jobs:
  # NUEVO — corre en PRs (y no molesta en push: es barato y redundante con publish)
  compat:
    uses: <owner>/miniapp-template/.github/workflows/check-compat.yml@main
    secrets: inherit

  publish:
    # El publish NO debe correr en PRs (solo push/tag/dispatch).
    if: github.event_name != 'pull_request'
    uses: <owner>/miniapp-template/.github/workflows/publish.yml@main
    secrets: inherit
```

- El `if: github.event_name != 'pull_request'` en `publish` evita que el build/publish corra en PRs (el trigger `pull_request` ahora activa el workflow, pero solo queremos el job `compat`).
- `compat` corre en todos los eventos; en push es redundante con el gate interno de publish, pero es barato y no molesta. (Opcional en el plan: acotarlo con `if: github.event_name == 'pull_request'` si se quiere evitar el run duplicado en push.)

### 3. Qué NO cambia

- `publish.yml` — intacto. Su gate interno sigue siendo la **red final** post-merge.
- `gen-manifest-shared.mjs`, `check-compat.mjs` — **sin cambios**. Se reusan tal cual.
- El Host Contract, el endpoint `/api/host-contract`, Backstage — sin cambios.

## Distribución / Rollout

> **⚠️ Corrección post-implementación:** el mecanismo real es distinto al que se asumió acá. **Template-sync NO puede entregar cambios de workflows** — el `GITHUB_TOKEN` de la Action tiene prohibido crear/modificar `.github/workflows/*` sin el permiso `workflows`, que **no** se puede otorgar en el bloque `permissions:` del YAML (solo existe a nivel PAT / GitHub App). Además, `.templatesyncignore` ya excluía **todos** los `.github/workflows/*` a propósito (modelo thin-caller). Ver [[template-sync-no-propaga-workflows]].

Rollout real:

1. **`check-compat.yml` (reusable) → template-only.** Vive solo en `miniapp-template`, referenciado `@main`. Se agregó a `.templatesyncignore` (igual que `publish.yml`) para que el sync no intente copiarlo (y choque con el muro de `workflows`). **La lógica del gate llega a la flota gratis** vía `check-compat.yml@main`.
2. **`ci.yml` (el trigger `pull_request` + job `compat`) → entrega out-of-band, una sola vez por miniapp.** `ci.yml` está en `.templatesyncignore` y de todos modos el sync no podría pushearlo. Se entrega con un token con scope `workflow` (push directo a `main` de cada miniapp, decisión del owner). Es un cambio **estructural único**: una vez que la miniapp tiene el trigger + el caller `compat`, todos los cambios futuros de lógica del PR-check viven en el reusable → nunca hay que volver a tocar la miniapp.
3. **Rollout-safe se mantiene:** una miniapp sin el `ci.yml` nuevo simplemente no tiene PR check todavía (no rompe nada); cuando se le aplica el push out-of-band, lo gana.
4. Verificación e2e (ver abajo) sobre `hellow_widget`.

## Verificación (e2e — es un workflow, no lógica nueva)

La lógica del gate ya está cubierta por los tests `node:test` de `check-compat.mjs` y `gen-manifest-shared.mjs`. El entregable nuevo es YAML, así que se valida de punta a punta con dos PRs reales sobre una miniapp sincronizada (ej. `hellow_widget`):

1. **PR incompatible** (agrega un nativo que el host no tiene, p. ej. `react-native-mmkv`): el check `compat` debe salir **rojo** con `check-compat: INCOMPATIBLE ... react-native-mmkv (native module not in host)`. El PR de demo #4 ya existente sirve como este caso (pasaría de "Checks 0" a ✗ real).
2. **PR compatible** (cambio trivial en JS, sin tocar deps nativas): el check `compat` debe salir **verde**.
3. Confirmar que **`publish` NO corre** en ninguno de esos PRs (solo `compat`).

## Fase 2 — bloqueo duro con branch protection (APLICADA 2026-08-03)

Branch protection con `compat / compat` como **required status check** en el `main` de cada miniapp → un PR con el check en rojo **no se puede mergear**.

Config aplicada (vía API `PUT /repos/{owner}/{repo}/branches/main/protection`):
- `required_status_checks: { strict: false, contexts: ["compat / compat"] }`
- **`enforce_admins: false`** — el owner conserva el bypass. Decisión deliberada por el **gotcha de template-sync**: los PRs de sync se crean con el `GITHUB_TOKEN` de la Action, y GitHub **no dispara workflows** en eventos de ese token → el `compat` check **no corre** en PRs de sync; con `enforce_admins` quedarían impedidos de mergear. Sin enforce_admins, el admin los mergea igual. Ver [[template-sync-no-propaga-workflows]].
- `required_pull_request_reviews: null`, `restrictions: null`.

Estado por repo:
- `cards_wallet` (public) → ✅ protegido.
- `account-dashboard` (public) → ✅ protegido.
- `hellow_widget` (**private**, plan free) → branch protection **no disponible** (requiere Pro o repo público). Queda con **check soft**: el `compat` corre y muestra rojo/verde en cada PR, pero no bloquea el merge. Decisión del owner: dejarlo así (es la miniapp de demo).

### Notas fuera de alcance
- PRs desde forks (sin acceso a secrets): no aplica hoy (repos same-owner). Si se diera, el check degradaría a fallo de secreto — aceptable, se aborda si aparece el caso.
- **Pendiente si se activa GitHub Pro:** aplicar la misma protección a `hellow_widget` (mismo comando).

## Riesgos / Trade-offs

| Riesgo | Mitigación |
|---|---|
| Run de CI extra por PR (~1–2 min) | Chequeo liviano (sin build). Costo aceptable. |
| ✗ roja no bloquea merge sin branch protection | Documentado como fase 2; el gate de publish sigue como red final. |
| `pull_request` dispara también el job publish si no se filtra | `if: github.event_name != 'pull_request'` en el job `publish`. |
| Miniapp no sincronizada aún | Rollout-safe: sin caller nuevo → sin PR check (no rompe); scripts ausentes → skip. |

## Archivos afectados

- **Crear:** `miniapp-template/.github/workflows/check-compat.yml` (reusable, template-only)
- **Modificar:** `miniapp-template/.github/workflows/ci.yml` (trigger `pull_request` + job `compat` + guard `if` en `publish`)
- **Modificar:** `miniapp-template/.templatesyncignore` (agregar `check-compat.yml` — reusable que no se sincroniza)
- **Entrega out-of-band:** el `ci.yml` de cada miniapp se actualiza con un token con scope `workflow` (NO por template-sync).
- **Sin cambios:** `publish.yml`, `scripts/*.mjs`.
