# Catálogo refleja la versión servida (fix del rollback) — Design

**Fecha:** 2026-08-08
**Estado:** Aprobado (listo para plan)
**Repos:** `backstage-web` (backend + catálogo web) + `backstagereactnative` (host)
**Owner:** <owner>
**Contexto:** follow-up de #10. Hoy el catálogo (web y host) muestra `latestVersion`, pero al montar se sirve `servedVersion` (pinned). Cuando hay rollback, la card **miente** (dice v0.1.13 pero monta v0.1.12).

---

## Goal

Que el catálogo — la lista de miniapps en el **host** y en el **Backstage web** — muestre la versión **servida** (la que realmente se monta), con un indicador cuando difiere de la última (rollback activo).

## Background

- `resolveMiniapp` sirve `pinnedVersion ?? latest`. El detalle (`/api/miniapps/:id`) ya expone `servedVersion` (hecho en #10).
- **El catálogo NO:** `CatalogEntry` (backstage-web) solo tiene `latestVersion`; `listCatalog` usa `selectLatest`. `/api/miniapps` → eso → el host (`MiniappSummary` en `host-runtime`) → `HomeScreen.tsx` muestra `v${latestVersion} · N versiones`.
- Resultado: con pin, la card muestra la última publicada, no la servida. Confirmado en vivo: card `v0.1.13`, `resolve` → `0.1.12`.

## Approach

Agregar `servedVersion` a `CatalogEntry` (backend) → fluye por `/api/miniapps` → el host y el web muestran la **servida** + un indicador `🔒` / "última vX" cuando `served !== latest`. Campo **opcional** en `MiniappSummary` (host) con fallback a `latestVersion` → rollout-safe (el host no rompe si el backend aún no deployó).

## Diseño detallado

### Backend — `backstage-web`

**`lib/registry/types.ts`** — `CatalogEntry` +:
```ts
/** Versión que el host sirve (pinnedVersion ?? latest). null si no hay ninguna. */
readonly servedVersion: SemVer | null;
```

**`lib/registry/registry.ts`** — `listCatalog` computa served:
```ts
const latest = selectLatest(record.versions);
return {
  // ...
  latestVersion: latest?.version ?? null,
  servedVersion: record.pinnedVersion ?? latest?.version ?? null,
  // ...
};
```

`/api/miniapps` (GET) devuelve `listCatalog(reg)` sin cambios → ya incluye el campo nuevo.

### Web catálogo — `backstage-web`

**`app/components/CatalogList.tsx`** — la card muestra la servida; si `servedVersion !== latestVersion`, un chip/nota de rollback (ej. `v0.1.12 🔒 · última v0.1.13`). Espeja el badge `● servida` de `VersionList`.

### Host — `backstagereactnative`

**`packages/host-runtime/src/CatalogClient.ts`** — `MiniappSummary` +:
```ts
/** Versión servida (pinnedVersion ?? latest). Opcional para tolerar backends viejos. */
readonly servedVersion?: string | null;
```

**`apps/host/src/screens/HomeScreen.tsx`** — el card usa la servida (con fallback):
```tsx
const served = item.servedVersion ?? item.latestVersion;
const rolledBack = served !== null && item.latestVersion !== null && served !== item.latestVersion;
// línea de versión:
//   normal:    `v${served} · N versiones`
//   rollback:  `v${served}  ·  🔒 fijada (última v${item.latestVersion})  ·  N versiones`
```
Un `AppText`/`Box` extra con color de acento/warn cuando `rolledBack`.

## Verificación

- **Backend (vitest):** `listCatalog` incluye `servedVersion = pinnedVersion ?? latest`; con pin, `servedVersion` = la fijada y `latestVersion` = la última (distintos). Actualizar el/los tests de `listCatalog` que asertan la forma del `CatalogEntry`.
- **Web (RTL):** `CatalogList` muestra la servida + el indicador cuando served ≠ latest.
- **Host (RN Testing Library):** la card de `HomeScreen` muestra la servida; con `servedVersion` ausente cae a `latestVersion` (backward-compat); indicador de rollback cuando difieren.
- **e2e:** con hellow_widget pinneado a 0.1.12, `/api/miniapps` devuelve `servedVersion: "0.1.12"`, `latestVersion: "0.1.13"`; el host (reload del emulador) muestra la 0.1.12 con el indicador.

## Qué NO cambia

- `resolveMiniapp` (ya sirve la pinneada) — el mount ya era correcto; esto arregla solo la **etiqueta**.
- El sistema de pin/rollback (#10), compat, etc.

## Fuera de alcance

- Mostrar el indicador en un freeze-on-latest (served === latest → sin indicador; es indistinguible de no-pin y no aporta).
- Un botón de rollback desde el host (el host es read-only del catálogo; el control vive en Backstage).

## Archivos afectados

- **backstage-web:** `lib/registry/types.ts` (+`servedVersion` en CatalogEntry), `lib/registry/registry.ts` (`listCatalog`), `app/components/CatalogList.tsx` + tests (`registry.test.ts`/`listCatalog`, `CatalogList.test.tsx`).
- **backstagereactnative:** `packages/host-runtime/src/CatalogClient.ts` (`MiniappSummary`), `apps/host/src/screens/HomeScreen.tsx` + tests. (Entra por PR — main protegido.)
