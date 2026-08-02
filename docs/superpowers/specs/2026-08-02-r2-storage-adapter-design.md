# Adapter de storage R2 (Fase A) — Diseño

**Fecha:** 2026-08-02
**Estado:** Diseño aprobado — listo para plan de implementación
**Owner:** DentVega

## 1. Contexto y objetivo

El store de **Vercel Blob** quedó pausado 30 días por agotar el free tier (2.000
operaciones). Eso bloquea todo publish de chunks (y por ende el backfill + el rollout
de los compat gates). Necesitamos un backend de storage alternativo que **no tenga ese
límite de operaciones**: **Cloudflare R2** (S3-compatible, free tier generoso, sin
pausa por operaciones).

El código ya tiene la abstracción correcta — `ChunkStorage` (`lib/storage/types.ts`)
con `putMany(prefix, files) → { baseUrl }`, y `getStorage()` env-selected
(`lib/storage/index.ts`). Agregar R2 es **un adapter más** detrás de esa interfaz.

**Esta es la Fase A** (el adapter + selección por env). La **Fase B** (elegir el
provider desde la UI de Backstage, con una preferencia en KV) es un esfuerzo posterior.

## 2. Decisiones tomadas

1. **Cliente S3:** `aws4fetch` (~5KB, fetch-native, firma S3 v4 — el que Cloudflare
   recomienda para R2). Única dep nueva.
2. **Se mantienen ambos:** `getStorage()` elige **R2 (si hay creds) → Blob → fs**. Blob
   vuelve en 30 días; mantenerlo = flexibilidad + habilita la Fase B (swappable).
3. **Dos URLs distintas en R2:** escritura autenticada al endpoint S3
   (`{accountId}.r2.cloudflarestorage.com`), lectura pública por la URL pública del
   bucket (`pub-xxx.r2.dev` o dominio propio). El adapter **escribe** en la primera y
   **devuelve la segunda** como `baseUrl`.

## 3. El adapter (`lib/storage/r2.ts`)

### 3.1 Config
```ts
export interface R2Config {
  readonly accountId: string;        // R2_ACCOUNT_ID
  readonly accessKeyId: string;      // R2_ACCESS_KEY_ID
  readonly secretAccessKey: string;  // R2_SECRET_ACCESS_KEY
  readonly bucket: string;           // R2_BUCKET
  readonly publicBaseUrl: string;    // R2_PUBLIC_BASE_URL (para las lecturas)
}
export function r2ConfigFromEnv(): R2Config | null;  // null si falta alguna de las 5
```

### 3.2 Cliente inyectable (testeable)
```ts
/** Lo mínimo que el adapter necesita — aws4fetch AwsClient lo cumple. */
export interface SignedFetch {
  fetch(url: string, init: { method: string; body: Uint8Array; headers?: Record<string, string> }): Promise<{ ok: boolean; status: number }>;
}
```
En prod: `new AwsClient({ accessKeyId, secretAccessKey, service: "s3", region: "auto" })`.
En tests: un fake que registra las llamadas y devuelve `{ ok: true, status: 200 }`.

### 3.3 `r2Storage`
```ts
export function r2Storage(config: R2Config, client?: SignedFetch): ChunkStorage;
```
`putMany(prefix, files)`:
- Si `files.length === 0` → `throw new StorageError("no files to upload")`.
- Endpoint S3: `https://${accountId}.r2.cloudflarestorage.com/${bucket}`.
- Por cada file: `client.fetch(`${s3}/${prefix}/${file.path}`, { method: "PUT", body: file.data, headers: { "content-type": contentType(file.path) } })`. Si `!res.ok` → `throw new StorageError(`R2 PUT failed: HTTP ${res.status}`)`.
- Devuelve `{ baseUrl: `${publicBaseUrl.replace(/\/+$/, "")}/${prefix}` }`.
- **Idempotente:** el PUT de S3 sobrescribe por defecto (mismo comportamiento que Blob
  con `allowOverwrite`) → re-publicar `<id>/<version>` no rompe.

`contentType(path)`: helper mínimo — `.js`/`.bundle` → `application/javascript`,
`.json` → `application/json`, si no `application/octet-stream`. (El host descarga bytes
por `fetch`; el content-type es cosmético para RN, pero lo seteamos correcto.)

## 4. Selección (`lib/storage/index.ts`)

```ts
export function getStorage(): ChunkStorage {
  const r2 = r2ConfigFromEnv();
  if (r2 !== null) return r2Storage(r2);
  if (process.env.BLOB_READ_WRITE_TOKEN) return blobStorage();
  return fsStorage();
}
```
R2 tiene precedencia si sus 5 vars están; si no, Blob; si no, fs (dev). Comportamiento
existente intacto cuando R2 no está configurado.

## 5. Env vars (setear en Vercel prod)
```
R2_ACCOUNT_ID          # Account ID de Cloudflare
R2_ACCESS_KEY_ID       # token S3 API de R2
R2_SECRET_ACCESS_KEY   # idem (sensible)
R2_BUCKET              # nombre del bucket
R2_PUBLIC_BASE_URL     # https://pub-xxx.r2.dev (o dominio propio) — SIN barra final necesaria
```
Prep en Cloudflare: crear bucket → habilitar acceso público (da el `pub-xxx.r2.dev`) →
crear token S3 API (Access Key + Secret) → anotar el Account ID.

## 6. Dependencia
- Agregar `aws4fetch` (runtime dep de backstage-web). Nada más.

## 7. Testing
- **`r2ConfigFromEnv`**: devuelve la config con las 5 vars; `null` si falta alguna.
- **`contentType`**: `.bundle`→js, `.json`→json, otro→octet-stream.
- **`r2Storage.putMany`** (con `SignedFetch` fake):
  - 0 files → `StorageError`.
  - N files → hace N PUTs a `{s3}/{bucket}/{prefix}/{path}` (verificar las URLs + method PUT + body).
  - devuelve `baseUrl = {publicBaseUrl}/{prefix}` (con trailing slash del publicBaseUrl limpiado).
  - un PUT `!ok` → `StorageError` con el status.
- **`getStorage`**: con las R2 vars presentes → r2Storage; sin R2 pero con BLOB token → blobStorage; sin nada → fsStorage. (Mockear los env + los constructores si hace falta.)

## 8. Fuera de alcance (Fase B / YAGNI)
- **Selección desde la UI de Backstage** (preferencia `storageProvider` en KV + endpoints
  `GET/PUT /api/storage-provider` + toggle admin) — es la **Fase B**, un esfuerzo aparte.
  Este diseño deja la selección por env; la Fase B agrega el override por UI **encima**
  de este `getStorage()` sin romperlo.
- **Migrar los chunks existentes de Blob a R2** — los chunks viejos siguen en Blob (con
  sus URLs en el registry); los nuevos van a R2. Re-publicar una miniapp la mueve a R2.
  Una migración masiva no hace falta (cada re-publish la mueve).
- **URLs firmadas / acceso privado** — los chunks son públicos (integridad por sha256),
  igual que hoy con Blob. R2 con acceso público.
- **Adapter de Zephyr** — futuro; entra por la misma interfaz (ver notas de sesión).
