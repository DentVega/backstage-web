# Desarrollo local — probar tu miniapp en el host

> El **inner loop** del día a día: cómo correr Backstage y el host **en tu
> máquina** y ver tu miniapp montada ahí, sin pasar por CI → Backstage prod →
> Blob. Esta guía es distinta de [`SETUP.md`](./SETUP.md) (que levanta **toda
> la plataforma desde cero** para una empresa nueva, en Vercel) y complementa
> [`miniapps-guide.md`](./miniapps-guide.md) (el ciclo de vida completo:
> crear → publicar → usar). Acá nos quedamos **100% en local** y repetimos el
> ciclo build → publish → ver-en-host muchas veces por hora.

---

## 1. Panorama del loop local

```
 miniapp repo                    Backstage LOCAL (:3999)          Host móvil LOCAL
┌──────────────────┐            ┌───────────────────────┐        ┌───────────────────────┐
│ pnpm bundle:android│  zip →   │ POST /upload           │        │ Metro/Re.Pack :8081    │
│ build/generated/   │─────────▶│  fs storage:            │◀──────▶│  adb reverse tcp:3999  │
│  android/*.bundle   │          │  data/registry.json     │ resolve│  adb reverse tcp:8081  │
└──────────────────┘            │  public/chunks/<id>/... │        │                        │
                                  └───────────────────────┘        │  <MiniappHost id=.../> │
                                                                    │  resuelve→descarga→monta│
                                                                    └───────────────────────┘
```

**Puntos clave que cambian el mental model respecto a un dev server típico:**

- El host **no** tiene hot-reload del remote federado de tu miniapp. `chunkLoader.ts`
  resuelve por id contra Backstage (`GET /api/resolve?id=<id>`), obtiene una `url` y
  hace `registerRemotes` + `loadRemote('<id>/Entry')` sobre esa URL estática. No hay
  "watch mode" de la miniapp dentro del host.
- Por eso el inner loop real es: **cambiás código → build estático → publicás una
  nueva versión a Backstage local → reabrís la miniapp en el host** (que resuelve la
  versión más alta y la descarga de nuevo). No sirve el dev server webpack de la
  miniapp (`pnpm start` / `webpack-start`) para esto — ver §4.
- Lo único que sí tiene hot-reload/dev-server real es el **host** en sí (Metro/Re.Pack
  en `:8081`) — cambios en el código del host se reflejan al instante; cambios en la
  miniapp, no.

---

## 2. Setup local, una vez

Esto se hace **una sola vez** por máquina; no es parte del loop diario.

### 2.1 Backstage (`backstage-web`)

```bash
cd backstage-web
pnpm install
```

Creá `backstage-web/.env.local` (git-ignored) con el mínimo para loguearte y publicar:

```bash
AUTH_SECRET=$(openssl rand -base64 32)
AUTH_GITHUB_ID=<client id de tu GitHub OAuth App de dev>
AUTH_GITHUB_SECRET=<client secret>
PUBLISH_TOKEN=dev-publish-secret
```

- Detalle de cómo crear la OAuth App (callback `http://localhost:3999/api/auth/callback/github`)
  y el resto de variables (scaffolder, template repo, etc.) está en
  [`SETUP.md` §4.2–4.4](./SETUP.md#4-parte-b--backstage-control-plane) — no lo repitas
  acá, solo lo necesitás si también vas a *crear* miniapps localmente (§1 de
  [`miniapps-guide.md`](./miniapps-guide.md)).
- **`PUBLISH_TOKEN=dev-publish-secret`** es el valor que usaremos en todos los
  comandos de esta guía — es arbitrario, solo tiene que coincidir entre el `.env.local`
  de Backstage y el `Authorization: Bearer …` que mandes al publicar.
- **No** definas `KV_REST_API_URL` / `KV_REST_API_TOKEN` / `BLOB_READ_WRITE_TOKEN` en
  `.env.local`. La selección de storage es automática por env (ver
  [`DEPLOY.md`](../DEPLOY.md#selección-de-storagestore-automática-por-env)): sin esas
  vars, Backstage cae a **fs storage** —
  - catálogo/registro → `backstage-web/data/registry.json`
  - chunks → `backstage-web/public/chunks/`
  - `resolve` devuelve URLs tipo `http://localhost:3999/chunks/<id>/<version>/<id>.container.js.bundle`

  Esto es justo lo que querés en local: cero dependencias externas, todo servido por
  el propio `next dev`.

### 2.2 Host móvil (`backstagereactnative`)

```bash
cd backstagereactnative
pnpm install
pnpm build:packages   # build de miniapp-contract / host-runtime / ui-kit
```

Toolchain (detalle completo en [`SETUP.md` §2](./SETUP.md#2-prerrequisitos) y
[`README.md`](../../backstagereactnative/README.md) del repo host):

- **OpenJDK 17** (no Azul Zulu) para Android:
  `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`
- Un emulador Android corriendo o un dispositivo físico en `adb devices`.
- (Opcional, macOS) Xcode + CocoaPods para iOS.

Sin `BACKSTAGE_URL` seteado al buildear, el host apunta por defecto a
`http://localhost:3999` (`apps/host/src/hostProvided.ts`, vía `DefinePlugin` en
`apps/host/rspack.config.mjs`) — exactamente lo que queremos para desarrollo local.

---

## 3. Arrancar los servicios

Layout recomendado: **3 terminales**.

| Terminal | Comando | Desde | Qué hace |
|---|---|---|---|
| 1 — Backstage | `pnpm exec next dev -p 3999` | `backstage-web/` | Control-plane local en `:3999` (registry, `/api/resolve`, `/chunks`) |
| 2 — Host (Metro/Re.Pack) | `pnpm start` | `backstagereactnative/apps/host/` | Dev server del host en `:8081` |
| 3 — App nativa | `pnpm android` (o `pnpm ios`) | `backstagereactnative/apps/host/` | Instala/lanza la app en el emulador/device |

```bash
# Terminal 1
cd backstage-web && pnpm exec next dev -p 3999

# Terminal 2
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
cd backstagereactnative/apps/host && pnpm start

# Terminal 3 (una vez, o cuando cambia algo nativo)
cd backstagereactnative/apps/host && adb reverse tcp:3999 tcp:3999 && pnpm android
```

**El `adb reverse tcp:3999 tcp:3999` es el paso que más se olvida** — ver §5 para el
porqué. `pnpm android` (`react-native run-android`) ya hace el reverse de `:8081`
(Metro) automáticamente; el de `:3999` (Backstage) es **manual, siempre**.

---

## 4. El inner loop del dev

Este es el ciclo que repetís cada vez que cambiás código de tu miniapp.

```
 1. editar código de la miniapp
 2. pnpm bundle:android                 (build estático → build/generated/android/)
 3. cd build/generated/android && zip -r /tmp/build.zip .
 4. publicar a Backstage local (auto-bump de versión — ver abajo)
 5. reabrir la miniapp en el host (Home o el punto donde la montaste)
        ↑___________________________________________________________|
        vuelve a 1
```

### 4.1 Build

Desde el repo de la miniapp (no desde `backstage-web`):

```bash
pnpm bundle:android
# → build/generated/android/<id>.container.js.bundle + sub-chunks (mismo directorio)
```

> Usá **siempre** el build estático (`bundle:android` / `bundle:ios`), **nunca** el
> dev server webpack de la miniapp (`pnpm start`, alias `webpack-start --port 9000`).
> Ese dev server sirve URLs con `?platform=...` pensadas para Metro, y el host no
> puede cargarlas como remote federado (rompe la resolución del chunk). Ver
> [`miniapps-guide.md` §2a](./miniapps-guide.md#2a-preparar-el-chunk-en-el-repo-de-la-miniapp).

### 4.2 Zip

```bash
cd build/generated/android && zip -r /tmp/build.zip .
```

El zip tiene que contener el `.container.js.bundle` y los sub-chunks **al raíz**
(directorio plano), no metidos en una subcarpeta — el host los resuelve relativos al
directorio del container.

### 4.3 Publicar a Backstage local

**Opción recomendada para iterar — `publish.mjs` con auto-bump de versión:**

```bash
BACKSTAGE_URL=http://localhost:3999 PUBLISH_TOKEN=dev-publish-secret \
  node scripts/publish.mjs /tmp/build.zip
```

Este script (en el repo de la miniapp, `scripts/publish.mjs`) lee la `latestVersion`
actual desde Backstage y publica el siguiente patch automáticamente. Como el registro
es **inmutable** (no se puede re-publicar la misma versión — da `409`), esto es lo que
te evita tener que acordarte de bumpear `manifest.json`/`package.json` a mano en cada
iteración.

**Opción alternativa — upload directo, versión manual:**

```bash
curl -X POST http://localhost:3999/api/miniapps/<id>/upload \
  -H "Authorization: Bearer dev-publish-secret" \
  -F version=0.1.0 \
  -F file=@/tmp/build.zip\;type=application/zip
```

Acá **vos** elegís la versión — si repetís el mismo `version=` en dos publicaciones
seguidas, la segunda falla con `409` (registro inmutable). Para iterar rápido sin
pensar en el número, preferí `publish.mjs`.

Verificá que quedó publicada:

```bash
curl "http://localhost:3999/api/resolve?id=<id>"
# → { "url": "http://localhost:3999/chunks/<id>/<version>/<id>.container.js.bundle", "manifest": {...} }
```

### 4.4 Ver el cambio en el host

- **Camino rápido:** abrí la miniapp desde el **Home** del host (el catálogo ya lista
  las miniapps registradas) — al reabrirla, `resolve` trae la versión más alta y el
  host la descarga de nuevo.
- Si la miniapp ya estaba montada/abierta, **volvé atrás y volvé a entrar** (o
  recargá la pantalla) para forzar un nuevo `resolve` + descarga — el host no re-poll
  ni hace hot-swap de un remote ya cargado en memoria.

### 4.5 El ciclo completo, resumido

```bash
# en el repo de la miniapp, cada vez que cambiás código:
pnpm bundle:android
cd build/generated/android && zip -r /tmp/build.zip . && cd -
BACKSTAGE_URL=http://localhost:3999 PUBLISH_TOKEN=dev-publish-secret \
  node scripts/publish.mjs /tmp/build.zip
# → reabrí la miniapp en el host
```

No hay atajo más corto hoy: cada cambio de código de la miniapp pasa por build +
publish, porque el host consume el chunk vía HTTP resuelto por Backstage, no vía
watch/HMR directo al bundler de la miniapp.

---

## 5. Emulador vs dispositivo físico

| | Emulador Android | Dispositivo físico (USB/Wi-Fi) | iOS Simulator |
|---|---|---|---|
| `localhost` dentro del proceso apunta a | el propio emulador, **no** a tu Mac | el propio dispositivo, **no** a tu Mac | tu Mac (comparte el host de red) |
| `:8081` (Metro/Re.Pack) | auto-reverse por `run-android` | auto-reverse por `run-android` | no hace falta reverse |
| `:3999` (Backstage local) | **manual**: `adb reverse tcp:3999 tcp:3999` | **manual**: `adb reverse tcp:3999 tcp:3999` | no hace falta reverse |

```bash
adb devices                         # confirmá que el emulador/device aparece
adb reverse tcp:3999 tcp:3999       # cubre TANTO /api/resolve COMO /chunks/... (mismo puerto)
```

Si te salta `NO_COMPATIBLE_VERSION` o un 404 al chunk en el device pero `curl
localhost:3999/...` funciona bien desde tu Mac, es casi siempre este `adb reverse`
que falta o se perdió (se resetea si reiniciás el emulador o desconectás el device).

> Contraste con prod: si apuntás el host a Backstage de **producción**
> (`BACKSTAGE_URL=https://<tu-proyecto>.vercel.app`), no hace falta ningún `adb
> reverse` — es internet público, no `localhost`.

---

## 6. Montar tu miniapp en un punto específico del host

Para una prueba rápida, alcanza con abrirla desde el **Home** del host (ya lista el
catálogo). Si estás desarrollando un punto de montaje específico (un tab, una
sección, un modal), montala vos mismo con `<MiniappHost/>` donde corresponda:

```tsx
import {MiniappHost, createScopedGrant, httpResolveClient} from '@dentvega/host-runtime';
import {repackChunkLoader} from '../chunkLoader';
import {HOST_PROVIDED, BACKSTAGE_BASE_URL} from '../hostProvided';

const resolveClient = httpResolveClient(BACKSTAGE_BASE_URL);

<MiniappHost
  id={'<id>' as MiniappId}
  resolveClient={resolveClient}
  chunkLoader={repackChunkLoader}
  hostProvided={HOST_PROVIDED}
  capabilities={grant}   // inyectá SOLO las capabilities que la miniapp necesita
/>
```

`MiniappHost` hace todo el ciclo `resolve → verify → download → mount → fallback`. El
loader es genérico (usa `resolved.id` + `loadRemote`) — **no hace falta tocar**
`apps/host/rspack.config.mjs` por cada miniapp que agregues. Guía completa (playbook +
troubleshooting del lado host): `backstagereactnative/docs/mounting-miniapps.md`.

---

## 6b. Hot reload — dev-loop rápido (Modo 1 y 2)

El inner loop de §4 (build → publish → reabrir) no tiene hot reload del remoto
federado (el host carga por URL resuelta). Para iterar más rápido hay **dos modos
de dev, `__DEV__`-only** (no afectan release):

### Modo 1 — dev-mount (Fast Refresh real, sin federación)

El host importa **directo** el `Entry` de un miniapp clonado al lado y lo renderiza
con un grant mock (de las capabilities de su `manifest.json`). Al ser código del
bundle del host, editar el miniapp da **Fast Refresh instantáneo**.

```bash
# host, apuntando a tu miniapp clonado al lado:
DEV_MINIAPP_PATH=../miniapp-cards_wallet pnpm --filter @app/host start
pnpm --filter @app/host android
# → en el Home tocá "▶ Dev Mount" → editá miniapp-cards_wallet/src/Screen.tsx
#   → refresco instantáneo
```

- Sin `DEV_MINIAPP_PATH`, "Dev Mount" muestra un placeholder (y en release ni se
  registra).
- **Límite:** no prueba la federación (boundary MF, resolve, integridad). Y solo
  funciona limpio si el miniapp usa deps **compartidas** (ui-kit, RN, react); si
  agregó deps propias, instalalas también en el host o usá el Modo 2.

### Modo 2 — dev server (:9000, reload federado rápido, sin publish)

El host consume el container **vivo** del `webpack-start` del miniapp. Editás →
rebuildea → **RR** (recargar) en el host trae el container fresco. Prueba la
federación real; sin build+zip+publish.

```bash
# terminal A — miniapp:
cd miniapp-cards_wallet && pnpm start            # dev server :9000

# terminal B — host:
DEV_REMOTES="cards_wallet=http://localhost:9000" pnpm --filter @app/host start
adb reverse tcp:9000 tcp:9000                    # (+ tcp:3999 si además usás Backstage)
pnpm --filter @app/host android
# → abrí cards_wallet desde el Home → carga el remoto vivo → editá → RR para refrescar
```

- `DEV_REMOTES` es un mapa `"id=url,id2=url2"`. Solo esos ids saltan Backstage y van
  al dev server (con integridad desactivada **solo** para ellos, bajo `__DEV__`).
- En release, `DEV_REMOTES` no se setea → el host resuelve/verifica normal.

### Qué modo para qué tarea

| Tarea | Modo |
|---|---|
| Construir/ajustar la UI de la pantalla (lo más frecuente) | **1** (Fast Refresh) |
| Verificar que monta como remoto federado, capabilities, boundary MF | **2** (reload) |
| Release / integridad / versionado | build→publish (§4) |

---

## 7. Troubleshooting

| Síntoma | Causa / fix |
|---|---|
| `resolve` → `NO_COMPATIBLE_VERSION` | La miniapp está registrada pero no tiene ninguna versión publicada todavía (o ninguna compatible). Publicá una versión (§4.3). |
| `409` al publicar | Estás reusando un `version=` ya publicado (el registro es inmutable). Usá `publish.mjs` (auto-bump) o subí el número a mano. |
| `401` al publicar | Falta o está mal el `Authorization: Bearer <PUBLISH_TOKEN>`, o no coincide con `PUBLISH_TOKEN` en `backstage-web/.env.local`. |
| El host muestra la versión vieja | El host resuelve la **última** versión — republicá (auto-bump) y volvé a abrir/entrar a la miniapp para forzar un nuevo `resolve`. Si el **Home** sigue mostrando el catálogo viejo (react-query lo cachea; mandar la app a background y volver **no** lo refetchea), recargá la app entera (**RR** en el emulador, o relanzala) para limpiar el cache. |
| 404 al chunk en el emulador/device | Falta `adb reverse tcp:3999 tcp:3999`, o el zip no tenía el container al raíz (sin subcarpeta). |
| `useTheme must be used within a <ThemeProvider>` | `@dentvega/ui-kit` no está declarado como `singleton` en `shared` — en **ambos** lados, host y miniapp (`rspack.config.mjs`). |
| La miniapp no actualiza aunque publicaste | Publicaste el build del dev server (`pnpm start` / `webpack-start`) en vez del build estático (`bundle:android`) — esas URLs con `?platform` no cargan como remote. Rehacé con `bundle:android`. |
| "Acceso no autorizado" dentro de la miniapp | Falta la capability que la miniapp exige — revisá el `grant` que le pasás a `<MiniappHost capabilities={...}/>`. |
| `curl localhost:3999/...` anda bien desde tu Mac pero falla en el device | Casi siempre el `adb reverse tcp:3999 tcp:3999` que falta o se reseteó (reinicio de emulador / reconexión de cable). |

---

**Ver también:**
[`miniapps-guide.md`](./miniapps-guide.md) (ciclo de vida completo: crear → publicar
→ usar, incluyendo el flujo vía CI/prod) ·
[`SETUP.md`](./SETUP.md) (levantar toda la plataforma desde cero para una empresa
nueva) · [`DEPLOY.md`](../DEPLOY.md) (deploy de Backstage a Vercel + selección de
storage) · `backstagereactnative/docs/mounting-miniapps.md` (playbook de montaje +
troubleshooting del lado host).
