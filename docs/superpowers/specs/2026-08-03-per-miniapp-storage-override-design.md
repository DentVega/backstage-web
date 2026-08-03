# Override de storage por miniapp — Diseño

**Fecha:** 2026-08-03
**Estado:** Diseño aprobado — listo para plan de implementación
**Owner:** DentVega

## 1. Contexto y objetivo

La Fase B dejó un **default global** de storage provider elegible desde la UI
(preferencia en KV; si no hay, orden por env R2 → Blob → fs). Ahora queremos que
**cada miniapp pueda pinnear su propio provider**, cayendo al default global si no
setea nada. Caso de uso: mover una miniapp puntual a Blob (o a otro backend futuro)
sin cambiar el default de toda la plataforma.

El override vive **en el registro de la miniapp** (`MiniappRecord`), junto al resto de
su estado — así se borra con la miniapp, se ve en el detalle, y no agrega otra
estructura de KV.

## 2. Modelo de precedencia

Al publicar una miniapp, el provider efectivo se resuelve así:

```
1. override de la miniapp   (si está seteado Y su provider está en availableProviders())
2. default global           (preferencia KV, si aplica)
3. orden por env            (availableProviders()[0]: R2 → Blob → fs)
```

**Fallback seguro en cada nivel:** un override (o el default) que apunte a un provider
sin creds se ignora y se baja al siguiente nivel. Nunca se queda sin storage.

`source` del efectivo: `"miniapp"` si ganó el override, si no el `source` del default
global (`"preference"` | `"env"`).

## 3. Componentes

### 3.1 Registry — `lib/registry`
**Tipos** (`lib/registry/types.ts`):
- `MiniappRecord` suma `readonly storageProvider?: StorageProvider;` (undefined = usa el default global). Import de `StorageProvider` desde `@/lib/storage/provider`.
- `MiniappDetail` suma `readonly storageProvider?: StorageProvider;` (proyección del override).

**Función** (`lib/registry/registry.ts`):
```ts
export function setMiniappStorageProvider(
  reg: Registry,
  rawId: string,
  provider: StorageProvider | null,   // null = limpiar (vuelve al default)
): Registry;
```
- `parseMiniappId` + `MiniappNotFoundError` si el id no existe (mismo patrón que `removeMiniapp`).
- `provider === null` → devuelve el record **sin** el campo `storageProvider`.
- `provider !== null` → devuelve el record con `storageProvider: provider`.
- Inmutable (no muta `reg`), como el resto del módulo.

**Proyección** (`getMiniappDetail`): agrega
`...(record.storageProvider !== undefined ? { storageProvider: record.storageProvider } : {})`
(mismo estilo que `createdAt`/`repoUrl`).

### 3.2 Storage — `lib/storage/index.ts`
- `getStorage(miniappOverride?: StorageProvider | null): Promise<ChunkStorage>` — resuelve
  override → default global → env y construye el storage. `getStorage()` sin arg =
  default global (comportamiento actual intacto).
- `getMiniappStorageState(miniappOverride: StorageProvider | null): Promise<{`
  `  available: StorageProvider[]; override: StorageProvider | null;`
  `  defaultProvider: StorageProvider; effective: StorageProvider;`
  `  source: "miniapp" | "preference" | "env" }>` — para la UI del detalle.
  (`defaultProvider`, no `default`: es palabra reservada y no se puede desestructurar.)
- Reutiliza `getStorageProviderState()` (global) internamente:
  ```
  global = await getStorageProviderState()          // { available, active, source }
  useOverride = override !== null && global.available.includes(override)
  effective       = useOverride ? override : global.active
  source          = useOverride ? "miniapp" : global.source
  defaultProvider = global.active
  ```

### 3.3 Upload route — `app/api/miniapps/[id]/upload/route.ts`
Hoy carga el registry **después** del `putMany`. Se mueve la carga **antes** para leer el
override:
```ts
const reg = await getStore().load();
const override = reg[id]?.storageProvider ?? null;
const storage = await getStorage(override);
const { baseUrl } = await storage.putMany(`${id}/${version}`, files);
// ... (más abajo, publishVersion sobre el `reg` ya cargado)
```
- Miniapp nueva (sin entrada aún) → `override` null → default global.
- `publishVersion(reg, id, ...)` sigue operando sobre el mismo `reg` cargado (sin cambio de
  semántica; solo se adelantó el `load`).

### 3.4 Endpoint — `app/api/miniapps/[id]/storage-provider/route.ts`
`runtime = "nodejs"`.
- **PUT** `{ provider: StorageProvider | null }`:
  - Guard `canScaffold` (lazy `import("@/auth")`) → 403 si no.
  - Validación: `provider` debe ser `null` **o** un `StorageProvider` presente en
    `availableProviders()`. Si no → 400 (`"provider not available"`).
  - `setMiniappStorageProvider(reg, id, provider)` → si lanza `MiniappNotFoundError` → 404
    (vía `statusForError`).
  - Guarda el registry. Responde `200` con el estado de la miniapp
    (`getMiniappStorageState(provider)`), para que la UI refresque.
- (No hay GET propio: el estado inicial lo arma la page de detalle server-side.)

### 3.5 UI — `app/components/MiniappStorageControl.tsx`
Client component. Props: `{ id, available, override, defaultProvider, effective, source }`.
- Radios: **"Default (⟨label(defaultProvider)⟩)"** (value especial `"__default__"`) + un radio
  por cada `available` (labels legibles: r2→"Cloudflare R2", blob→"Vercel Blob", fs→"Local (dev)").
- Preseleccionado: el `override` actual, o `"__default__"` si `override === null`.
- **Guardar** → `PUT /api/miniapps/{id}/storage-provider` con
  `{ provider: choice === "__default__" ? null : choice }`; on-success `router.refresh()` + "Guardado".
- Deshabilita Guardar si el elegido == estado actual (`override ?? "__default__"`).
- Línea de estado: `Efectivo: ⟨label(effective)⟩ · ⟨"por miniapp" | "por default"⟩`
  (`source === "miniapp"` → "por miniapp", si no "por default").
- Montaje: en `app/miniapp/[id]/page.tsx`, dentro del bloque `canPublish`, como una
  `<section className="detail-section">` nueva ("Almacenamiento"). La page (server) calcula
  `getMiniappStorageState(detail.storageProvider ?? null)` y pasa las props.

## 4. Data flow

```
Admin abre /miniapp/<id> (server)
  → getMiniappDetail → detail.storageProvider (override o undefined)
  → getMiniappStorageState(detail.storageProvider ?? null) → { available, override, default, effective, source }
  → si canPublish: <MiniappStorageControl id available override defaultProvider effective source />
Admin elige un provider (o "Default") + Guardar
  → PUT /api/miniapps/<id>/storage-provider { provider }   (canScaffold, valida disponible/null)
  → setMiniappStorageProvider → save registry
  → router.refresh() → la page recomputa el estado
Próximo publish de esa miniapp
  → upload route: override = reg[id]?.storageProvider ?? null → getStorage(override) → provider efectivo
```

## 5. Manejo de errores
- PUT provider inválido / no disponible → 400.
- PUT sobre miniapp inexistente → 404 (`MiniappNotFoundError`).
- PUT sin admin → 403.
- Override guardado que perdió creds → `getStorage`/`getMiniappStorageState` lo ignoran y usan
  el default global; el `source` reflejará `"preference"`/`"env"`, no `"miniapp"`.

## 6. Seguridad
- PUT protegido por `canScaffold` (admin allowlist), como el resto de las mutaciones.
- El control UI se renderiza solo en el bloque `canPublish` (admins).
- No se exponen creds ni tokens.

## 7. Testing
- **`setMiniappStorageProvider`**: setea el campo; `null` lo borra; no toca otras miniapps;
  `MiniappNotFoundError` si el id no existe; no muta el `reg` original.
- **`getMiniappDetail`**: incluye `storageProvider` cuando el record lo tiene; lo omite cuando no.
- **`getStorage(override)`** (mock preference/provider/adapters): override disponible → ese;
  override no disponible → cae al default global; sin override → default global.
- **`getMiniappStorageState`**: override aplica → `effective=override, source="miniapp"`;
  override no disponible o null → `effective=default, source=<global>`; `default` = active global.
- **endpoint PUT**: 200 + persiste (admin, provider disponible); 200 + limpia (provider null);
  400 provider no disponible; 403 sin admin; 404 miniapp inexistente.
- **MiniappStorageControl**: renderiza "Default (...)" + un radio por available; preselecciona
  el override (o Default); Guardar deshabilitado si elegido == actual.

## 8. Fuera de alcance (YAGNI)
- **Migrar chunks ya publicados** al cambiar el override (los viejos quedan donde están; cada
  re-publish usa el efectivo actual).
- **Override por-versión** (esto es por-miniapp).
- **GET endpoint dedicado** para el estado por-miniapp (lo arma la page server-side).
