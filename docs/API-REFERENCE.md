# API & Schema Reference

> Referencia técnica de la API HTTP de **backstage-web** (el control-plane). Pensada
> para quien integra: el host móvil (distribución), CI de una miniapp (publish) o un
> operador humano (gestión vía UI/API).
>
> Base URL: **`https://<tu-proyecto>.vercel.app`** (o tu propio deploy).
> Todos los endpoints son JSON salvo `upload`, que es `multipart/form-data`.
> Todos corren en `runtime = "nodejs"`.

---

## 1. Auth, en 3 modelos

| Modelo | Cómo | Quién | Usado por |
|---|---|---|---|
| **Público** | sin auth | cualquiera | `GET /api/resolve`, `GET /api/host-contract`, `GET /api/miniapps`, `GET /api/storage-provider`, `GET /api/trust-bundle`, `POST/GET /api/metrics` |
| **Token de servicio** | `Authorization: Bearer <TOKEN>` | CI (miniapp o host) | `POST /api/miniapps/:id/upload` (`PUBLISH_TOKEN`), `PUT /api/trust-bundle` (`PUBLISH_TOKEN`, o sesión admin), `PUT /api/host-contract` (`HOST_CONTRACT_TOKEN`) |
| **Sesión (NextAuth + GitHub)** | cookie de sesión | operador humano allowlisted | scaffold, deploy, sync-template, pin, maintainers, public-key, storage-provider, trust-bundle (PUT), DELETE/PATCH miniapp, admin/* |

> [!NOTE]
> `upload` acepta **sesión O token** (`authorizeUpload`): usuario allowlisted o
> `PUBLISH_TOKEN` válido — CI y la UI comparten el mismo endpoint.

Dentro del modelo de sesión hay dos niveles (`lib/scaffold-authz.ts`):

- **`canScaffold`** — login en `SCAFFOLD_ALLOWED_LOGINS` (CSV, case-insensitive). Fail-closed: allowlist vacía o sin login ⇒ nadie puede. Requerido para crear miniapps y para `admin/*`.
- **`canManageMiniapp`** — `canScaffold` (platform-admin) **∪** estar en `maintainers` de esa miniapp. Requerido para gestionar una miniapp existente.

`PUBLISH_TOKEN` rota sin downtime: además del primario, acepta los listados en
`PUBLISH_TOKENS_OLD` (CSV). Comparación en tiempo constante (sha256 + `timingSafeEqual`).

### Códigos de error transversales

| HTTP | Cuándo |
|---|---|
| 401 | `AuthError` — falta o es inválido el Bearer token |
| 403 | `ScaffoldForbiddenError` — sesión válida pero sin permiso (no admin, no maintainer) |

Body de error estándar (`errorBody`, `lib/http.ts`):

```json
{ "error": "mensaje humano", "code": "OPTIONAL_MACHINE_CODE" }
```

`code` solo aparece si el error lanzado es un error de dominio tipado (ver §8 para
la tabla completa código → status).

---

## 2. Distribución — lo que usa el host

### `GET /api/resolve`

El host pregunta "¿qué monto para `id`?". Público, sin auth.

**Query params**

| Param | Tipo | Requerido | Notas |
|---|---|---|---|
| `id` | string | sí | id de la miniapp |
| `version` | string | no | versión exacta; ignora `range` si viene |
| `range` | string | no | rango semver (ej. `^1.2.0`); resuelve la más alta compatible |
| `platform` | `"ios"` | no | cualquier otro valor (o ausente) = Android |

Precedencia de resolución (sin `version` ni `range`): **`pinnedVersion`** de la
miniapp si existe → si no, la última versión publicada (`selectLatest`).

**200 — `ResolveResponse`**

```json
{
  "id": "acc",
  "version": "1.2.0",
  "url": "https://.../acc/1.2.0/acc.container.js.bundle",
  "manifest": {
    "id": "acc",
    "version": "1.2.0",
    "entry": "./Entry",
    "shared": [{ "name": "react-native", "requiredRange": "^0.74.0", "singleton": true }],
    "capabilities": ["accounts:read"],
    "integrity": "sha256-...",
    "signature": "base64url..."
  }
}
```

`manifest.signature` aparece solo si la versión se publicó firmada (firma Ed25519
del chunk, ver §4). El host la verifica contra la pubkey de la miniapp que sale del
[trust bundle](#trust-bundle-firma) (`GET /api/trust-bundle`). Ausente = campo no presente.

Con `platform=ios`, la respuesta usa el chunk iOS (`iosUrl`) y **pisa**
`manifest.integrity` con `iosIntegrity` (y `manifest.signature` con `iosSignature`
si la hay — el manifest sigue siendo el de Android en todo lo demás; iOS nunca crea
un manifest propio).

```bash
curl "https://<tu-proyecto>.vercel.app/api/resolve?id=acc&range=%5E1.0.0&platform=ios"
```

**Errores**

| HTTP | Code | Causa |
|---|---|---|
| 400 | — | falta `id` (sin `code`, respuesta ad-hoc) |
| 404 | `MINIAPP_NOT_FOUND` | el id no está registrado |
| 404 | `NO_COMPATIBLE_VERSION` | no hay versiones publicadas / `version` no existe / nada satisface `range` / se pidió `platform=ios` pero esa versión no tiene chunk iOS |

> [!WARNING]
> `NO_COMPATIBLE_VERSION` también mapea a **404**, no a 422 — revisá el `code` del
> body, no solo el status, si tu cliente necesita distinguir "miniapp inexistente"
> de "sin versión compatible".

### `GET /api/host-contract`

Manifiesto vigente del host (versión de RN, shared deps, native modules). Público.

**200**

```json
{
  "contractVersion": "1.3.0",
  "reactNative": "0.74.5",
  "shared": { "react-native": "0.74.5", "react": "18.3.1" },
  "nativeModules": ["expo-secure-store", "react-native-mmkv"]
}
```

**404** — `{ "error": "no host contract published" }` (sin `code`) si nunca se publicó.

### `PUT /api/host-contract`

Publica el contract. Solo el CI del host (token dedicado, no `PUBLISH_TOKEN`).

**Auth**: `Authorization: Bearer <HOST_CONTRACT_TOKEN>` (`requireHostContractToken`).

**Body**: un `HostContract` completo — se valida con `isHostContract` (shape check).

**200** — `{ "ok": true, "contractVersion": "1.3.0" }`
**400** — JSON inválido o shape inválido (sin `code`).
**401** — token ausente/incorrecto (`AuthError`).

### `GET /api/manifests`

Manifest vigente (el de la última versión) de **cada** miniapp registrada. Público. Lo
consume el gate de gobernanza del host (blast-radius): `check-host-compat` compara un cambio
de deps del host contra estos manifests para no romper la flota ya publicada.

**200** — `{ "manifests": [ <Manifest>, … ] }` (ver el schema `Manifest` en §8).

---

## 3. Catálogo

### `GET /api/miniapps`

Lista todas las miniapps registradas. Público.

**200**

```json
{
  "miniapps": [
    {
      "id": "acc",
      "name": "Account Dashboard",
      "owner": "team-accounts",
      "latestVersion": "1.2.0",
      "servedVersion": "1.1.0",
      "versionCount": 3,
      "createdAt": "2026-01-10T12:00:00.000Z",
      "repoUrl": "https://github.com/org/miniapp-acc"
    }
  ]
}
```

`servedVersion` es `pinnedVersion ?? latestVersion` — la que el host realmente
recibe hoy de `/api/resolve`; puede diferir de `latestVersion` si hay un rollback
activo.

### `POST /api/miniapps`

Registra una miniapp **sin** crear repo (a diferencia de `/api/scaffold`). Sin auth
gate en el handler — uso interno/scripting, no expuesto en la UI.

**Body**: `{ "id": string, "name": string, "owner": string }` — los 3 requeridos.

**201** — `{ "id": "acc" }`
**400** — falta algún campo (sin `code`).
**409** — `MINIAPP_EXISTS` si el id ya existe.

> [!NOTE]
> No hay `GET /api/miniapps/:id` en JSON — el detalle (`MiniappDetail`) se
> renderiza server-side en `app/miniapp/[id]/page.tsx` vía `getMiniappDetail(reg, id)`.
> Los endpoints de gestión (pin, maintainers, DELETE versión) sí devuelven ese
> mismo shape en su respuesta — úsalos para obtener el detalle sin GET dedicado.

---

## 4. Publicar

### `POST /api/miniapps/:id/upload`

Publica un build (chunk + manifest). El endpoint central de CI (ADR-015).

**Auth**: sesión allowlisted (`canScaffold`) **o** `Bearer <PUBLISH_TOKEN>`.

**Body**: `multipart/form-data`

| Campo | Tipo | Requerido | Notas |
|---|---|---|---|
| `file` | File (zip) | sí | debe contener `<id>.container.js.bundle` en la raíz del zip |
| `version` | string | sí | semver |
| `manifest` | string (JSON) | no | si se omite, se construye uno default desde `id`+`version`+`capabilities` (flujo UI) |
| `capabilities` | string | no | CSV, usado solo cuando `manifest` está ausente |
| `platform` | `"ios"` | no | default `"android"` (back-compat con publish.mjs viejo) |
| `signature` | string | no | firma Ed25519 (base64url) del chunk, producida por el CI de la miniapp con su clave privada; se guarda por plataforma y se sirve en `manifest.signature` (ver [trust bundle](#trust-bundle-firma)) |

El `integrity` (`sha256-...`) se calcula server-side de los bytes reales del
container — nunca se confía en un valor del cliente. Con `platform=android` se
inyecta en `manifest.integrity`; con `platform=ios` el manifest no se toca, el
integrity viaja aparte (`iosIntegrity`) y `/api/resolve?platform=ios` lo inyecta.

La `signature`, si viene, se guarda tal cual (opaca para el server). **Sanity-check
best-effort**: si la miniapp ya tiene una `publicKey` registrada, la firma debe
verificar el mensaje `<id>:<platform>:<integrity>` o el upload se rechaza con **400**
`BAD_SIGNATURE` (feedback temprano; el host es la autoridad final).

**Regla iOS**: solo se puede publicar el chunk iOS de una versión si **ya existe**
el Android de esa misma versión (Android es canónico, iOS se adjunta).

```bash
curl -X POST "https://<tu-proyecto>.vercel.app/api/miniapps/acc/upload" \
  -H "Authorization: Bearer $PUBLISH_TOKEN" \
  -F "file=@build.zip" \
  -F "version=1.2.0" \
  -F "manifest=@manifest.json;type=application/json"
```

**201**

```json
{ "id": "acc", "version": "1.2.0", "url": "https://.../acc/1.2.0/acc.container.js.bundle", "platform": "android" }
```

**Gate de compatibilidad** (contra el Host Contract vigente): chequea skew de
`shared` deps y `nativeModules` no presentes en el host. Default **warn-only**
(loguea, no bloquea). Con `COMPAT_ENFORCE=1`, rechaza con **422**:
```json
{ "error": "incompatible with host contract — ...", "code": "COMPAT_INCOMPATIBLE" }
```
Si detecta `nativeModules` faltantes, abre (o reutiliza) un capability-request
issue en el repo del host — best-effort, nunca bloquea el publish.

**Otros errores**

| HTTP | Code | Causa |
|---|---|---|
| 400 | — | falta `file`/`version`, zip vacío, falta el container, `manifest` no es JSON válido |
| 401 | `UNAUTHORIZED` | ni sesión ni token válidos |
| 404 | `MINIAPP_NOT_FOUND` | el id no existe en el registry |
| 409 | `VERSION_EXISTS` | la versión (para esa plataforma) ya está publicada |
| 400 | `INVALID_MANIFEST` | manifest no cumple el contrato, o `manifest.id`/`manifest.version` no matchean, o se sube iOS sin Android previo |

Tras publicar corre un **prune best-effort** (mantiene las últimas `PRUNE_KEEP`
— default 5 — más la servida/pinneada); si falla, el publish ya quedó guardado.

### `POST /api/miniapps/:id/publish`

Variante **JSON** del `upload`: registra una versión cuyo chunk **ya está hospedado** en
una URL (no sube el archivo). El `upload` de arriba es el camino normal del CI (recibe el
zip y hostea el chunk); este sirve cuando el chunk ya vive en un CDN propio.

**Auth**: igual que `upload` — sesión allowlisted (`canScaffold`) **o** `Bearer <PUBLISH_TOKEN>` (`authorizeUpload`).

**Body**: `{ "version": string, "url": string, "manifest": Manifest }` — los 3 requeridos.

**201** — `{ "id": "acc", "version": "1.2.0" }`
**400** — falta `version`/`url`/`manifest` (sin `code`), o `INVALID_MANIFEST`.
**409** — `VERSION_EXISTS`.

### `POST /api/scaffold`

Crea el repo de la miniapp desde el template + la registra. Auth: sesión con
`canScaffold`.

**Body**: `{ "id": string, "name": string, "owner": string }` (los 3 requeridos).

**201** — `{ "id": "acc", "repoUrl": "https://github.com/org/miniapp-acc" }`
**400** — falta algún campo.
**403** — `FORBIDDEN` si el login no está en `SCAFFOLD_ALLOWED_LOGINS`.
**409** — `MINIAPP_EXISTS` si el id ya está registrado.

---

## 5. Gestión (sesión requerida — admin ∪ maintainer)

Todas las rutas de esta sección exigen `canManageMiniapp` salvo donde se indique
`canScaffold` explícito (admin puro, sin maintainer). El 403 del auth-gate es
`{ "error": "...", "code": "FORBIDDEN" }` (algunas rutas devuelven otros códigos
403 — ver `REPO_DELETE_FAILED` en §5.6).

| Endpoint | Método | Auth | Body | Respuesta 200/201/202 |
|---|---|---|---|---|
| `/api/miniapps/:id/pin` | PUT | admin ∪ maintainer | `{ "version": string \| null }` | `MiniappDetail` |
| `/api/miniapps/:id/maintainers` | PUT | admin ∪ maintainer | `{ "maintainers": string[] }` | `MiniappDetail` |
| `/api/miniapps/:id/public-key` | PUT | admin ∪ maintainer | `{ "publicKey": string \| null }` | `MiniappDetail` |
| `/api/miniapps/:id/collaborators` | GET | admin ∪ maintainer | — | `{ "collaborators": string[] }` |
| `/api/miniapps/:id/storage-provider` | PUT | admin ∪ maintainer | `{ "provider": "r2"\|"blob"\|"fs"\|null }` | estado de storage (ver §5.4) |
| `/api/miniapps/:id/deploy` | POST | admin ∪ maintainer | — | `{ "dispatched": true, "actionsUrl": string }` (202) |
| `/api/miniapps/:id/sync-template` | POST | admin ∪ maintainer | — | `{ "dispatched": true, "actionsUrl": string }` (202) |
| `/api/miniapps/:id/versions/:version` | DELETE | admin ∪ maintainer | — | `MiniappDetail` |
| `/api/miniapps/:id` | DELETE | admin ∪ maintainer | — (query `?repo=true` opcional) | `{ id, deleted: true }` o `{ id, deleted: true, repoDeleted }` |
| `/api/miniapps/:id` | PATCH | admin ∪ maintainer | `{ "repoUrl"?: string, "owner"?: string }` | `{ id, repoUrl, owner }` |
| `/api/storage-provider` | GET | público | — | `{ available, active, source }` |
| `/api/storage-provider` | PUT | **solo admin** (`canScaffold`) | `{ "provider": "r2"\|"blob"\|"fs" }` | `{ provider, active, source: "preference" }` |

### 5.1 Pin (rollback/freeze)

`PUT /api/miniapps/:id/pin` fija la versión que sirve `/api/resolve` por default,
o la libera con `version: null` ("auto = última"). **400** `INVALID_MANIFEST` si
`version` no es string/null o no existe entre las versiones publicadas. **404**
`MINIAPP_NOT_FOUND`.

### 5.2 Maintainers

`PUT /api/miniapps/:id/maintainers` reemplaza la lista completa. **Validación
server-side**: cada login debe ser colaborador real del repo de GitHub de la
miniapp (`repoCollaboratorLogins`) — no basta con mandarlo en el body.

**400** (sin `code`):
```json
{ "error": "estos no tienen acceso al repo: octocat, otro-user" }
```
o, sin `repoUrl` todavía: `"la miniapp no tiene repo para validar acceso; agregá maintainers luego de crear el repo"`.

`GET /api/miniapps/:id/collaborators` alimenta el autocomplete con la misma
fuente — `{ "collaborators": string[] }`, logins en minúscula.

### 5.3 Deploy / sync-template

Ambos disparan un `workflow_dispatch` en el repo de la miniapp
(`dispatchMiniappWorkflow`) y devuelven **202** `{ dispatched: true, actionsUrl }`:

- `deploy` → `ci.yml` (build + publish).
- `sync-template` → `template-sync.yml` (3-way merge, abre PR). Sin secrets propios — corre con `GITHUB_TOKEN`.

### 5.4 Storage provider

`PUT /api/miniapps/:id/storage-provider` fija (o limpia con `null`) el override de
**esa** miniapp. **400** si el provider no está en `availableProviders()` (sin
credenciales ⇒ no disponible).

**200** (`MiniappStorageState`):
```json
{ "available": ["blob", "fs"], "override": "blob", "defaultProvider": "fs", "effective": "blob", "source": "miniapp" }
```
`source` es `"miniapp"` si el override aplica, o el global (`"preference"`/`"env"`) si no.

`PUT /api/storage-provider` (global, no `:id`) cambia el default de toda la
plataforma — **solo admin** (`canScaffold` puro, maintainer no alcanza).
`GET /api/storage-provider` es público: `{ "available": [...], "active": "blob", "source": "preference" }`.

### 5.5 Borrar una versión

`DELETE /api/miniapps/:id/versions/:version` borra el chunk (best-effort) + la
entrada del registry. **Rechaza la versión servida** (`pinnedVersion ?? latest`)
con **400** `INVALID_MANIFEST` — hay que despinnear primero.

### 5.6 Borrar / editar la miniapp

`DELETE /api/miniapps/:id` por default borra solo la entrada del registry. Con
`?repo=true`, además borra el repo de GitHub en orden **repo → registry**
(fail-safe: si el repo no se puede borrar, el registry queda intacto). No borra
los chunks de storage.

**403** `code: "REPO_DELETE_FAILED"` si `?repo=true` y el delete de GitHub falla
(ej. token sin scope `delete_repo`). **400** (sin `code`) si `?repo=true` pero la
miniapp no tiene un `repoUrl` parseable.

`PATCH /api/miniapps/:id` actualiza `repoUrl` y/o `owner`. `repoUrl` se valida
como URL de GitHub real (`parseRepo`) → **400** si no lo es. **400** si no se
manda ningún campo.

### 5.7 Trust bundle (firma) {#trust-bundle-firma}

La firma de chunks suma **autenticidad** sobre el `integrity` (que solo da integridad).
Jerarquía de dos niveles: cada miniapp firma su chunk en su CI con una clave privada
por-repo; el owner firma una tabla `{miniapp → pubkey}` con una clave **root** offline.
El host verifica la firma del chunk contra la pubkey que sale de esa tabla, y la tabla
contra la pubkey root **pineada en el binario**.

`PUT /api/miniapps/:id/public-key` registra (o limpia con `null`) la pubkey de firma
de una miniapp (raw base64url). Admin ∪ maintainer. Es solo conveniencia (UI + borrador
del bundle) — **la autoridad es la tabla firmada**, no este campo.

`GET /api/trust-bundle` (público) sirve la tabla firmada, o **404** si todavía no se
publicó ninguna:

```json
{
  "bundle": {
    "version": 3,
    "updatedAt": "2026-08-26T00:00:00.000Z",
    "keys": { "hellow_widget": "base64url...", "cards_wallet": "base64url..." }
  },
  "signature": "base64url..."
}
```

`bundle.version` es monotónico → el host rechaza un rollback a una versión menor.

`PUT /api/trust-bundle` guarda el bundle que produce la CLI de firma
(`scripts/sign-trust-bundle.mjs`, corre offline con el root private key). **Auth: sesión
admin O `Bearer PUBLISH_TOKEN`** (`authorizeUpload`) — así la CLI publica headless con
`--token`. La **firma root** es el gate real: el server solo almacena. Si `ROOT_PUBLIC_KEY`
está seteada, valida la firma root antes de guardar → **400** `BAD_ROOT_SIGNATURE` si no
verifica. **400** si el body no tiene forma de `SignedTrustBundle`. `GET /api/miniapps`
expone `publicKey` por miniapp (la CLI la lee de ahí para armar la tabla).

---

## 6. Observabilidad

### `POST /api/metrics`

Ingest de eventos del host móvil. **Público, best-effort — siempre devuelve 200**,
incluso ante error interno o payload roto.

**Body**: `{ "events": MetricEvent[] }`, tope de **50** por request (el resto se
descarta). Cada evento debe tener un `id` existente en el registry
(anti-poisoning) y ser uno de:

```ts
{ type: "mount", id: string, version?: string }
{ type: "fallback", id: string, reason: string }
```

**200** — `{ "tracked": <n válidos ingeridos> }` (puede ser `0`).

### `GET /api/metrics`

Snapshot agregado: mounts por miniapp + fallbacks por razón, para todas las
miniapps del registry. Público.

```json
{
  "mounts": { "acc": 42, "wallet": 0 },
  "fallbacks": {
    "resolve-failed": 0,
    "download-failed": 3,
    "invalid-manifest": 0,
    "skew": 0,
    "integrity-failed": 0,
    "host-too-old": 1,
    "invalid-signature": 0,
    "unknown-key": 0
  }
}
```

`mounts` trae una key por cada id del registry (0 si nunca se reportó). `fallbacks`
trae las **8 razones fijas** de `FALLBACK_REASONS` (`lib/metrics/store.ts`) — incluidas
`invalid-signature`/`unknown-key` de la verificación de firma —, también
zero-filled — no es un objeto dinámico con solo las razones vistas.

---

## 7. Admin (solo platform-admin, `canScaffold`)

### `POST /api/admin/sync-all`

Fan-out: dispara `template-sync.yml` en **todos** los repos del registry. Cada
repo es best-effort — un fallo no aborta el resto.

**200**
```json
{ "dispatched": ["acc", "wallet"], "failed": [{ "id": "broken-one", "error": "sin repoUrl válido" }] }
```

### `POST /api/admin/reseed-secrets`

Re-siembra `BACKSTAGE_URL` + `PUBLISH_TOKEN` (env actual de Backstage) en todos
los repos del registry — para rotar `PUBLISH_TOKEN` sin downtime. El repo real
sale de `repoUrl` (no de `miniapp-${id}`, por repos migrados que no siguen esa
convención).

**200** — `{ "reseeded": ["acc"], "failed": [{ "id": "x", "error": "..." }] }`
**500** (sin `code`) si `PUBLISH_TOKEN` no está seteado — se niega a fingir éxito.

### `POST /api/seed`

Siembra el registry con las entradas semilla (bootstrap). **Idempotente**: no pisa las
entradas existentes. A diferencia del resto de §7, se autentica por **token de servicio**,
no por sesión.

**Auth**: `Authorization: Bearer <PUBLISH_TOKEN>` (`requirePublishToken`).

**200** — `{ "seeded": true, "count": 3 }` (`count` = total de entradas tras el seed).
**401** — token ausente/incorrecto (`AuthError`).

---

## 8. Schemas

```ts
// Manifest — describe una versión publicada; "id"/"version" son branded strings.
interface Manifest {
  id: MiniappId;
  version: SemVer;                // "MAJOR.MINOR.PATCH"
  entry: string;                   // expuesto de Module Federation, ej. "./Entry"
  shared: SharedDepSpec[];         // { name, requiredRange, singleton }
  capabilities: Capability[];      // "accounts:read" | "session:whoami" (seed set)
  integrity?: string;              // "sha256-..." — server-computed
  signature?: string;              // firma Ed25519 (base64url) del chunk; resolve la inyecta
  minHostContract?: { reactNative: string; contractVersion: string };
}

// PublishedVersion — interno al registro (no se expone tal cual; ver CatalogEntry / MiniappDetail).
interface PublishedVersion {
  version: SemVer;
  url: string;              // chunk Android
  manifest: Manifest;
  publishedAt: string;      // ISO
  iosUrl?: string;          // chunk iOS, opcional/aditivo
  iosIntegrity?: string;    // sha256 del chunk iOS; resolve lo inyecta en manifest.integrity
  signature?: string;       // firma del chunk Android (base64url); resolve la inyecta en manifest.signature
  iosSignature?: string;    // firma del chunk iOS; resolve iOS la inyecta en manifest.signature
}

// SignedTrustBundle — respuesta de GET /api/trust-bundle. keys: miniappId → pubkey (base64url).
interface SignedTrustBundle {
  bundle: { version: number; updatedAt: string; keys: Record<string, string> };
  signature: string;        // firma root (base64url) sobre el body canónico
}

// MiniappDetail — respuesta de pin / maintainers / borrar versión.
interface MiniappDetail {
  id: MiniappId; name: string; owner: string;
  createdAt?: string; repoUrl?: string;
  latestVersion: SemVer | null;
  versionCount: number;
  versions: VersionView[];         // { version, url, publishedAt, capabilities }, newest first
  capabilities: Capability[];      // de la última versión, [] si no hay ninguna
  storageProvider?: "r2" | "blob" | "fs";
  pinnedVersion?: SemVer;
  servedVersion: SemVer | null;    // pinnedVersion ?? latestVersion
  maintainers?: string[];
}

// CatalogEntry — respuesta de GET /api/miniapps.
interface CatalogEntry {
  id: MiniappId; name: string; owner: string;
  latestVersion: SemVer | null; servedVersion: SemVer | null;
  versionCount: number; createdAt?: string; repoUrl?: string;
  publicKey?: string;              // pubkey de firma (para la CLI del trust bundle)
}

// HostContract — GET/PUT /api/host-contract.
interface HostContract {
  contractVersion: string;
  reactNative: string;
  shared: Record<string, string>;  // nombre → versión concreta que el host trae
  nativeModules: string[];         // presencia only, sin API JS
  generatedAt?: string;            // ISO — cuándo se generó el contrato
  hostCommit?: string;             // SHA del host que lo generó
  capabilitySince?: {              // desde qué versión el host provee cada capability
    shared: Record<string, string>;
    native: Record<string, string>;
  };
}

// ResolveResponse — GET /api/resolve.
interface ResolveResponse {
  id: MiniappId; version: SemVer; url: string; manifest: Manifest;
}
```

### Tabla de códigos de error (`statusForError`, `lib/http.ts`)

| `code` | Clase | HTTP |
|---|---|---|
| `UNAUTHORIZED` | `AuthError` | 401 |
| `FORBIDDEN` | `ScaffoldForbiddenError` | 403 |
| `MINIAPP_NOT_FOUND` | `MiniappNotFoundError` | 404 |
| `NO_COMPATIBLE_VERSION` | `NoCompatibleVersionError` | 404 |
| `MINIAPP_EXISTS` | `MiniappExistsError` | 409 |
| `VERSION_EXISTS` | `VersionExistsError` | 409 |
| `INVALID_MANIFEST` | `InvalidManifestError` | 400 |
| `INVALID_REPO_URL` | `InvalidRepoUrlError` | 400 |
| — | `GitProviderError` | 502 |
| — | `StorageError` | 502 |
| — | cualquier otro `Error`/excepción | 500 |

> [!WARNING]
> No todos los 400/403 tienen `code` — varios son respuestas ad-hoc de validación
> de input (`{ "error": "..." }` sin `code`) construidas directo en el route
> handler, no errores de dominio tipados. Si tu integración necesita ramificar por
> código de error, chequeá primero si el endpoint documentado arriba menciona un
> `code` explícito; si no lo menciona, andá por el mensaje o el status HTTP solo.

---

## 9. Próximos pasos

- [Integration Guide](/docs/integration-guide) — si estás implementando un
  cliente contra estos endpoints, la guía completa te da el flujo y el
  contrato detrás de cada uno, no solo la forma del request/response.
- [Host Contract](/docs/host-contract) — el deep-dive del schema `HostContract`
  de la Sección 8: qué significa cada campo y cómo se usa para el compat gate.
- [Troubleshooting](/docs/troubleshooting) — si un endpoint te devuelve un
  código de esta tabla y no sabés por qué, síntomas organizados por causa/fix.
