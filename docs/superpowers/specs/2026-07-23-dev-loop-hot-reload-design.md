# Dev-loop con hot reload para miniapps en el host

**Fecha:** 2026-07-23
**Estado:** Diseño aprobado — listo para plan de implementación
**Owner:** DentVega

## 1. Contexto y objetivo

Hoy el inner loop para probar una miniapp en el host es build → publish → reabrir
(sin hot reload), porque el host es catalog-driven (`resolve → registerRemotes →
loadRemote`) y el HMR federado cross-boundary de Re.Pack es frágil. Objetivo: dar
**dos modos de dev, aditivos y `__DEV__`-gated**, para iterar rápido:

- **Modo 1 (dev-mount):** Fast Refresh **real** del `Entry`/`Screen` de un miniapp
  local, importándolo directo en el host (sin federación).
- **Modo 2 (dev server):** el host consume el container **vivo** del `webpack-start`
  (:9000) del miniapp — reload rápido, prueba la federación real, sin publish.

**Restricción dura (igual que el origin-guard del bootstrap):** todo es aditivo y
`__DEV__`-gated. **Nada** debe alcanzar el path de release ni cambiar prod.

## 2. Hallazgos de la exploración (base del diseño)

- El host monta `./Entry` (módulo federado expuesto). `Entry({capabilities})` es el
  gate de capabilities + `<Screen/>`; `Screen()` es UI pura sin props
  (`MiniappEntryProps = { capabilities: CapabilityGrant }`, `types.ts:68`).
- `noopVerifier` **ya existe** en `host-runtime/integrity.ts` — Modo 2 solo lo pasa,
  no construye bypass.
- `ResolveClient` es una interfaz de un método (`resolve(request)`) — el override es
  un wrapper limpio.
- `MiniappHost` ya acepta `integrity?: IntegrityVerifier` como prop; `MiniappScreen`
  hoy pasa `sha256Verifier()` y `httpResolveClient(BACKSTAGE_BASE_URL)`.
- Nav = `createNativeStackNavigator` en `apps/host/App.tsx` — se agrega un
  `Stack.Screen` dev-gated.
- Re.Pack reemplaza a Metro; el Fast Refresh viene de su dev server webpack/rspack.
- Config vía env inyectado por `DefinePlugin` (igual que `BACKSTAGE_URL` →
  `__BACKSTAGE_URL__`).

## 3. Modo 1 — dev-mount (Fast Refresh)

### 3.1 Host `apps/host/rspack.config.mjs`
- **Alias:** `resolve.alias['@dev-miniapp']` →
  `path.resolve(process.env.DEV_MINIAPP_PATH, 'src/Entry')` si `DEV_MINIAPP_PATH`
  está seteado, si no → `path.resolve(__dirname, 'src/dev/NoMiniapp')`.
- **Watch del dir externo:** webpack/rspack observa por defecto **todo archivo en
  el grafo de módulos**, así que el `Entry` alias'd (y lo que importe) se watchea
  sin config extra aunque esté fuera del root del host. La primera task de Modo 1
  confirma esto en vivo (editar el miniapp externo → recompila); solo si el dev
  server ignora paths fuera del root se amplía `watchOptions`/`snapshot`.
- **`DefinePlugin`:** inyecta `__DEV_MINIAPP_CAPS__` = las `capabilities` leídas de
  `${DEV_MINIAPP_PATH}/manifest.json` en config-time (o `[]` si no hay path/manifest).
  Así el grant mock incluye la capability requerida y el gate de `Entry` pasa.

### 3.2 Host `apps/host/src/dev/`
- **`DevMountScreen.tsx`** (renderizado solo bajo `__DEV__`):
  ```tsx
  import Entry from '@dev-miniapp';
  import { ThemeProvider } from '@dentvega/ui-kit';
  import { createScopedGrant } from '@dentvega/host-runtime';
  const grant = createScopedGrant(__DEV_MINIAPP_CAPS__).grant;
  // <ThemeProvider><Entry capabilities={grant} /></ThemeProvider>
  ```
- **`NoMiniapp.tsx`:** default export placeholder — una pantalla que dice "seteá
  `DEV_MINIAPP_PATH=../miniapp-<id>` y reiniciá el dev server". Es el destino del
  alias cuando no hay miniapp (incluido siempre en el bundle; inofensivo en prod).

### 3.3 Nav `apps/host/App.tsx`
- `Stack.Screen name="DevMount"` registrado **solo si `__DEV__`** (un `{__DEV__ ? (
  <Stack.Screen .../>) : null}`), y un punto de entrada dev (ej. un botón en Home
  bajo `__DEV__`).

### 3.4 Uso
```bash
DEV_MINIAPP_PATH=../miniapp-cards_wallet pnpm start   # host, Re.Pack :8081
pnpm android
# abrir "DevMount" → editar miniapp-cards_wallet/src/Screen.tsx → refresh instantáneo
```

### 3.5 Límites (documentados)
- No prueba la federación (boundary MF, resolve, versionado, integridad) — eso es
  Modo 2 / build→publish.
- Solo funciona limpio si el miniapp usa **deps compartidas** (ui-kit, RN, react); si
  agregó deps propias, hay que instalarlas también en el host o caer a Modo 2.

## 4. Modo 2 — dev server (:9000), gated por spike

### 4.1 SPIKE de factibilidad (primer paso, go/no-go)
Antes de escribir código de Modo 2: correr `pnpm start` (`webpack-start --port
9000`) en un miniapp real (ej. `miniapp-account-dashboard`), y confirmar:
1. El dev server sirve el container federado en una URL estable (probable:
   `http://localhost:9000/<id>.container.js.bundle?platform=android`) — `curl` → 200.
2. El host puede `registerRemotes` + `loadRemote` esa URL y montar la miniapp.

**Si falla** → replantear Modo 2 (ej. publicar a Backstage local con un puntero dev,
o servir el build estático con un file server) **sin** haber escrito el wiring.

### 4.2 Si el spike pasa
- **`devResolveClient(base, devRemotes)`** (host-runtime o host, `__DEV__`-only):
  envuelve `httpResolveClient(base)`; en `resolve(request)`, si `request.id ∈
  devRemotes` → devuelve un `ResolveResponse` sintético
  `{ id, version: 'dev', url: '<devUrl>/<id>.container.js.bundle?platform=android',
  manifest: <mínimo válido, SIN integrity> }`; si no, delega al cliente HTTP.
- **`parseDevRemotes(raw)`**: parsea `DEV_REMOTES="id=url,id2=url2"` → `Record<string,
  string>`. Inyectado vía `DefinePlugin __DEV_REMOTES__`.
- **`MiniappScreen`:** bajo `__DEV__`, usa `devResolveClient` y pasa
  `integrity={isDevRemote(id) ? noopVerifier : sha256Verifier()}`. En prod, sin cambios.

### 4.3 Uso
```bash
# miniapp
cd miniapp-cards_wallet && pnpm start            # dev server :9000
# host
DEV_REMOTES="cards_wallet=http://localhost:9000" pnpm start
adb reverse tcp:9000 tcp:9000                    # (+ tcp:3999 si usás Backstage)
pnpm android
# abrir cards_wallet desde el Home → carga el remoto vivo → editar → RR para refrescar
```

## 5. Estructura de archivos

**Host (`backstagereactnative/apps/host/`):**
- `rspack.config.mjs` (modificar): alias `@dev-miniapp` + watch + `DefinePlugin`
  (`__DEV_MINIAPP_CAPS__`, `__DEV_REMOTES__`).
- `src/dev/DevMountScreen.tsx` (crear), `src/dev/NoMiniapp.tsx` (crear).
- `src/globals.d.ts` (modificar): declarar `__DEV_MINIAPP_CAPS__`, `__DEV_REMOTES__`.
- `App.tsx` / `navigation.ts` (modificar): `Stack.Screen` dev-gated + tipo de ruta.
- `src/screens/MiniappScreen.tsx` (modificar): resolve + verifier dev-aware.

**Host-runtime (`backstagereactnative/packages/host-runtime/`):**
- `ResolveClient.ts` (modificar) o un archivo nuevo `devResolveClient.ts`:
  `devResolveClient` + `parseDevRemotes`, exportados desde `index.ts`.

**Docs:** `backstage-web/docs/LOCAL-DEV.md` (agregar sección "Hot reload / dev-loop").

## 6. Testing

- **Unit (`node`/jest del host-runtime):**
  - `parseDevRemotes("a=http://x,b=http://y")` → `{a:"http://x", b:"http://y"}`;
    string vacío → `{}`; entradas malformadas ignoradas.
  - `devResolveClient`: id ∈ devRemotes → `ResolveResponse` con la url `:9000` +
    `?platform` y sin integrity; id ∉ devRemotes → delega (spy en el cliente HTTP).
- **Manual/spike:** Modo 1 Fast Refresh (editar Screen → refresca); Modo 2 reload
  (el spike §4.1 + editar → RR → cambio visible).
- El gating `__DEV__` no rompe el build de release: `pnpm bundle:android` del host
  compila con `NoMiniapp` (env sin setear) y sin las ramas dev.

## 7. Gating / seguridad (invariante)

- Alias cae a `NoMiniapp` cuando `DEV_MINIAPP_PATH` no está → prod nunca importa código externo.
- `devResolveClient` / `noopVerifier` / la entrada de nav **solo** se usan bajo `__DEV__`.
- El bypass de integridad **jamás** aplica en release (gate `__DEV__` + solo para ids en `DEV_REMOTES`, que en prod no se setean).

## 8. Rollout

1. **Modo 1:** `NoMiniapp` + alias + `DefinePlugin`(caps) + `DevMountScreen` + nav
   dev-gated + globals. Verificar Fast Refresh manual + que `bundle:android` compila.
2. **Spike Modo 2** (§4.1): go/no-go.
3. **Modo 2** (si go): `parseDevRemotes` + `devResolveClient` (+ tests) + wiring en
   `MiniappScreen` + `DefinePlugin`(`__DEV_REMOTES__`). Verificar reload manual.
4. **Docs:** sección en `LOCAL-DEV.md`.

## 9. Fuera de alcance (YAGNI)

- HMR federado real dentro del host (Opción 4) — frágil, se descartó.
- Shell nativo standalone en el miniapp (Opción 3).
- Auto-instalar deps propias del miniapp en el host para Modo 1 (el dev lo hace a mano si hace falta).
- Selector visual de miniapp/modo en la UI (env vars alcanzan).
