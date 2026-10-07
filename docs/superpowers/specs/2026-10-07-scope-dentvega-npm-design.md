# Scope `@dentvega` 100% en npm público (miniapps + ui-kit)

**Fecha:** 2026-10-07 · **Estado:** diseño aprobado, pendiente de plan
**Antecedente:** `2026-09-22-repack-miniapps-libs-design.md` (fases 1-4 completas). Su sección
"Fuera de alcance" dejaba afuera publicar `@dentvega/ui-kit`; este spec lo revierte porque ahora
es lo que bloquea la migración.

## Problema

Después de la fase 4 conviven dos fuentes del contrato:

- `@dentvega/miniapp-contract@0.4.1` en **npm público** (fuente: `repack-miniapps`). Lo consumen
  `backstage-web` y el host.
- `backstagereactnative/packages/miniapp-contract` (v0.4.0, `src` idéntico a 0.4.1), publicado a
  mano en **GitHub Packages**. Lo consumen `miniapp-template` y las 3 miniapps como `^0.1.0`
  (resuelto a **0.1.0**). Ningún paquete del workspace del host lo usa.

Un cambio en una copia y no en la otra divergiría en silencio. Además, las miniapps no pueden
simplemente pasarse a npm: **`@dentvega/ui-kit` solo existe en GitHub Packages** y npm enruta por
**scope**, no por paquete. Quitar `@dentvega:registry=https://npm.pkg.github.com` del `.npmrc`
rompe la instalación de `ui-kit`, que las miniapps usan en runtime (singleton de Module Federation).

## Objetivo

Todo `@dentvega/*` se instala desde `registry.npmjs.org`, sin `GITHUB_TOKEN`, con una sola fuente
por paquete:

| Paquete | Fuente | Registry |
|---|---|---|
| `miniapp-contract` | `repack-miniapps/packages/miniapp-contract` | npm (0.4.1, ya publicado) |
| `miniapp-storage` | `repack-miniapps/packages/miniapp-storage` | npm (0.2.0, ya publicado) |
| `miniapp-runtime` | `repack-miniapps/packages/miniapp-runtime` | npm (0.1.0, ya publicado) |
| `ui-kit` | `backstagereactnative/packages/ui-kit` (**se queda**) | npm (**0.1.1, nuevo**) |

### Criterios de éxito

1. `miniapp-template`, `miniapp-hellow_widget`, `miniapp-cards_wallet` y
   `miniapp-account-dashboard` instalan `@dentvega/miniapp-contract@^0.4.1` y
   `@dentvega/ui-kit@^0.1.1` desde npm, con `pnpm install` **sin `GITHUB_TOKEN`**.
2. CI verde en todos los PRs; ningún workflow ni `.npmrc` referencia `npm.pkg.github.com`.
3. Una miniapp publica de punta a punta con el `publish.yml` sin token y monta en el host.
4. `backstagereactnative/packages/miniapp-contract` no existe.

## Decisiones (del brainstorming)

1. **Publicar `ui-kit` en npm público, MIT.** Alternativas descartadas: mantener GitHub Packages
   para todo el scope publicando también ahí una copia del contrato (dos registries, el token
   sigue), o solo limpiar el host (las miniapps quedan en 0.1.0).
2. **La fuente de `ui-kit` se queda en `backstagereactnative`.** Es el design system *de este
   host*: el host lo bundlea y lo sirve como singleton, así que su versión acompaña las releases
   del host. El host lo sigue consumiendo por `workspace:*`; se publica desde ahí. El repo es
   público, así que `repository` puede apuntar a él. No se mezcla con las libs genéricas de
   `repack-miniapps`.
3. **`ui-kit` sale como 0.1.1, no 0.1.0.** El `dist` publicado a GitHub Packages tiene 28 imports
   relativos sin extensión: funciona con Rspack/Metro pero rompe en ESM nativo (mismo bug de la
   fase 3). Se agregan las `.js` explícitas, lo que cambia el contenido → versión nueva. El
   `requiredVersion: '^0.1.0'` del singleton en las miniapps y el host acepta 0.1.1.
4. **Las miniapps se migran con PRs directos, no con template-sync.** `package.json` está en
   `.templatesyncignore`, así que el bump de deps no viaja por sync. El `.npmrc` y el lockfile sí
   se sincronizan; como el PR los deja idénticos al template, el próximo sync hace un 3-way merge
   sin conflicto.
5. **El token se quita al final.** Los workflows reutilizables del template (`@main`) los usan
   todas las miniapps a la vez; quitarlo antes de migrar todas rompería CI de la flota.
6. **GitHub Packages no se borra** en este trabajo: es el camino de rollback. Borrarlo es manual y
   posterior.

## Orden de implementación

Cada paso es un PR revertible por separado.

1. **`ui-kit` → npm** (`backstagereactnative`)
   - `.js` explícitos en los imports relativos de `src/`.
   - Empaquetado como `miniapp-contract`: `license: MIT` + `LICENSE`, `publishConfig.access:
     public` sin `registry`, `repository`/`homepage`, `exports`/`main`/`types` a `dist`.
   - Check del `dist` (que todo import relativo tenga extensión), como
     `repack-miniapps/scripts/check-dist-imports.mjs`.
   - Verificar con `pnpm pack` + install del tarball en un proyecto limpio antes de publicar.
   - Publica el usuario (2FA) y aprueba el stage en npmjs.com (primer publish del paquete ⇒
     placeholder `0.0.0-stage` + aprobación; ver memoria `repack-miniapps-libs`).
2. **`miniapp-template`**
   - `.npmrc`: quitar la línea del scope y la de `_authToken`.
   - `package.json`: `miniapp-contract` → `^0.4.1`, `ui-kit` → `^0.1.1`; lockfile regenerado
     (hoy fija tarballs de `npm.pkg.github.com`).
   - `rspack.config.mjs`: `requiredVersion` de `ui-kit` se deja en `^0.1.0` (acepta 0.1.1 y no
     obliga a un host nuevo).
   - READMEs: reemplazar la sección de GitHub Packages / `@org/*`.
   - `scripts/bootstrap-lib.mjs`: revisar el manejo de `.npmrc` (renombra el scope) para que siga
     funcionando sin la línea de registry.
   - Los workflows reutilizables **no se tocan todavía**: su paso `_authToken` es inocuo con el
     `.npmrc` nuevo.
3. **Las 3 miniapps** — un PR por repo con `.npmrc` + `package.json` + lockfile (+ READMEs).
   El `check-compat` del PR valida la instalación. Al mergear el primero, su `publish.yml` corre
   en `main` y sirve de prueba end-to-end (criterio 3).
4. **Quitar el token** — borrar el paso que escribe `//npm.pkg.github.com/:_authToken` en
   `publish.yml`, `check-compat.yml` y `tests.yml` del template, y el sobrante en
   `backstage-web/.github/workflows/ci.yml`.
5. **Host** (`backstagereactnative`)
   - Borrar `packages/miniapp-contract`.
   - `.npmrc`: quitar `//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}` y reescribir el comentario.
   - `host-compat.yml`: quitar el `pnpm --filter @dentvega/miniapp-contract build` (el script ya
     importa el contrato de npm).
   - `packages/PUBLISHING.md`: reescribir para `ui-kit` en npm.
   - READMEs (`README.md`, `README.es.md`, `apps/host/README.md`): layout y diagrama.
6. **Docs de `backstage-web`** — `.claude/docs-map.json` (reglas que apuntan a
   `backstagereactnative/packages/miniapp-contract/src/*` → `repack-miniapps`) y `docs/SETUP.md`,
   `docs/HOST-CONTRACT.md`, `docs/GLOSARIO.md` vía el skill `docs-sync`.

## Riesgos

- **Salto de contrato 0.1 → 0.4 en las miniapps.** Solo importan tipos (`MiniappEntryProps`,
  `Capability`, `CapabilityGrant`), idénticos en ambas versiones; el contrato no está en el
  `shared` de rspack. 0.4.1 agrega `semver` como dependencia, irrelevante en imports `type`.
  Cubierto por el typecheck de cada PR.
- **Chunks ya publicados.** No cambian: los tipos se borran al compilar y `ui-kit` lo provee el
  host en runtime. No hace falta republicar la flota.
- **`ui-kit` 0.1.1 ≠ host.** El host consume `ui-kit` por workspace (el `src`); el cambio de
  extensiones no altera comportamiento. La suite del host lo verifica.
- **Lockfile churn por template-sync.** El lockfile del template no coincide con el de cada
  miniapp (deps propias). Ya pasa hoy; CI instala con `--frozen-lockfile=false`.
- **Rollback.** Revertir `.npmrc` + lockfile de un repo vuelve a GitHub Packages, que sigue
  intacto.

## Verificación

- CI verde: PRs del template, de las 3 miniapps, del host y de `backstage-web`.
- `env -u GITHUB_TOKEN pnpm install` en cada repo.
- `ui-kit`: el check de `dist` pasa (todo import relativo con extensión) y el tarball de
  `pnpm pack` se instala en un proyecto limpio. No se importa en Node: depende de `react-native`,
  que no carga fuera de RN. La prueba real es el typecheck + build de las miniapps contra 0.1.1.
- Publish real de una miniapp tras el paso 3 + montaje en el emulador.

## Fuera de alcance

- Borrar los paquetes de GitHub Packages.
- El `publish.yml` local y sin uso de `miniapp-cards_wallet` (huérfano; se anota, no se toca).
- Subir el `requiredVersion` del singleton `ui-kit` en el host o las miniapps.
- Mover `ui-kit` a `repack-miniapps`.
