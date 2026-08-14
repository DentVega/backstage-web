# Troubleshooting / FAQ

> Guía de síntomas → causa → fix para los problemas más comunes de la plataforma:
> publicar una miniapp, que no monte en el host, el compat gate, el dev-loop local y
> template-sync. Todo lo de acá está verificado contra el código real (`lib/http.ts`,
> `lib/registry/registry.ts`, `app/api/miniapps/[id]/upload/route.ts` en este repo, y
> `packages/host-runtime` + `apps/host` en `backstagereactnative`) — no es folklore.
>
> Si tu síntoma no está acá, revisá primero [`LOCAL-DEV.md` §7](./LOCAL-DEV.md#7-troubleshooting)
> (dev-loop) y [`docs/mounting-miniapps.md`](https://github.com/<owner>/backstagereactnative/blob/main/docs/mounting-miniapps.md)
> del repo del host (montaje), que tienen sus propias tablas de síntomas puntuales.

---

## Elegí tu síntoma

| Si ves... | Andá a |
|---|---|
| `401` / `409` / `422` al publicar, o el CI de `publish.yml` falla | [§1 Publicar una miniapp](#1-publicar-una-miniapp) |
| La miniapp queda en "Miniapp no disponible" dentro del host | [§2 La miniapp no monta en el host](#2-la-miniapp-no-monta-en-el-host) |
| `NO_COMPATIBLE_VERSION`, CI marca ❌ de compat, o un `issue` automático pidiendo un nativo | [§3 El compat gate te frena](#3-el-compat-gate-te-frena) |
| El host no levanta, `adb reverse`, la miniapp no refresca, simulador iOS | [§4 Dev-loop local](#4-dev-loop-local) |
| Un PR de template-sync con `<<<<<<<` rompió el CI | [§5 Template-sync](#5-template-sync) |

---

## 1. Publicar una miniapp

El publish pasa por `POST /api/miniapps/:id/upload` (`app/api/miniapps/[id]/upload/route.ts`).
Los códigos de estado vienen de `statusForError` en [`lib/http.ts`](../lib/http.ts):

| Código | Error tipado | Cuándo pasa |
|---|---|---|
| `401` | `AuthError` | Falta o es inválido el `Authorization: Bearer <PUBLISH_TOKEN>` (flujo CI), y tampoco hay sesión de un login allowlisted (flujo UI). |
| `400` | `InvalidManifestError` | `manifest` no matchea el contrato, `manifest.id`/`manifest.version` no coinciden con lo enviado, semver inválido, o (subiendo iOS) todavía no existe la versión Android a la que adjuntarlo. |
| `400` | (validación de la ruta, sin tipo propio) | Falta `file` o `version` en el form-data; el `manifest` mandado no es JSON válido; el zip está vacío; el zip no contiene `<id>.container.js.bundle` en la raíz. |
| `409` | `VersionExistsError` | Estás re-publicando una `version` que ya existe para esa plataforma (Android o iOS) — el registro es **inmutable**. |
| `422` | — (`code: "COMPAT_INCOMPATIBLE"`) | Solo si `COMPAT_ENFORCE=1` está activo en el entorno: el manifest tiene skew de `shared` o un nativo que el host no tiene. En modo WARN (default) esto **no** bloquea, solo loguea. |
| `502` | `StorageError` / `GitProviderError` | Falla temporal del storage (Blob/R2/fs) o de la API de GitHub — no es un problema de tu build, reintentá. |

> [!IMPORTANT]
> **No existe un `403` para el publish/upload.** `authorizeUpload` (`lib/auth.ts`) solo
> lanza `AuthError` (401) — probá primero que el `PUBLISH_TOKEN` del secret de tu repo
> coincide con el de `backstage-web` (o que tu sesión de Backstage está en el allowlist).
> El `403` (`ScaffoldForbiddenError`) es de **otro** endpoint — `/api/scaffold`, crear una
> miniapp nueva — no del publish de versiones.

### Entradas puntuales

**`401` al publicar**
> Causa: el `Bearer` del header no matchea ningún token válido — ni el `PUBLISH_TOKEN`
> primario ni ninguno listado en `PUBLISH_TOKENS_OLD` (rotación).
> Fix: en tu repo de miniapp, confirmá el secret `PUBLISH_TOKEN` (Settings → Secrets and
> variables → Actions). En local, confirmá que coincide con `PUBLISH_TOKEN` en
> `backstage-web/.env.local`. Si rotaste el token recientemente, mirá
> [`rotar-publish-token.md`](./rotar-publish-token.md).

**`409` al publicar**
> Causa: estás reusando un `version=` ya publicado — el registro es append-only, nunca se
> sobreescribe.
> Fix: usá `scripts/publish.mjs` (auto-bump: lee `latestVersion` del catálogo y calcula el
> siguiente patch solo) en vez de subir con una versión fija a mano. Ver
> [`LOCAL-DEV.md` §4.3](./LOCAL-DEV.md#43-publicar-a-backstage-local).

```bash
# opción manual (vos elegís la versión — repetirla da 409)
curl -X POST https://<tu-backstage>/api/miniapps/<id>/upload \
  -H "Authorization: Bearer <PUBLISH_TOKEN>" \
  -F version=0.1.0 -F file=@build.zip\;type=application/zip
```

**Manifest inválido / zip mal armado (`400`)**
> Síntomas concretos y su causa exacta:
> - `"file (zip) and version are required"` → falta el campo `file` o `version` en el
>   multipart.
> - `"manifest is not valid JSON"` → el campo `manifest` que mandaste no parsea.
> - `"empty archive"` → el zip no tiene entradas (¿zipeaste el directorio vacío?).
> - `"archive is missing <id>.container.js.bundle"` → el container no está **al raíz**
>   del zip (quedó en una subcarpeta), o el nombre no matchea `<id>.container.js.bundle`.
> - `"manifest.id \"x\" !== \"y\""` / `"manifest.version \"x\" !== \"y\""` → el manifest
>   que viaja en el form no coincide con el `id` de la URL o la `version` del form.
> - `"bad semver \"...\""` → la versión no es un semver válido (`x.y.z`).
> - `"publicá Android primero para la versión X"` → intentaste subir el zip iOS
>   (`platform=ios`) de una versión que **todavía no tiene** su chunk Android — el iOS
>   siempre se adjunta a una versión Android ya publicada, nunca crea versión nueva.
>
> Fix general: rehacé el zip con `cd build/generated/android && zip -r build.zip .`
> (contenido plano, sin subcarpeta) y verificá `manifest.json` contra `id`/`version`
> reales. Ver [`LOCAL-DEV.md` §4.2](./LOCAL-DEV.md#42-zip).

**`422 COMPAT_INCOMPATIBLE` al publicar**
> Causa: `COMPAT_ENFORCE=1` está activo en el ambiente y tu manifest tiene skew de
> `shared` o declara un nativo que el host no tiene compilado.
> Fix: ver [§3](#3-el-compat-gate-te-frena) — es el mismo chequeo que corre en CI, acá
> es el backstop server-side.

**CI de `publish.yml` falla**
> El workflow reusable (`miniapp-template/.github/workflows/publish.yml`, corrido vía
> `@main` en cada miniapp) hace: instalar deps → derivar manifest + compat gate → build
> android+iOS → zip → `publish.mjs`. Causas típicas por paso:
> | Paso que falla | Causa probable |
> |---|---|
> | Install deps | Falta `GITHUB_TOKEN`/permiso `read:packages` para `@dentvega/*` (no debería pasar — lo trae el scaffold), o `pnpm-lock.yaml` roto. |
> | Compat gate | Skew real; ver [§3](#3-el-compat-gate-te-frena). Si los scripts (`gen-manifest-shared.mjs`/`check-compat.mjs`) no existen todavía en tu repo, este paso se **saltea** en vez de fallar (esperá a que sincronice el template — [§5](#5-template-sync)). |
> | Build android | Error de compilación real en tu código — mismo error que verías con `pnpm bundle:android` local. |
> | Build iOS | **No bloquea el publish.** Es *best-effort*: si falla, el step lo loguea y sigue — tu miniapp queda publicada igual, solo en Android. |
> | Publish (`publish.mjs`) | `401`/`409`/`400` — ver tabla arriba. Los secrets `BACKSTAGE_URL`/`PUBLISH_TOKEN` vienen del scaffold; si no están, revisá que no los hayan borrado. |

---

## 2. La miniapp no monta en el host

`<MiniappHost/>` (paquete `@dentvega/host-runtime`, repo `backstagereactnative`) hace
`resolve → verify → download → mount`. Si cualquier paso falla, cae a una pantalla
**"Miniapp no disponible"** con un `reason` (`packages/host-runtime/src/loaderState.ts`)
que decide el mensaje y si hay botón **Reintentar**.

| `reason` | Mensaje al usuario | ¿Transitorio? | Qué significa | Qué hacer |
|---|---|---|---|---|
| `resolve-failed` | "No pudimos localizar esta miniapp." | ✅ Sí, reintentable | Falló el `GET /api/resolve?id=...` (red, Backstage caído, DNS). | Botón Reintentar visible. Si persiste: verificá que Backstage esté arriba y que `BACKSTAGE_URL` del build apunte a la URL correcta ([§4](#4-dev-loop-local)). |
| `download-failed` | "No pudimos descargar esta miniapp." | ✅ Sí, reintentable | El `resolve` funcionó pero la descarga del chunk (`.container.js.bundle`) falló — red, CDN, 404 al archivo. | Reintentar. Si el 404 es consistente: el chunk no está realmente en la URL que devolvió `resolve` (build corrupto o borrado del storage). |
| `integrity-failed` | "No pudimos verificar la integridad de esta miniapp." | ✅ Sí, reintentable | El sha256 del chunk descargado no matchea el `integrity` del manifest — descarga parcial/corrupta, o el CDN sirvió bytes distintos a los publicados. | Reintentar (suele ser una descarga parcial). Si persiste, es más serio: republicá la versión. |
| `invalid-manifest` | "La miniapp tiene un manifiesto inválido." | ❌ No, permanente | El manifest no tiene la forma esperada por el contrato (`isManifest` falla). | No hay reintento automático — hay que republicar con un manifest válido (normalmente corriendo `gen-manifest-shared.mjs`, no escribiéndolo a mano). |
| `skew` | "Esta miniapp no es compatible con esta versión de la app. Actualizá la app para usarla." | ❌ No, permanente | Una lib `shared` del manifest (ej. `react-query`) queda **fuera del rango** que el host realmente provee (`evaluate.ts` → `satisfiesShared`). | Del lado miniapp: alineá tu dep con el Host Contract y republicá ([§3](#3-el-compat-gate-te-frena)). Del lado usuario: no hay nada que hacer salvo esperar una versión compatible. |
| `host-too-old` | "Actualizá la app para usar esta miniapp." | ❌ No, permanente | El `minHostContract` del manifest (contractVersion o versión mínima de `react-native`) es más nuevo que el binario del host instalado en ese dispositivo. | El usuario necesita actualizar la app (nueva build del host). Del lado plataforma: bajá tu dependencia de la capability nueva si es evitable, o esperá el rollout del host. |

> [!NOTE]
> **Transitorio vs permanente lo decide `isRetryable()`** (`loaderState.ts`):
> `resolve-failed`, `download-failed` e `integrity-failed` son las únicas que muestran
> botón **Reintentar**; el resto (`invalid-manifest`, `skew`, `host-too-old`) no lo
> muestra porque reintentar no cambia nada — el problema es del manifest/versión, no de
> la red.

### Otras entradas frecuentes (no son `reason` del loader, pero aparecen al montar)

| Síntoma | Causa / fix |
|---|---|
| `useTheme must be used within a <ThemeProvider>` | `@dentvega/ui-kit` no está declarado `singleton: true` en `shared` — en **ambos** lados (`rspack.config.mjs` del host y de la miniapp). Es el error de integración más común. |
| "Acceso no autorizado" dentro de la miniapp | Al `<MiniappHost capabilities={grant}/>` no le pasaste la capability que tu `Entry.tsx` chequea. Revisá el `grant` en el punto de montaje. |
| `remoteEntryExports is undefined` / 404 al `.container.js.bundle` | El chunk no está servido en la URL que devolvió `resolve`, o no es un build estático (ver [§4](#4-dev-loop-local), "publiqué el dev server por error"). |

---

## 3. El compat gate te frena

El gate corre en dos lugares con **exactamente la misma lógica** (skew de `shared` +
módulos nativos faltantes): `scripts/check-compat.mjs` en CI (miniapp-template) y el
mismo chequeo server-side dentro de `POST /api/miniapps/:id/upload`
(`app/api/miniapps/[id]/upload/route.ts`).

| Resultado | Qué significa | Cómo lo arreglás |
|---|---|---|
| ✅ Compatible | Tus `shared` caen dentro del rango que el Host Contract expone y ningún nativo autolinkeado te falta. | Nada. |
| ❌ Skew | Una lib `shared` (ej. `@tanstack/react-query`) quedó fuera del rango que el host provee hoy. | Consultá `curl .../api/host-contract`, alineá tu versión instalada, corré `gen-manifest-shared.mjs` de nuevo y republicá. |
| ❌ Nativo faltante | Tu miniapp autolinkea un módulo nativo (Android/iOS compilado) que el host no tiene en su binario. | No lo agregues por tu cuenta. El `/upload` abre automáticamente un **issue** en el repo del host pidiéndolo (`openCapabilityRequests`) — coordiná el timeline, no lo fuerces. |
| ❌ `host-too-old` (en runtime, no en CI) | Tu `minHostContract` exige un contract/RN más nuevo que el binario instalado en el device del usuario. | Ver [§2](#2-la-miniapp-no-monta-en-el-host) — esto lo ve el host en producción, no vos en CI. |

### `NO_COMPATIBLE_VERSION`

Distinto de `skew`: este es un error de **`resolve`** (`lib/registry/registry.ts` →
`resolveMiniapp`, mapeado a **`404`** por `statusForError`), no del compat gate. Pasa
cuando:
- la miniapp está registrada pero **no tiene ninguna versión publicada todavía**
  (el caso más común — recién scaffoldeada, sin publish);
- pediste una `version` exacta que no existe;
- pediste un `range` (compatibilidad del host) y **ninguna** versión publicada lo
  satisface;
- pediste `platform=ios` y esa versión no tiene chunk iOS adjunto.

Fix: publicá una versión (§1), o revisá que el `range`/`platform` que estás pidiendo
tenga sentido contra lo realmente publicado (`curl .../api/resolve?id=<id>`).

### WARN vs ENFORCE

> [!IMPORTANT]
> **Modo por defecto: WARN.** El gate loguea la incompatibilidad y **te deja publicar
> igual** (`COMPAT_ENFORCE` sin setear, o `0`). Es una red de seguridad para ver el
> problema antes de que bloquee. Cuando la plataforma activa `COMPAT_ENFORCE=1`
> (Vercel env, y/o la variable de repo/org en GitHub Actions para el CI), el mismo
> chequeo:
> - en CI (`check-compat.yml`, siempre `COMPAT_ENFORCE=1` fijo — un check de PR que solo
>   avisa no sirve como gate): falla el build con `exit 1`.
> - en `publish.yml` (post-merge): idem, si la org/repo variable está en `1`.
> - server-side (`/upload`): rechaza con **`422`** y `code: "COMPAT_INCOMPATIBLE"`.
>
> Tratá cualquier WARN como algo a resolver, no a ignorar — puede pasar a bloquear en
> cualquier momento. Ver [`activar-compat-gates.md`](./activar-compat-gates.md) para la
> secuencia completa de rollout (Pasos 0-6) y el rollback (`COMPAT_ENFORCE=0` o borrar la
> var).

### Blast-radius (host → flota)

Si estás del lado del **host** y querés saber a quién rompe un bump de dependencia
**antes** de mergearlo, corré el chequeo contra la flota completa:

```bash
cd apps/host && BACKSTAGE_URL=https://<tu-backstage> node scripts/check-host-compat.mjs
```

Con branch protection activado (Paso 5.2 de `activar-compat-gates.md`), esto corre como
check requerido en el PR del host — un cambio que rompe alguna miniapp publicada **no se
puede mergear** salvo que se agregue el label `accept-breaking-contract` (deja registro
de quién aceptó el break).

---

## 4. Dev-loop local

Ver también la tabla completa en [`LOCAL-DEV.md` §7](./LOCAL-DEV.md#7-troubleshooting) —
acá están las entradas más pisadas.

| Síntoma | Causa / fix |
|---|---|
| Catálogo vacío en el host | `BACKSTAGE_URL` no se seteó al levantar el dev server (cayó al default `http://localhost:3999`). Confirmalo en la terminal del dev server del host y **reiniciá** — es una variable que se hornea en build-time (`DefinePlugin`), un reload de JS no alcanza. |
| 404 al chunk / `NO_COMPATIBLE_VERSION` en el emulador/device, pero `curl localhost:3999/...` anda bien desde tu Mac | Falta (o se perdió) `adb reverse tcp:3999 tcp:3999`. Se resetea si reiniciás el emulador o desconectás el device físico — es **manual siempre**, a diferencia de `:8081` (Metro) que `pnpm android` reenvía solo. |
| La miniapp no actualiza aunque publicaste una versión nueva | Publicaste el build del **dev server webpack** (`pnpm start` / `webpack-start`) en vez del build **estático** (`bundle:android`/`bundle:ios`). Esas URLs llevan `?platform=...` y el host no las puede cargar como remote federado. Rehacé con `bundle:android`. |
| El **Home** del host sigue mostrando el catálogo viejo | React Query cachea la lista — mandar la app a background y volver **no** la refetchea. Recargá la app entera (**RR** en el emulador, o relanzala) para limpiar el cache. |
| `useTheme must be used within a <ThemeProvider>` | `@dentvega/ui-kit` no está `singleton: true` en `shared` en **ambos** lados (host y miniapp). |
| El dev server webpack de la miniapp (`pnpm start`) no sirve para ver el cambio en el host | Correcto, por diseño: el host no tiene hot-reload del remote federado en el loop normal (§4 de `LOCAL-DEV.md`). Para eso están los **Modo 1** (dev-mount, Fast Refresh real) y **Modo 2** (`DEV_REMOTES`, reload federado) — ver `LOCAL-DEV.md` §6b. |
| iPhone real: `DEV_REMOTES`/Backstage local no conecta | En iPhone real `localhost` es el propio teléfono — usá la **IP LAN de tu Mac** (`http://192.168.x.x:9000`), no `localhost`. En el **Simulador** sí funciona `localhost` directo (comparte la red de la Mac) y no hace falta ningún `adb reverse`. |
| iPhone real: la app **carga y el Reload anda, pero editar no hace Fast Refresh** | Los dev servers RN estaban bindeados a `0.0.0.0` → Re.Pack le pasa ese host al cliente de HMR y el websocket `/hot` del device intenta `localhost` y muere (el bundle baja por HTTP, pero el HMR no). Arrancá con **`pnpm dev --device`**: bindea los dev servers a la **IP LAN concreta** y el Fast Refresh conecta (sin `iproxy`). Después, en el iPhone, **cerrá y reabrí la app** para que el cliente de HMR reconecte. Ver `LOCAL-DEV.md` §6b. |
| Backstage local no arranca / falta login | Revisá `.env.local`: `AUTH_SECRET`, `AUTH_GITHUB_ID`/`AUTH_GITHUB_SECRET` (callback OAuth `http://localhost:3999/api/auth/callback/github`), `PUBLISH_TOKEN`. Detalle completo en `SETUP.md` §4.2–4.4. |
| Quiero cero dependencias externas en local | No definas `KV_REST_API_URL`/`KV_REST_API_TOKEN`/`BLOB_READ_WRITE_TOKEN` en `.env.local` — sin esas vars Backstage cae solo a **fs storage** (`data/registry.json` + `public/chunks/`). |

---

## 5. Template-sync

> [!WARNING]
> **Lección dura, no la repitas:** nunca mergees un PR de template-sync con marcadores
> `<<<<<<<` sin resolver. Para git son **texto plano**, no un conflicto real — GitHub te
> deja apretar **Merge** igual. Si esos marcadores quedan dentro de un `package.json`
> (u otro JSON), lo rompen: `pnpm/action-setup`/`pnpm install` falla al parsearlo y el
> CI del repo queda muerto hasta que alguien lo arregla a mano.

| Síntoma | Causa | Fix |
|---|---|---|
| El PR de template-sync tiene `<<<<<<<` en el diff | Vos **y** el template editaron la misma línea de un archivo del grupo "del template" (`rspack.config.mjs`, `tsconfig.json`, `scripts/*`, etc.). | Resolvé el conflicto **antes** de mergear: dejá lo correcto de cada lado, pusheá al branch del PR, después mergeás. Es un conflicto de git normal — la única regla es no mergear con los marcadores adentro. |
| El CI quedó rojo justo después de mergear un template-sync | Probablemente mergeaste con marcadores sin resolver en un archivo JSON (`package.json` no debería tocarse — está en `.templatesyncignore` — pero otro JSON del template sí puede). | Arreglá el archivo a mano en un commit nuevo, quitando los marcadores, y volvé a correr el CI. |
| El sync tocó `src/Screen.tsx`, `manifest.json` o `package.json` | No debería pasar — están protegidos (`.templatesyncignore` del repo de la miniapp). Si igual aparecen en el diff, es un bug del mecanismo — avisá a la plataforma. | — |
| No sé si hay una actualización de template pendiente | Hoy te avisa la plataforma manualmente; no hay badge automático todavía. | Podés correr el sync vos igual, sin esperar aviso: `gh workflow run template-sync.yml --repo <owner>/miniapp-<id> --ref main`. |
| El CI del PR de sync falla (no por marcadores) | El cambio del template necesita un ajuste de tu lado (poco común). | Mirá el log del check — no mergees en rojo. |

Ver también [`actualizar-miniapp.md`](./actualizar-miniapp.md) (guía completa paso a
paso) y [`activar-compat-gates.md`](./activar-compat-gates.md#paso-2--sincronizar-la-flota)
(por qué el sync también es el vehículo que lleva los scripts del compat gate a cada
miniapp — hasta que sincroniza, el gate se saltea en vez de romper el publish).

---

**Ver también:**

- [`LOCAL-DEV.md`](./LOCAL-DEV.md) — el inner loop completo, si el síntoma
  aparece seguido y preferís entender el flujo entero en vez de parchar caso a caso.
- [`INTEGRATION-GUIDE.md`](./INTEGRATION-GUIDE.md) — el contrato que evita
  varios de estos síntomas de raíz (shared singletons, capabilities, manifest).
- [API & Schemas](/docs/api-reference) — para confirmar el comportamiento
  exacto de un endpoint o un código de error, más allá del síntoma observado.
- [`activar-compat-gates.md`](./activar-compat-gates.md) · [`actualizar-miniapp.md`](./actualizar-miniapp.md) ·
  [`QUICKSTART.md`](./QUICKSTART.md) · [`HOST-RUN.md`](./HOST-RUN.md) ·
  `backstagereactnative/docs/mounting-miniapps.md` (playbook + troubleshooting del lado host).
