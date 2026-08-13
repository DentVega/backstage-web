# Correr el host — referencia rápida

> [!NOTE]
> Este doc es un **espejo** de `apps/host/RUN.md` del repo [`backstagereactnative`](https://github.com/DentVega/backstagereactnative/blob/main/apps/host/RUN.md). Editalo allá; acá es una copia para el sitio.

Los 4 escenarios en comandos. Guía detallada (env vars, troubleshooting, dev-loop
de miniapps): [`README.md`](https://github.com/DentVega/backstagereactnative/blob/main/apps/host/README.md).

## Setup — una sola vez (desde la raíz del repo)

```bash
pnpm install
pnpm build:packages
```

## La variable que manda: `BACKSTAGE_URL`

Se **hornea en el bundle en build-time** (no hay `.env`). De ahí salen el catálogo y el
resolve. Prod = `https://<tu-proyecto>.vercel.app`; default sin setear =
`http://localhost:3999`. Si la cambiás, **reiniciá el dev server** (dev) o **re-buildeá**
(release) — un reload de JS no alcanza.

---

## 1 · DEV LOCAL — Android

Dos terminales; `BACKSTAGE_URL` va en la del dev server (arma el JS):

```bash
# Terminal A — dev server (Re.Pack)
export BACKSTAGE_URL=https://<tu-proyecto>.vercel.app
cd apps/host && pnpm start

# Terminal B — build + install
emulator -avd <tu-avd> &          # o desde Android Studio → Device Manager
cd apps/host && pnpm android
```

- Recargar JS tras cambios: `r` + Enter en la Terminal A (no repitas la Terminal B).
- Si el emulador no conecta al dev server: `adb reverse tcp:8081 tcp:8081`.

## 2 · DEV LOCAL — iOS

```bash
cd apps/host/ios && pod install && cd ..      # solo la 1ª vez

# Terminal A — dev server
export BACKSTAGE_URL=https://<tu-proyecto>.vercel.app
cd apps/host && pnpm start

# Terminal B
cd apps/host && pnpm ios                        # Simulador
```

**iPhone real:** abrí `apps/host/ios/host.xcworkspace` en Xcode (no el `.xcodeproj`) →
target **host** → **Signing & Capabilities** → seteá tu **Team** + un **Bundle
Identifier** propio → conectá el iPhone, seleccionalo y **Run** (con la Terminal A del
dev server corriendo). ATS ya está resuelto; no toques `Info.plist`.

---

## 3 · PROD — Android (release, JS dentro del binario)

```bash
export BACKSTAGE_URL=https://<tu-proyecto>.vercel.app   # ANTES de buildear

cd apps/host/android
./gradlew assembleRelease      # APK → app/build/outputs/apk/release/
# ./gradlew bundleRelease      # AAB para Play Store
```

Gradle invoca el bundle de Re.Pack y lo mete en el binario. No hay dev server en prod.

## 4 · PROD — iOS (release)

```bash
export BACKSTAGE_URL=https://<tu-proyecto>.vercel.app   # ANTES de buildear
cd apps/host && pnpm ios --mode Release
```

O desde Xcode: scheme **Release** → Run/Archive (para device real, con la firma del
punto 2). El bundle iOS lo regenera solo el Build Phase "Bundle React Native code and
images" de Xcode (no hay un `bundle:ios` aparte en el host).

---

## Correr miniapps en local — dev-loop (Modo 1 y 2)

Todo lo de arriba corre **el host**. Esto es para **desarrollar una o varias miniapps**
contra ese host, en tu máquina, sin pasar por CI/prod. Hay dos modos (ambos son
`__DEV__`-only — no afectan el release):

| | **Modo 1 — dev-mount** | **Modo 2 — remotes federados** |
|---|---|---|
| Cuántas miniapps | **1** | **1 o varias** |
| Cómo carga | compilada dentro del bundle del host (alias `@dev-miniapp`) | como chunk remoto por HTTP desde el dev server de la miniapp (igual que prod, pero a `localhost`) |
| Fast Refresh | **host + miniapp juntos** (el loop más ajustado) | dentro de la miniapp (editás → rebuildea → recargás el host) |
| ¿Necesita estar en el catálogo? | **No** (ideal para una miniapp nueva) | Sí (aparece en el catálogo; el host redirige su resolución a tu dev server) |
| Prueba la federación real (boundary MF, resolve, integridad) | No | **Sí** |

### Modo 1 — UNA miniapp, Fast Refresh instantáneo

El host importa **directo** el `Entry` de una miniapp clonada al lado y la renderiza con
un grant mock (de las capabilities de su `manifest.json`). Como es código del bundle del
host, editar la miniapp da **Fast Refresh instantáneo**.

```bash
# Terminal A — host dev server, apuntando a tu miniapp clonada al lado
export BACKSTAGE_URL=https://<tu-proyecto>.vercel.app
DEV_MINIAPP_PATH=../miniapp-hellow_widget \
  pnpm --filter @app/host start

# Terminal B — build + install
pnpm --filter @app/host android      # o: pnpm --filter @app/host ios
```

- En la app, entrá a la pantalla **"▶ Dev Mount"** (en el Home) → monta la miniapp de
  `DEV_MINIAPP_PATH`. Editá su `src/…` → refresco al instante.
- Sin `DEV_MINIAPP_PATH`, "Dev Mount" muestra un placeholder (y en release ni se registra).
- **Límite:** no prueba la federación. Y solo anda limpio si la miniapp usa las deps
  **compartidas** (ui-kit, react-native, react); si agregó deps propias, instalalas también
  en el host o usá el Modo 2.

### Modo 2 — UNA o VARIAS miniapps (federadas)

Cada miniapp corre **su propio dev server** en un puerto distinto; el host las rutea por
id. El host baja el container **vivo**; editás → rebuildea → **RR** (recargar) en el host
trae el fresco.

**Una sola miniapp:**

```bash
# Terminal A — dev server de la miniapp (:9000 por default)
cd ../miniapp-hellow_widget && pnpm start

# Terminal B — host, mapeando el id a su dev server
export BACKSTAGE_URL=https://<tu-proyecto>.vercel.app
DEV_REMOTES="hellow_widget=http://localhost:9000" \
  pnpm --filter @app/host start

# Terminal C — build + install (+ reenviar el puerto al emulador, ver abajo)
adb reverse tcp:9000 tcp:9000
pnpm --filter @app/host android
```

**Varias miniapps a la vez** — cada una en **su propio puerto**:

```bash
# Terminal A — miniapp 1 (:9000 por default)
cd ../miniapp-hellow_widget && pnpm start

# Terminal B — miniapp 2 (otro puerto, para no chocar con :9000)
cd ../miniapp-cards_wallet && \
  pnpm exec react-native webpack-start --port 9001

# Terminal C — miniapp 3 (otro puerto más)
cd ../miniapp-account-dashboard && \
  pnpm exec react-native webpack-start --port 9002

# Terminal D — host, mapeando cada id a su dev server
export BACKSTAGE_URL=https://<tu-proyecto>.vercel.app
DEV_REMOTES="hellow_widget=http://localhost:9000,\
cards_wallet=http://localhost:9001,\
account_dashboard=http://localhost:9002" \
  pnpm --filter @app/host start

# Terminal E — reenviar cada puerto al emulador + instalar
adb reverse tcp:9000 tcp:9000
adb reverse tcp:9001 tcp:9001
adb reverse tcp:9002 tcp:9002
pnpm --filter @app/host android
```

- **Formato:** `DEV_REMOTES="id1=url1,id2=url2,…"`. Los **ids deben coincidir con los del
  catálogo**. Solo esos ids saltan Backstage y van al dev server (con integridad desactivada
  **solo** para ellos, bajo `__DEV__`).
- **Mezclar:** las miniapps que **no** estén en `DEV_REMOTES` se resuelven normal (chunk
  publicado) → podés tener unas vivas-desde-dev-server y otras publicadas al mismo tiempo.
- **Puertos:** el `pnpm start` de una miniapp usa `:9000` por default; para la 2ª, 3ª, …
  usá `pnpm exec react-native webpack-start --port 900N`.
- En **release**, `DEV_REMOTES` no se setea → el host resuelve/verifica todo normal.

### Red — emulador / Simulador / device (Modo 2)

En el **emulador Android**, `localhost` es el emulador, no tu Mac → los dev servers
(`:900N`) no se alcanzan solos. Dos opciones:

```bash
# a) reenviar cada puerto (recomendado: mantenés las URLs con localhost)
adb reverse tcp:9000 tcp:9000
adb reverse tcp:9001 tcp:9001
# (+ tcp:8081 del host si hiciera falta, y tcp:3999 si además usás Backstage local)

# b) o usar la IP del host del emulador en DEV_REMOTES:
#    DEV_REMOTES="hellow_widget=http://10.0.2.2:9000,…"
```

- **iOS Simulator:** `localhost` apunta a tu Mac → **no** hace falta `adb reverse` ni el
  port-forward. Los `:900N` funcionan directo.
- **iPhone real:** `localhost` es el teléfono → usá la **IP LAN de tu Mac** en las URLs de
  `DEV_REMOTES` (`http://192.168.x.x:9000`), no `localhost`.

### Qué modo para qué tarea

| Tarea | Modo |
|---|---|
| Construir/ajustar la UI de una miniapp (lo más frecuente) | **1** (Fast Refresh) |
| Miniapp nueva, todavía sin publicar en el catálogo | **1** |
| Probar que monta como remoto federado (boundary MF, capabilities) | **2** |
| Desarrollar **varias** miniapps juntas | **2** (multi-puerto) |
| Release / integridad / versionado real | build → publish (ver [`../../docs`](https://github.com/DentVega/backstage-web/blob/main/docs/LOCAL-DEV.md) en backstage-web) |

---

## Gotchas

- **Catálogo vacío** → `BACKSTAGE_URL` sin setear (cayó a `localhost`). Confirmala en la
  Terminal A y **reiniciá el dev server**.
- **En release** `BACKSTAGE_URL` queda **fija en el binario** → verificá que apunte a
  prod **antes** de buildear. Un release apuntando a `localhost` no carga el catálogo.
- **Plataforma:** automática (`Platform.OS`) → iOS baja el chunk iOS, Android el android.
  Nada que configurar.
- **¿Backstage 100% local?** en otra terminal `cd backstage-web && pnpm dev` (:3999), usá
  `BACKSTAGE_URL=http://localhost:3999`, y para el emulador Android
  `adb reverse tcp:3999 tcp:3999`.
