# Auth con ownership por-miniapp (#3) — Design

**Fecha:** 2026-08-10
**Estado:** Aprobado (listo para plan)
**Repo:** `backstage-web`
**Owner:** <owner>
**Roadmap:** #3.

---

## Goal

Que una miniapp tenga **maintainers** propios que puedan gestionarla, sin ser platform-admins globales. Hoy la única puerta es la allowlist global (`SCAFFOLD_ALLOWED_LOGINS`): quien está, puede todo sobre todo.

## Modelo

- **`maintainers?: string[]`** en el `MiniappRecord` (logins de GitHub). El `owner` (string) queda como etiqueta de display.
- **Platform admin** = allowlist global → puede TODO + acciones globales (crear, reseed, sync-all, storage default).
- **Maintainer** = gestiona **solo su miniapp** (binario: todas las acciones sobre ESA miniapp).
- **`canManageMiniapp(login, maintainers, allowlist) = canScaffold(login, allowlist) || maintainers.includes(login)`** (case-insensitive). **Superset del gate actual** → sin regresión.
- Restringir a un equipo = NO ponerlo en la allowlist, solo como maintainer de su miniapp.

## Diseño detallado

### 1. Tipos — `lib/registry/types.ts`
`MiniappRecord` += `readonly maintainers?: string[]`; `MiniappDetail` += `readonly maintainers?: string[]`.

### 2. Authz — `lib/scaffold-authz.ts`
```ts
export function canManageMiniapp(
  login: string | null | undefined,
  maintainers: readonly string[] | undefined,
  allowlist: readonly string[],
): boolean {
  if (canScaffold(login, allowlist)) return true;   // platform admin
  if (!login) return false;
  const l = login.trim().toLowerCase();
  return (maintainers ?? []).some((m) => m.trim().toLowerCase() === l);
}
```

### 3. Registry — `lib/registry/registry.ts`
`setMaintainers(reg, id, list)`: normaliza (trim + dedup + no-vacíos); lista vacía → borra el campo; valida existencia. `getMiniappDetail` proyecta `maintainers`.

### 4. Swap del gate en las rutas por-miniapp
Cambiar `canScaffold(login, allowlist)` → `canManageMiniapp(login, reg[id]?.maintainers, allowlist)` en:
- `deploy/route.ts`, `sync-template/route.ts` (cargan el reg para el gate antes de `dispatchMiniappWorkflow`)
- `pin/route.ts`, `storage-provider/route.ts`, `versions/[version]/route.ts`, `[id]/route.ts` (DELETE + PATCH) — ya cargan el reg.

**Se mantienen en `canScaffold` (platform-admin):** `scaffold` (crear), `admin/reseed-secrets`, `admin/sync-all`, `storage-provider` global, `catalog/page.tsx` (`canAdmin` de los controles globales).

### 5. Editar maintainers — `PUT /api/miniapps/:id/maintainers` (nuevo)
`canManageMiniapp` (admin **o** el propio maintainer → auto-gobierno). Body `{ maintainers: string[] }` → `setMaintainers` → devuelve `getMiniappDetail`.

### 6. Detalle — `app/miniapp/[id]/page.tsx`
`canPublish` → `canManage = canManageMiniapp(session?.githubLogin, detail.maintainers, scaffoldAllowedLogins())`. Los controles admin (deploy/pin/storage/sync/borrar) pasan a mostrarse con `canManage`. Nuevo `MaintainersControl` (cuando `canManage`).

### 7. UI — `app/components/MaintainersControl.tsx` (nuevo, client)
Muestra los maintainers actuales (chips con ✕ para quitar) + un input para agregar un login + Guardar → `PUT /api/miniapps/:id/maintainers` → `router.refresh()`.

## Verificación

- **`canManageMiniapp`:** admin → true en cualquiera; maintainer → true en la suya (case-insensitive), false en otra; ni-admin-ni-maintainer → false; sin login → false.
- **`setMaintainers`:** setea (normaliza/dedup); vacío → borra el campo; miniapp inexistente → 404; no muta.
- **Rutas (una representativa, ej. pin + version-delete):** un maintainer NO-admin puede en su miniapp; NO puede en otra (403). Admin puede en todas.
- **`PUT maintainers`:** admin o maintainer setea (200 + detail); un tercero → 403; miniapp inexistente → 404.
- **`MaintainersControl`:** renderiza los actuales; agregar/quitar; el save postea.
- **Sin regresión:** con miniapps sin `maintainers`, un allowlisted (platform-admin) sigue gestionando todo.

## Qué NO cambia

- Publish (upload) — es token-gated (PUBLISH_TOKEN), no sesión. Fuera de este modelo.
- Acciones globales — siguen platform-admin.
- El `owner` (display) — intacto.

## Fuera de alcance

- Roles finos por-acción (viewer/publisher/admin) — hoy binario.
- Teams de GitHub como principal (hoy logins individuales).
- Ownership del repo en GitHub (esto es authz de Backstage, no de GitHub).

## Archivos afectados

- `lib/registry/types.ts` (+maintainers), `lib/scaffold-authz.ts` (+canManageMiniapp), `lib/registry/registry.ts` (+setMaintainers, proyección), 6 rutas por-miniapp (swap del gate), `app/api/miniapps/[id]/maintainers/route.ts` (nuevo), `app/components/MaintainersControl.tsx` (nuevo), `app/miniapp/[id]/page.tsx` (canManage + control) + tests.
