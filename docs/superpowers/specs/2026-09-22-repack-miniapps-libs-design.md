# Librerías públicas para plataformas de miniapps Re.Pack — Design

> **Estado:** aprobado (brainstorming 2026-09-22). Próximo paso: writing-plans.

## Problema

Hoy la plataforma de miniapps existe como **tres repos acoplados entre sí**: el control-plane
(`backstage-web`), el host RN (`backstagereactnative`) y el template de miniapps
(`miniapp-template`). Nada de eso es instalable por un tercero. Quien quiera montar una
plataforma de miniapps sobre Re.Pack tiene que clonar y adaptar, no instalar.

Dos consecuencias concretas:

1. **El storage está atrapado.** `lib/storage/` soporta Cloudflare R2, Vercel Blob y fs. Agregar
   Google Cloud, AWS o Azure hoy significa tocar `backstage-web` — y el resultado no le sirve a
   nadie más, aunque el código no tenga nada de específico de backstage-web.
2. **El runtime mobile está atrapado.** `@dentvega/host-runtime` encapsula la lógica portable de
   resolve → verify → mount → fallback (más el dev-loop), pero se consume como fuente TypeScript
   por workspace: `"main": "src/index.ts"`, sin build ni `dist`. No es publicable.

## Objetivo

Extraer la plataforma a **librerías públicas instalables por npm** (MIT), de modo que cualquier
proyecto Re.Pack pueda adoptar esta forma de publicar y correr miniapps sin clonar los repos. En
el camino, ampliar el storage a **Google Cloud Storage, AWS S3 y Azure Blob Storage**, que fue el
disparador original.

## Decisiones (del brainstorming)

1. **Opción 2 — storage genérico, dominio afuera.** La librería de storage no sabe qué es una
   miniapp: ve `prefix` + archivos. El conocimiento de `<id>/<version>`, prune y firma se queda
   en el control-plane. Se respeta la abstracción que el código ya tiene, no se inventa una nueva.
2. **Un monorepo público**, `pnpm` workspace, espejando `backstagereactnative`.
3. **Scope `@dentvega` en npm** (hoy no existe: `Scope not found` — está libre).
4. **MIT.**
5. **Historia limpia** — commit inicial nuevo, sin arrastrar el historial de los repos privados.
6. **Tres packages, no dos.** La cadena de dependencias lo obliga: `miniapp-runtime` depende de
   `miniapp-contract`, así que el contract tiene que ser público o nadie puede instalar el runtime.
7. **El runtime no exporta el design system.** `MiniappHost` pasa a headless (recibe los
   componentes de render por props). `@dentvega/ui-kit` **no se publica**.
8. **Azure autentica con SAS token** como camino inicial (cero código de firma). SharedKey queda
   documentado como extensión futura.

## Arquitectura

Monorepo público `dentvega/repack-miniapps`:

```
repack-miniapps/
  packages/
    miniapp-contract/   → @dentvega/miniapp-contract   (ya existe, se mueve)
    miniapp-storage/    → @dentvega/miniapp-storage    (NUEVO, extraído de backstage-web)
    miniapp-runtime/    → @dentvega/miniapp-runtime    (ex host-runtime, se empaqueta)
  LICENSE               (MIT)
  README.md
```

Versionado **independiente** por package. Tooling, CI y docs compartidos.

### Por qué esta línea de corte

Los imports externos de `lib/storage/` marcan la frontera solos:

```
r2.ts         → aws4fetch                   (npm)
blob.ts       → @vercel/blob                (npm)
fs.ts         → node:fs, node:path          (stdlib)
types.ts      → (nada)
provider.ts   → (nada)
mock.ts       → (nada)
preference.ts → @/lib/registry/kv           ← ÚNICO acoplado a backstage-web
```

Seis de siete archivos no conocen nada de backstage-web. El séptimo, `preference.ts`, persiste la
preferencia de provider en Upstash KV — y por eso **no viaja**: llevárselo le impondría Upstash a
todo el que instale la librería.

## Package 1 — `@dentvega/miniapp-contract`

Ya existe y está maduro (0.4.0, ESM, build con `tsc`, `files: ["dist"]`). **No cambia su código.**
Cambian tres cosas de empaquetado:

- `license`: `UNLICENSED` → `MIT`.
- `publishConfig.registry`: `npm.pkg.github.com` → npm público; `access`: `restricted` → `public`.
- Se mueve al repo nuevo.

**Coordinación requerida:** `backstage-web` lo consume hoy como `^0.4.0` desde GitHub Packages, y
el host lo consume por workspace. Ambos tienen que apuntar al package público. Es el único cambio
de este spec que toca un repo ya en producción de forma no-aditiva.

## Package 2 — `@dentvega/miniapp-storage`

### Superficie pública

```ts
export interface StorageFile {
  readonly path: string;        // ruta dentro del prefijo versionado
  readonly data: Uint8Array;
}

export interface ChunkStorage {
  putMany(prefix: string, files: readonly StorageFile[]): Promise<{ baseUrl: string }>;
  deletePrefix(prefix: string): Promise<void>;
}

export class StorageError extends Error { readonly code = "STORAGE_ERROR" }

// Fetch inyectable (el patrón que r2.ts ya usa para testear sin red).
// SignedFetch lo provee aws4fetch en prod; PlainFetch es el fetch global (Azure firma por SAS).
export type SignedFetch = (url: string, init: FetchInit) => Promise<FetchResponse>;
export type PlainFetch  = SignedFetch;

// Adapters
export function s3Storage(config: S3Config, fetchImpl?: SignedFetch): ChunkStorage;
export function r2Storage(config: R2Config, fetchImpl?: SignedFetch): ChunkStorage;
export function gcsStorage(config: GcsConfig, fetchImpl?: SignedFetch): ChunkStorage;
export function azureStorage(config: AzureConfig, fetchImpl?: PlainFetch): ChunkStorage;
export function blobStorage(token?: string): ChunkStorage;   // subpath export
export function fsStorage(baseOrigin?: string): ChunkStorage;
export function mockStorage(): ChunkStorage & { puts: PutCall[]; deletes: string[] };

// Selección — puras, sin persistencia
export type StorageProvider = "s3" | "r2" | "gcs" | "azure" | "blob" | "fs";
export function availableProviders(env: NodeJS.ProcessEnv): StorageProvider[];
export function selectStorage(
  available: readonly StorageProvider[],
  preference: StorageProvider | null,
  override: StorageProvider | null,
): StorageProvider;
export function isStorageProvider(v: unknown): v is StorageProvider;
```

### El núcleo: generalizar `r2.ts` a `s3Compatible`

`lib/storage/r2.ts` **ya habla S3 SigV4 puro** vía `aws4fetch` (`service: "s3"`, `region: "auto"`).
R2 no es un caso especial: es un bucket S3 con otro hostname. Se extrae un motor común:

```ts
interface S3CompatConfig {
  endpoint: string;         // URL base del bucket, ya resuelta
  region: string;           // "auto" para R2/GCS; región real para AWS
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;    // de dónde LEE el host (puede ser otro host que el de escritura)
  pinContentLength?: boolean;
}
```

y los tres providers pasan a ser configuraciones de ese motor:

| Provider | endpoint | region | credenciales |
|---|---|---|---|
| R2 | `https://<account>.r2.cloudflarestorage.com/<bucket>` | `auto` | Account API token |
| AWS S3 | `https://<bucket>.s3.<region>.amazonaws.com` | región real | IAM access key |
| GCS | `https://storage.googleapis.com/<bucket>` | `auto` | claves HMAC (interoperabilidad) |

Efecto colateral gratis: MinIO, Backblaze B2, DigitalOcean Spaces y Wasabi quedan soportados sin
código adicional, porque todos hablan el mismo protocolo.

**Dos comportamientos de R2 que se preservan como config, no como default:**

- `pinContentLength` — R2 rechaza uploads chunked con HTTP 411, y el `fetch` parcheado de Next
  puede convertir un buffer en stream. R2 lo necesita; AWS no. Pasa a ser un flag de config con el
  comentario que explica por qué.
- El parseo de `ListObjectsV2` por regex sobre `<Key>` se mantiene (sin dep de XML), pero se mueve
  al motor compartido.

### Azure: el único adapter genuinamente nuevo

Azure Blob **no es S3-compatible**. Necesita adapter propio:

- **Escritura:** `PUT https://<account>.blob.core.windows.net/<container>/<prefix>/<path>?<SAS>`
  con header `x-ms-blob-type: BlockBlob`.
- **Listado:** `GET .../<container>?restype=container&comp=list&prefix=<prefix>/&<SAS>`, parseando
  los `<Name>` del XML (mismo enfoque regex que S3).
- **Borrado:** `DELETE` por blob.
- **Auth:** el SAS token va como querystring → **cero código de firma**. Es la razón de elegirlo
  como camino inicial.

### Reglas de empaquetado

- **`@vercel/blob` pasa a `peerDependency` opcional** + export por subpath
  (`@dentvega/miniapp-storage/vercel-blob`). Quien no use Vercel no lo instala.
- **`aws4fetch` es dependencia normal** — es minúscula y la usan tres de los seis adapters.
- **Cero deps para Azure y fs** (`fetch` global + `node:fs`).
- **La persistencia no entra.** La librería exporta la interfaz y las funciones puras de
  selección; el consumidor inyecta su store. Es el mismo patrón que `r2.ts` ya usa con
  `SignedFetch` inyectable para los tests.

## Package 3 — `@dentvega/miniapp-runtime`

Renombre de `@dentvega/host-runtime`. **Se lleva lo portable, que es casi todo:**

`useMiniapp`, `loaderState`, `ResolveClient`, `cachingResolveClient`, `devResolveClient`
(el dev-loop Modo 2), `CatalogClient`, `ChunkLoader`, `integrity`, `sha256`, `base64url`,
`signature`, `signatureGate`, `signatureMessage`, `trustBundle`, `evaluate`, `MetricsClient`.

### Trabajo de empaquetado (no es publicar y listo)

Hoy `package.json` dice `"main": "src/index.ts"`, sin `build`, sin `dist`, sin `files`, sin
`publishConfig`. Hay que agregarlos copiando lo que ya hace `miniapp-contract`:
`tsc -p tsconfig.build.json` → `dist`, `exports`, `files: ["dist"]`, `prepack`.

`react` y `react-native` siguen como `peerDependencies`. `@noble/curves` sigue como dependencia
(la verificación de firma Ed25519 la necesita).

### `MiniappHost` headless

`MiniappHost.tsx` hoy renderiza los estados de carga/error con `@dentvega/ui-kit`. Publicarlo así
le impone el design system a quien lo instale. Pasa a recibir los componentes de render por props:

```ts
interface MiniappHostProps {
  // ...lo existente
  render?: {
    loading?: ComponentType<{ retrying: boolean }>;
    error?: ComponentType<{ reason: FallbackReason; retryable: boolean; onRetry: () => void }>;
  };
}
```

Sin `render`, cae a primitivas RN crudas (`View`/`Text`) — funcional y sin estilo propio.
`@dentvega/ui-kit` **no se publica**: se queda en `backstagereactnative`, que pasa a inyectar sus
componentes. Re.Pack / Module Federation sigue afuera: el consumidor inyecta su `ChunkLoader`,
igual que hoy.

## Migración de `backstage-web`

Aditiva y verificable:

1. `lib/storage/{types,r2,blob,fs,mock,provider}.ts` se borran; sus consumidores pasan a importar
   de `@dentvega/miniapp-storage`.
2. `lib/storage/preference.ts` **se queda** (es el acoplamiento con Upstash KV).
3. `lib/storage/index.ts` se queda como capa fina: lee la preferencia local y llama a
   `selectStorage()` de la librería. `getStorage()`, `getStorageProviderState()` y
   `getMiniappStorageState()` mantienen su firma → **los ~19 archivos que hoy consumen
   `lib/storage` no cambian**, salvo el import en los tests de storage.
4. Los tests de `lib/storage/__tests__/` se mudan al package nuevo y son la red de seguridad de
   que la extracción no cambió comportamiento.
5. La UI del selector de provider gana las opciones nuevas (`s3`, `gcs`, `azure`) — el tipo
   `StorageProvider` crece, y `availableProviders()` las expone solo si hay env configurado.

## Orden de implementación

El alcance es grande para un solo plan. Se implementa en **cuatro fases**, cada una verificable y
sin romper lo que está en producción. Cada fase puede ser su propio plan de implementación:

1. **Repo + contract.** Monorepo público, MIT, tooling y CI. Se mueve `miniapp-contract` tal cual
   y se publica a npm. `backstage-web` y el host pasan a consumirlo desde ahí.
   *Verificable:* los dos repos instalan y sus suites siguen verdes.
2. **`miniapp-storage` a paridad.** Se extraen los adapters actuales (R2, Blob, fs, mock) y se
   generaliza `s3Compatible`, **sin agregar providers nuevos**. Se migra `backstage-web`.
   *Verificable:* la suite completa de `backstage-web` verde y un publish real a R2 sigue andando.
3. **Providers nuevos.** AWS S3, GCS y Azure sobre la base de la fase 2, más la UI del selector.
   *Verificable:* tests unitarios por provider + validación manual contra un bucket real de cada uno.
4. **`miniapp-runtime`.** Empaquetado, `MiniappHost` headless, inyección de `ui-kit` desde el host.
   *Verificable:* la app host sigue montando miniapps en device, y su suite queda verde.

El disparador original (Google Cloud / AWS / Azure) se cumple al terminar la fase 3; la fase 4 es
independiente y puede posponerse sin bloquear nada.

## Higiene para repo público

Hacer público es irreversible en la práctica (forks, caches, índices). Antes del primer push:

- **Commit inicial limpio**, sin historial de los repos privados.
- **Auditoría de contenido:** ni URLs internas, ni nombres de buckets, ni tokens, ni cuentas, ni
  referencias a clientes o prospectos. Los ejemplos usan placeholders.
- **`LICENSE` MIT en la raíz** y `license: "MIT"` en los tres `package.json`.
- **Sin `.env` ni fixtures con credenciales reales** en los tests (los actuales ya usan fakes).

## Testing

Se hereda la estrategia que ya funciona en `lib/storage/__tests__/`: **los adapters se testean
contra un `fetch` inyectado**, sin red.

- `s3Compatible`: PUT por archivo, URL y headers correctos, `pinContentLength` on/off, baseUrl
  devuelta, ListObjectsV2 → DELETE en `deletePrefix`, errores → `StorageError`.
- Por provider: que la config produzca el endpoint correcto (una tabla de casos).
- Azure: `x-ms-blob-type`, SAS en la querystring, parseo del XML de listado.
- `selectStorage` / `availableProviders`: funciones puras, tabla de casos.
- `miniapp-runtime`: los tests existentes se mantienen; se suman los de `MiniappHost` headless
  (con y sin `render`).
- `backstage-web`: la suite actual completa tiene que seguir verde tras la migración. Ese es el
  criterio de aceptación de la extracción.

## Limitaciones conocidas

- **GCS por interoperabilidad usa claves HMAC estáticas.** Funciona y es barato, pero muchas
  organizaciones grandes las prohíben en favor de workload identity. Si aparece esa exigencia,
  hace falta un adapter nativo (JSON API + service account + JWT RS256). Documentado, no construido.
- **Validación end-to-end por proveedor es manual.** Los tests unitarios cubren el protocolo; que
  un bucket real de AWS/GCS/Azure acepte las escrituras hay que probarlo con credenciales vivas,
  una vez por proveedor.
- **El control-plane sigue siendo proxy de bytes.** El chunk viaja miniapp → backstage → bucket, y
  se paga el tránsito dos veces. Este spec **no** lo cambia, pero la interfaz `ChunkStorage` no
  cierra la puerta a agregar `presignPut()` más adelante.

## Fuera de alcance (YAGNI)

- Adapter nativo de GCS con service account.
- Azure con SharedKey HMAC (el SAS alcanza).
- Presigned URLs / upload directo desde el CI de la miniapp (cambiaría el modelo A → B).
- Publicar `@dentvega/ui-kit`.
- Extraer el control-plane entero como librería (registry, resolve, auth).
- Migrar `miniapp-template` a consumir las librerías — sus `scripts/*.mjs` no pueden traer deps
  externas (el package.json es miniapp-owned y no propaga por template-sync).
