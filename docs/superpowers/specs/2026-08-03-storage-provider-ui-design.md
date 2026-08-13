# Selector de storage provider desde la UI (Fase B) — Diseño

**Fecha:** 2026-08-03
**Estado:** Diseño aprobado — listo para plan de implementación
**Owner:** <owner>

## 1. Contexto y objetivo

La Fase A dejó el storage de chunks **swappable por env** (`getStorage()` elige
R2 → Blob → fs según las vars presentes). La Fase B agrega un **override desde la UI
de Backstage**: un admin elige qué provider está activo sin tocar env vars ni
redesplegar. Sirve para cortar de un provider a otro en caliente (ej. si Blob vuelve,
o para volver a R2 tras una prueba) desde el catálogo.

La preferencia vive en KV (Upstash) — como el Host Contract — y `getStorage()` la lee.
Si no hay preferencia o el provider elegido perdió sus creds, cae al orden por env
(**fallback seguro**: nunca se queda sin storage).

## 2. Decisiones tomadas

1. **Override con fallback seguro:** la preferencia solo se aplica si el provider
   elegido tiene sus creds en env; si no (o si no hay preferencia), se usa el orden por
   env actual (R2 → Blob → fs). Cambiar env nunca deja la plataforma sin storage.
2. **Solo se elige entre providers configurados:** el toggle ofrece los que tienen env
   presente (`availableProviders()`). En prod eso es R2/Blob; `fs` es fallback de dev.
3. **UI = strip admin en el catálogo:** un control chico arriba del catálogo, visible
   solo para admins (`canScaffold`). Sin páginas nuevas (YAGNI).
4. **Auth = `canScaffold`** (allowlist de admins), igual que el DELETE y el PUT del
   host-contract. NO el publish token.
5. **`getStorage()` pasa a async** — tiene un solo caller
   (`app/api/miniapps/[id]/upload/route.ts:143`, que ya hace `await`).

## 3. Componentes

### 3.1 Tipos + disponibilidad — `lib/storage/provider.ts`
```ts
export type StorageProvider = "r2" | "blob" | "fs";

/** Providers configurados por env, en orden de precedencia. `fs` siempre está. */
export function availableProviders(): StorageProvider[] {
  const out: StorageProvider[] = [];
  if (r2ConfigFromEnv() !== null) out.push("r2");
  if (process.env.BLOB_READ_WRITE_TOKEN) out.push("blob");
  out.push("fs");
  return out;
}

export function isStorageProvider(v: unknown): v is StorageProvider;  // "r2"|"blob"|"fs"
```

### 3.2 Preferencia en KV — `lib/storage/preference.ts`
Espeja `lib/host-contract/store.ts` (valor único bajo una key, KV en prod / JSON fs en dev).
```ts
export interface StoragePreferenceStore {
  load(): Promise<StorageProvider | null>;   // null = sin override
  save(p: StorageProvider): Promise<void>;
}
export const jsonStoragePreferenceStore: StoragePreferenceStore; // data/storage-provider.json
export function kvStoragePreferenceStore(client: KvClient): StoragePreferenceStore; // key "storage-provider"
export function getStoragePreferenceStore(): StoragePreferenceStore; // env-selected (KV vs fs)
```
- Persistencia: en KV guarda la string cruda (`"r2"`); al leer, valida con
  `isStorageProvider` y devuelve `null` si el valor guardado no es válido (defensivo).
- Key KV: `storage-provider`. Archivo dev: `data/storage-provider.json` (`{ "provider": "r2" }`).

### 3.3 `getStorage()` async — `lib/storage/index.ts`
```ts
export async function getStorage(): Promise<ChunkStorage> {
  const pref = await getStoragePreferenceStore().load();
  const available = availableProviders();
  const chosen = pref !== null && available.includes(pref) ? pref : available[0];
  return buildStorage(chosen);  // "r2" → r2Storage(r2ConfigFromEnv()!), "blob" → blobStorage(), "fs" → fsStorage()
}
```
- `available[0]` es el primero por env-order (R2 si está, si no Blob, si no fs) → mismo
  comportamiento que la Fase A cuando no hay preferencia.
- `buildStorage(p)` es un helper interno; para `"r2"` usa `r2ConfigFromEnv()` (que no es
  null porque `availableProviders` ya lo verificó).
- **Efectivo vs preferencia:** el provider que realmente se usa es `chosen`. El endpoint
  GET lo expone como `active`, y `source` = `"preference"` si `chosen === pref`, si no `"env"`.

### 3.4 Endpoint — `app/api/storage-provider/route.ts`
`runtime = "nodejs"`.
- **GET** → `200 { available: StorageProvider[], active: StorageProvider, source: "preference" | "env" }`.
  `active`/`source` se computan igual que en `getStorage` (sin construir el storage).
  Público a cualquier sesión (solo lee estado; no expone secretos). *(Ver §6: el control solo
  se muestra a admins, pero el GET no filtra — no hay nada sensible en la respuesta.)*
- **PUT** `{ provider: StorageProvider }`:
  - Guard `canScaffold` (lazy `import("@/auth")`, como el DELETE) → 403 si no.
  - `400` si `provider` no es válido o no está en `availableProviders()`
    (no se puede activar algo sin creds).
  - Guarda la preferencia → `200 { provider, active: provider, source: "preference" }`.

### 3.5 UI — `app/components/StorageProviderControl.tsx`
Client component (`"use client"`). Props: `{ available: StorageProvider[], active: StorageProvider, source: string }`.
- Radios con los `available` (label legible: `r2`→"Cloudflare R2", `blob`→"Vercel Blob", `fs`→"Local (dev)").
- Botón **Guardar** → `PUT /api/storage-provider` con el elegido; on-success muestra "Guardado" y refresca (`router.refresh()`).
- Muestra el activo actual. Deshabilita Guardar si el elegido == active.
- Montaje: en `app/catalog/page.tsx`, arriba del `console`, **solo si `canScaffold(session?.githubLogin, ...)`**.
  La page (server component) hace el GET del estado vía la función compartida (no fetch a sí misma)
  y pasa las props. Presentational-only el componente; la data la arma el server.

## 4. Data flow

```
Admin abre /catalog (server)
  → availableProviders() + active/source (server, funciones puras sobre env + KV)
  → si canScaffold: <StorageProviderControl available active source />
Admin cambia radio + Guardar
  → PUT /api/storage-provider { provider }  (canScaffold, valida disponible)
  → guarda pref en KV
  → router.refresh() → la page recomputa active/source
Próximo publish
  → upload route: (await getStorage()).putMany(...)  → lee pref → provider activo
```

## 5. Manejo de errores
- PUT con provider inválido / no disponible → 400 (`errorBody`/`statusForError`, como el resto).
- PUT sin admin → 403 (`ScaffoldForbiddenError`).
- KV caído en GET → que propague (500); el catálogo ya depende de KV para el registry,
  así que no es un modo de falla nuevo.
- Preferencia guardada apunta a un provider que perdió sus creds → `getStorage` la ignora
  y cae al env-order (no rompe el publish). El GET reflejará `source: "env"` (el activo real).

## 6. Seguridad
- **PUT** protegido por `canScaffold` (admin allowlist). Es la única mutación.
- **GET** no expone secretos (solo nombres de providers y cuál está activo) → sin guard.
- El **control UI** se renderiza solo para admins (evita mostrar un control que daría 403).
- Ningún endpoint devuelve creds ni tokens.

## 7. Testing
- **`availableProviders`**: con R2 vars → incluye "r2"; con BLOB token → "blob"; siempre "fs"; orden R2,Blob,fs.
- **`isStorageProvider`**: acepta "r2"/"blob"/"fs", rechaza otro/undefined.
- **preference store** (con KvClient in-memory): `save`+`load` round-trip; `load` de valor
  inválido → null; `load` sin nada → null.
- **`getStorage`** (async, mockeando provider/preference/adapters): pref válida y disponible →
  ese provider; pref no disponible → env-order[0]; sin pref → env-order[0].
- **endpoint GET**: shape `{available, active, source}`; con pref → source "preference"; sin → "env".
- **endpoint PUT**: 200 + persiste (admin); 403 sin admin (no persiste); 400 provider no disponible.
- **StorageProviderControl**: renderiza un radio por `available`; Guardar deshabilitado si elegido==active.

## 8. Fuera de alcance (YAGNI)
- **Migrar chunks** entre providers al cambiar — los ya publicados quedan donde están
  (sus URLs siguen en el registry); cada re-publish usa el provider activo.
- **Otros settings de plataforma** (host contract, tokens, etc.) — esto es solo storage;
  una `/settings` dedicada queda para cuando haya ≥2 settings que justifiquen la página.
- **Historial / auditoría** del cambio de provider.
