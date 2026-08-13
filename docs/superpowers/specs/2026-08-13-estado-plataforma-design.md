# Estado de la plataforma — diseño

**Fecha:** 2026-08-13
**Estado:** aprobado (scoping + diseño confirmados con el usuario en sesión)

## Objetivo

Una página **`/estado`** que muestra, en vivo, el estado operativo de la plataforma
"Spotify-for-miniapps": la flota, el Host Contract vigente, el modo del compat gate y el
storage provider activo. Pensada para que el **equipo técnico** la abra y pueda
**mostrársela a inversores** en una reunión — legible de un vistazo, poco texto, números
grandes.

## Decisiones (tomadas con el usuario)

- **Datos:** estado operativo **live** (no roadmap, no uptime-status). Server-rendered,
  lee las libs directo (sin fetch HTTP a sí misma), patrón de `/catalog` y `/metrics`
  (`export const dynamic = "force-dynamic"`).
- **Audiencia:** liderazgo/inversores → presentación limpia y escaneable.
- **Sensibilidad / acceso:** información sensible → **solo allowlist** (equipo técnico).
  Doble gate: `/estado` en `PROTECTED_PREFIXES` (middleware exige login) **+** chequeo
  de página `canScaffold(login, SCAFFOLD_ALLOWED_LOGINS)`. Logueado pero fuera de la
  allowlist → estado "Sin acceso". El link del navbar aparece **solo para admins**.

## Qué muestra (4 bloques)

1. **KPIs hero** — números grandes: nº de miniapps, nº total de versiones publicadas,
   cuántas soportan iOS+Android, versión del Host Contract, modo del gate (con color).
2. **Flota** — una fila por miniapp: nombre, owner, versión servida (+ badge *rollback*
   si difiere de la última), nº de versiones, pills de plataforma (iOS / Android), link
   al repo.
3. **Host Contract** — `contractVersion` + React Native, tabla compacta de singletons
   (`shared`) y chips de `nativeModules`, con la frase de por qué importa. Si no hay
   contract publicado → estado "aún no publicado".
4. **Operación** — gate WARN/ENFORCE (pill de color) + storage provider activo y su
   fuente (`preference` | `env`) + disponibles.

## Fuentes de datos (verificadas contra el código)

| Dato | Fuente |
|---|---|
| Flota (served/latest/count/repo) | `listCatalog(reg)` → `CatalogEntry[]` (`lib/registry/registry.ts`) |
| Soporte iOS por miniapp | derivado del record crudo: `reg[id].versions.some(v => v.iosUrl)` (Android = tiene ≥1 versión) — las view-models no exponen `iosUrl` |
| Registry | `getStore().load()` (`lib/registry/store.ts`) |
| Host Contract | `getHostContractStore().load()` → `HostContract \| null` (`lib/host-contract/store.ts`); shape: `contractVersion, reactNative, shared: Record<string,string>, nativeModules: string[]` (no hay `generatedAt`/`hostCommit`) |
| Modo de gate | `process.env.COMPAT_ENFORCE === "1"` (env directo, sin helper) |
| Storage provider | `getStorageProviderState()` → `{ available, active, source }`, valores `"r2" \| "blob" \| "fs"` (`lib/storage`) |
| Auth (allowlist) | `canScaffold(session?.githubLogin, scaffoldAllowedLogins())` (`lib/scaffold-authz`, `lib/config`) |

## Arquitectura / archivos

- **`lib/estado/summary.ts`** (puro, testeable): `buildEstadoSummary(entries, reg, contract, gateEnforce, storage) → EstadoSummary`.
  - `EstadoSummary`: `{ fleet: FleetItem[], totals: {miniapps, versions, iosAndAndroid}, contract: {published, contractVersion?, reactNative?, shared?: [string,string][], nativeModules?}, gate: "warn"|"enforce", storage }`.
  - `FleetItem`: `{ id, name, owner, servedVersion, latestVersion, isRolledBack, versionCount, platforms: ("android"|"ios")[], repoUrl? }`.
  - Derivaciones: `platforms` = `["android"]` si hay versiones, + `"ios"` si alguna versión tiene `iosUrl`; `isRolledBack` = served≠latest (ambos no-null); totales por agregación.
- **`lib/estado/summary.test.ts`** (vitest): registro vacío; miniapp iOS+Android; android-only; rollback; contract null; gate enforce.
- **`app/estado/page.tsx`** (server component, `dynamic="force-dynamic"`): gate de allowlist → si no admin, render "Sin acceso"; si admin, arma el summary y renderiza los 4 bloques con las clases del design system.
- **Editar** `lib/auth-paths.ts` (agregar `/estado` a `PROTECTED_PREFIXES`).
- **Editar** `app/layout.tsx` (link "Estado" en el navbar, **solo si** `canScaffold(session?.githubLogin, scaffoldAllowedLogins())`).
- **Editar** `app/globals.css` (clases nuevas: `.estado-kpis`/`.kpi`/`.kpi-num`/`.kpi-label` con variantes de color para el gate; `.plat-pills`/`.plat-pill`; filas de flota; chips de nativos — todas via tokens existentes, theme-aware).

## Manejo de errores / bordes

- Host Contract `null` → bloque "aún no publicado" (no rompe).
- Flota vacía → estado `empty`.
- Miniapp sin versiones → `versionCount 0`, `platforms []`.
- No admin → "Sin acceso" (no revela datos).

## Testing

Unit (vitest) sobre `buildEstadoSummary` — la única lógica no trivial (derivación de
plataformas, rollback, agregación, contract null). La página es presentacional.

## Fuera de alcance (YAGNI)

Roadmap/estado-de-proyecto, uptime/health-checks, auto-refresh, gráficos históricos,
per-miniapp drill-down (ya existe en `/miniapp/[id]`).
