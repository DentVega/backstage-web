# Integration Guide — construí y publicá tu miniapp

> Guía de onboarding para equipos **externos** (de otra empresa/organización) que van
> a construir y publicar una **miniapp** en esta plataforma. Al terminar vas a tener
> tu primera miniapp publicada y corriendo dentro del host móvil, entendiendo el
> **contrato** que tenés que cumplir para que eso funcione.
>
> Para levantar tu propia instancia del control-plane, ver [Setup](/docs/setup).

---

## 1. Para quién es esta guía

Sos un equipo externo — no operás ni tenés acceso al código interno de la
plataforma — y querés construir una funcionalidad (una "miniapp") que se sirva
dentro de la app móvil del host. Vas a:

1. Crear tu propio repo de miniapp (desde un template).
2. Desarrollarla localmente contra el host.
3. Publicarla con un `git push`.
4. Verla montada dentro de la app móvil.
5. Entender cómo versionarla y hacer rollback si algo sale mal.

No necesitás acceso al repo del host móvil ni al del control-plane (Backstage)
para nada de esto — solo necesitás **tu propio repo de miniapp** y la URL pública
del control-plane.

---

## 2. Cómo funciona, en 1 minuto

<div class="dgm dgm-arch">
<div class="dgm-plane">
<span class="dgm-plane-label">Tu repo de miniapp</span>
<ul>
<li>código + <code>./Entry</code></li>
<li>CI: build <b>android + iOS</b> → publish</li>
</ul>
<span class="dgm-plane-foot">tu equipo</span>
</div>
<div class="dgm-arrow">push</div>
<div class="dgm-plane dgm-accent">
<span class="dgm-plane-label">Backstage · control-plane</span>
<ul>
<li>Registry (catálogo)</li>
<li>Distribution API (<code>/resolve</code>)</li>
<li>Compat gate (Host Contract)</li>
</ul>
<span class="dgm-plane-foot">web</span>
</div>
<div class="dgm-arrow">resolve</div>
<div class="dgm-plane">
<span class="dgm-plane-label">Host móvil (app)</span>
<ul>
<li>resuelve por id · descarga el chunk</li>
<li>verifica sha256</li>
<li>monta <code>&lt;MiniappHost/&gt;</code></li>
</ul>
<span class="dgm-plane-foot">iOS + Android</span>
</div>
</div>

Una **miniapp** es un **remote de Module Federation**: un bundle de JS que expone
un punto de entrada (`./Entry`) y que el **host móvil descarga y monta en
runtime**, no en build-time. Vos desarrollás y publicás tu miniapp en **tu
propio repo**, con tu propio ciclo de release. **Backstage** (el control-plane)
la cataloga, versiona, sirve el chunk publicado y — el punto central de esta
guía — **gatea la compatibilidad** contra lo que el host realmente provee, para
que una miniapp mal alineada no rompa la app en el dispositivo de un usuario
real.

No hay compilación conjunta: el host no necesita conocer tu miniapp de
antemano, ni vos necesitás el código del host. El único acoplamiento es un
**contrato versionado** (qué comparte el host, qué esperás vos) — la Sección 5
es justamente eso.

---

## 3. Prerrequisitos

| Qué necesitás | Detalle |
|---|---|
| Cuenta de GitHub | El login con el que vas a operar en Backstage y en tu repo de miniapp. |
| Estar habilitado para **crear** una miniapp | Solo un **platform-admin** (login en el allowlist del control-plane) puede scaffoldear un repo nuevo. Si tu login no está habilitado, pedile a un admin que **cree el repo por vos** o que te dé de alta. |
| Node 20+, pnpm (o npm) | Para instalar dependencias y correr los scripts del template. |
| Acceso a paquetes privados del ecosistema (`@dentvega/miniapp-contract`, `@dentvega/ui-kit`) | El template trae un `.npmrc` que usa `${GITHUB_TOKEN}` con scope `read:packages` — nunca un token hardcodeado. |
| (Solo para dev local con el host) Toolchain de React Native | OpenJDK 17 para Android, Xcode+CocoaPods para iOS si también vas a correr el host en tu máquina. Normalmente **no** hace falta: podés desarrollar tu miniapp con los modos dev de la Sección 6 sin tener el repo del host clonado en la mayoría de los casos. |

No necesitás:
- Acceso al repo del host móvil (`backstagereactnative`).
- Acceso al repo del control-plane (`backstage-web`).
- Ningún secreto de infraestructura — el scaffold te los deja ya cargados en tu repo (§4).

---

## 4. Paso 1 — Crear tu miniapp

Desde Backstage (`/create`), un **platform-admin** (puede ser alguien de tu
propio equipo si te habilitaron, o un admin de la plataforma) scaffoldea tu
repo:

1. Logueado en Backstage, abrí `https://<tu-backstage>/create`.
2. Completá:
   - **id** — minúsculas + guion bajo, ej. `cards_wallet`. Es el identificador
     único de tu miniapp en todo el sistema (catálogo, `resolve`, `loadRemote`).
   - **name** — nombre legible.
   - **owner** — tu cuenta u organización de GitHub. El form **prellena** este
     campo con tu login de GitHub (de la sesión), pero es editable si el owner
     real es una organización distinta.
3. Enviar.

Equivalente por API (si tenés sesión con permiso de scaffold):

```bash
curl -X POST https://<tu-backstage>/api/scaffold \
  -H "content-type: application/json" -b <cookie-de-sesión> \
  -d '{"id":"cards_wallet","name":"Cards Wallet","owner":"<tu-org-o-usuario>"}'
```

**Qué obtenés:**

- Un repo nuevo `github.com/<owner>/miniapp-<id>` (privado), clonado desde el
  template `miniapp-template`, con placeholders (`__MINIAPP_ID__`) ya
  reemplazados.
- El **CI ya cableado**: workflows reusables (`ci.yml`, `publish.yml`,
  `check-compat.yml`) que buildean, gatean compatibilidad y publican sin que
  tengas que escribir nada de pipeline.
- Dos **secrets de GitHub Actions** ya cargados en tu repo: `BACKSTAGE_URL` (a
  dónde publicar) y `PUBLISH_TOKEN` (con qué autenticarse). No los toques a
  mano — ya están.
- Tu miniapp **registrada en el catálogo** de Backstage, aunque todavía sin
  ninguna versión publicada (`GET /api/resolve?id=<id>` va a responder
  `NO_COMPATIBLE_VERSION` hasta el primer publish).

Clonate el repo y arrancá desde ahí:

```bash
git clone git@github.com:<owner>/miniapp-<id>.git
cd miniapp-<id>
pnpm install
```

Estructura relevante que trae el template:

```
manifest.json           id, version, entry, shared, capabilities (lo completa el CI)
rspack.config.mjs       Module Federation — expone ./Entry
src/Entry.tsx           punto de entrada federado — chequea tu capability
src/Screen.tsx          tu UI real — acá construís tu feature
scripts/                build, publish, gen-manifest-shared, check-compat
.github/workflows/      CI: build android+iOS → compat gate → publish
```

---

## 5. Paso 2 — El contrato que debés cumplir

**Esta es la sección más importante de la guía.** Si tu miniapp no cumple esto,
no monta, o monta pero rompe el runtime del host (theme, cachés, crashes por
nativos faltantes).

### 5.1 Exponer `./Entry`

Tu miniapp tiene que exponer un módulo `./Entry` vía Module Federation — es lo
que el host carga con `loadRemote('<tu-id>/Entry')`. El template ya lo deja
armado en `rspack.config.mjs` (`exposes: { './Entry': './src/Entry.tsx' }`) y
`src/Entry.tsx` con la firma correcta (`MiniappEntryProps`, recibe
`{ capabilities }`). No necesitás tocar eso — sí necesitás mantenerlo.

### 5.2 Usar los singletons del host, EN RANGO

El host expone un conjunto fijo de librerías **compartidas** ("Host Contract").
Tu miniapp puede usarlas, pero **tiene que declararlas como `singleton: true`
en su `rspack.config.mjs`** y su versión instalada tiene que caer dentro del
rango que el host soporta. Si tu versión queda afuera de ese rango → **skew**
(incompatible).

| Lib que el host provee | Por qué importa que sea singleton |
|---|---|
| `react` | Dos copias de React en runtime = crash / hooks rotos. |
| `react-native` | Idem — debe ser exactamente la misma instancia. |
| `@tanstack/react-query` | Tiene estado global (query cache) — si no es singleton, tu miniapp tiene su propia caché aislada e inconsistente. |
| `@shopify/flash-list` | Requiere el mismo runtime nativo que el host ya compiló. |
| `zustand` | Estado — mismo motivo que react-query. |
| `@react-navigation/native` | Contexto de navegación compartido con el host. |
| `@react-navigation/native-stack` | Idem. |
| `@dentvega/ui-kit` | Tiene un `ThemeProvider` con contexto de React — si no es singleton, `useTheme` explota con "must be used within a `<ThemeProvider>`" (el error más común al integrar). |

Ejemplo de `shared` correcto en tu `rspack.config.mjs`:

```js
shared: {
  react:                   { singleton: true, eager: false, requiredVersion: '18.3.1' },
  'react-native':          { singleton: true, eager: false, requiredVersion: '0.76.6' },
  '@tanstack/react-query': { singleton: true, requiredVersion: '^5.0.0' },
  '@shopify/flash-list':   { singleton: true, requiredVersion: '^1.7.0' },
  '@dentvega/ui-kit':      { singleton: true, eager: false, requiredVersion: '^0.1.0' },
  // + zustand / navigation si tu miniapp los usa
}
```

**Regla:** solo declarás como `shared` las libs que realmente usás — no hace
falta declarar las ocho si tu miniapp solo usa `react`, `react-native` y
`@dentvega/ui-kit`.

No inventes la versión: apuntá al **Host Contract publicado**, no a lo que
vos tenés instalado a ciegas. Podés consultarlo en cualquier momento:

```bash
curl -s https://<tu-backstage>/api/host-contract | python3 -m json.tool
# → { contractVersion, reactNative, shared: { "react": "18.3.1", ... }, nativeModules: [...] }
```

### 5.3 No requerir nativos que el host no tenga

Si tu miniapp autolinkea un módulo nativo (algo que necesita código
Android/iOS compilado, no solo JS), y el host **no** tiene ese módulo en su
binario, el compat gate la frena. El host hoy trae (ejemplos):

```
@shopify/flash-list
react-native-safe-area-context
react-native-screens
@callstack/repack
```

Si necesitás un nativo que no está en esa lista (ej. `react-native-mmkv`),
**no lo agregues a la ligera**: el gate lo va a rechazar y abre un issue
automático pidiendo ese nativo al equipo del host. Coordiná con la plataforma
antes de depender de un nativo nuevo.

### 5.4 Declarar tus `capabilities`

Tu miniapp no recibe credenciales crudas del usuario — recibe un **grant
acotado a la sesión**, inyectado por el host en tu `./Entry`. Vos declarás qué
permisos necesitás en `manifest.json`, por ejemplo:

```json
"capabilities": ["session:whoami"]
```

Ejemplos de capabilities: `accounts:read`, `session:whoami`. Tu `Entry.tsx`
tiene que chequear que el grant las incluya antes de renderizar tu feature:

```tsx
const allowed =
  capabilities.granted.includes(REQUIRED_CAPABILITY) && !capabilities.isRevoked();

if (!allowed) {
  return <AccesoNoAutorizado permiso={REQUIRED_CAPABILITY} />;
}
return <Screen />;
```

Sin el grant correcto, tu miniapp debe degradar a una pantalla de acceso
denegado — **nunca** asumas que tenés el permiso.

### 5.5 El `manifest.json` — debe ser *truthful*

Tu manifest lleva: `id`, `version`, `entry`, `shared`, `capabilities`,
`minHostContract` (y `nativeModules` si aplica). No lo escribas a mano en cada
release: el CI del template corre `scripts/gen-manifest-shared.mjs`, que:

- Deriva `shared` como `^<versión-instalada>` de tus dependencias,
  intersectadas con lo que el Host Contract expone — así tu manifest **no
  miente** sobre lo que realmente usás.
- Detecta `nativeModules` corriendo `react-native config` y viendo qué
  autolinkea.
- Calcula `minHostContract` — el host mínimo que provee todo lo que tu
  miniapp usa (versión de React Native + `contractVersion`).

Esto corre automático en tu CI; no necesitás invocarlo manualmente salvo que
quieras inspeccionar el resultado localmente:

```bash
BACKSTAGE_URL=https://<tu-backstage> node scripts/gen-manifest-shared.mjs
```

---

## 6. Paso 3 — Desarrollar local

El host **no** tiene hot-reload de tu remote federado — resuelve por id contra
Backstage y carga un chunk estático. Por eso hay dos modos de dev pensados
para iterar rápido sin pasar por build+publish en cada cambio (documentados en
detalle en `apps/host/RUN.md` del repo del host):

| Modo | Qué hace | Cuándo usarlo |
|---|---|---|
| **Modo 1 — dev-mount** | El host importa tu `Entry` **directo** desde tu miniapp clonada al lado y la renderiza con un grant mock. Fast Refresh instantáneo (host + miniapp comparten bundle). No requiere que tu miniapp esté en el catálogo. | Construir/ajustar UI — el caso más frecuente, sobre todo para una miniapp nueva. |
| **Modo 2 — remotes federados** | Tu miniapp corre su propio dev server (`pnpm start`, puerto `:9000`) y el host la carga como chunk remoto real (`DEV_REMOTES="<id>=http://localhost:9000"`). Prueba la federación real (boundary MF, resolve, integridad). | Verificar que monta como remoto federado, capabilities, o desarrollar varias miniapps a la vez (cada una en su puerto). |

Ninguno de los dos modos afecta el build de release — son `__DEV__`-only.

Ejemplo Modo 1 (desde el repo del host, si lo tenés clonado):

```bash
DEV_MINIAPP_PATH=../miniapp-cards_wallet pnpm --filter @app/host start
pnpm --filter @app/host android
# En el Home del host → "▶ Dev Mount" → editás src/Screen.tsx → refresco instantáneo
```

Ejemplo Modo 2:

```bash
# tu repo de miniapp
pnpm start   # dev server en :9000

# repo del host
DEV_REMOTES="cards_wallet=http://localhost:9000" pnpm --filter @app/host start
adb reverse tcp:9000 tcp:9000   # solo Android físico/emulador
pnpm --filter @app/host android
```

Cuando estés conforme y quieras ver el build real (el que se va a publicar),
usá el **build estático** — nunca el dev server webpack para esto, porque sus
URLs llevan `?platform=...` y el host no puede cargarlas como remote:

```bash
pnpm bundle:android    # → build/generated/android/<id>.container.js.bundle + chunks
pnpm bundle:ios        # opcional
```

> Si no tenés el repo del host clonado, igual podés desarrollar tu UI con
> `pnpm start` dentro de tu propio repo y probar el build estático localmente;
> solo necesitás el host para ver el montaje real end-to-end. Coordiná con la
> plataforma si necesitás acceso a un ambiente de prueba del host.

---

## 7. Paso 4 — Publicar

Publicar es tan simple como un `git push a main`. El CI hace todo:

```bash
git add -A
git commit -m "feat: primera versión de mi miniapp"
git push origin main
```

Qué dispara ese push (los workflows reusables ya vienen cableados en tu repo):

1. **Compat gate en PR** (si publicás vía PR): `check-compat.yml` corre contra
   el Host Contract publicado y marca ✗ en el PR si hay incompatibilidad —
   antes de mergear.
2. **Build**: buildea el chunk para **android y iOS** (build estático, el
   mismo que harías con `bundle:android`/`bundle:ios`).
3. **Publish**: `scripts/publish.mjs <android.zip> [ios.zip]`:
   - Lee la `latestVersion` actual de tu miniapp en el catálogo.
   - Calcula el **siguiente patch automáticamente** (auto-bump) — no tenés que
     editar la versión a mano en cada push.
   - Publica **ambos chunks (android + iOS) a la misma versión** — el upload
     de iOS se adjunta a la versión recién creada por el de android.
   - El registro es **inmutable**: si dos publishes intentan usar la misma
     versión, el segundo falla con `409`.
   - Sube los chunks al storage de producción (R2/Blob) con **integridad
     sha256** — el host verifica ese hash antes de ejecutar el código
     descargado.
4. **iOS es best-effort**: si el build de iOS falla, **no bloquea** el publish
   de Android. Tu miniapp queda disponible en Android igual.

Podés también disparar un publish manual (sin push) con el botón **"Deploy"**
en el detalle de tu miniapp en Backstage, o el equivalente CLI:

```bash
gh workflow run publish.yml --repo <owner>/miniapp-<id> --ref main
```

Verificar que quedó publicada:

```bash
curl "https://<tu-backstage>/api/resolve?id=<id>"                # Android, versión más alta
curl "https://<tu-backstage>/api/resolve?id=<id>&platform=ios"   # iOS, si se publicó
```

Publicar una **nueva versión** de una miniapp ya listada la actualiza **sin
recompilar el host**: `resolve` siempre devuelve la versión más alta
compatible, y el host la descarga la próxima vez que la abra un usuario.

---

## 8. Paso 5 — Versionar y rollback

- Las versiones son **inmutables** — nunca se sobreescribe una ya publicada.
  Un bug en `1.2.3` no se "arregla" republicando `1.2.3`; se publica `1.2.4`.
- El host resuelve la versión que Backstage le indique: `pinnedVersion ??
  latest`. Por defecto sirve siempre la **última**.
- Si una versión nueva rompe algo, un **admin o maintainer** puede **fijar
  (pin)** una versión anterior conocida-buena desde el detalle de la miniapp
  en Backstage (o `PUT /api/miniapps/<id>/pin`). El rollback es **instantáneo**
  — no requiere re-deploy del host, porque el host resuelve en runtime.
- Para volver a servir la última versión, se "despina" (pin a `null`).

```bash
curl -X PUT https://<tu-backstage>/api/miniapps/<id>/pin \
  -H "content-type: application/json" -b <cookie-de-sesión-de-un-maintainer> \
  -d '{"version":"1.2.2"}'
```

---

## 9. El compat gate — cómo pasarlo

El gate de compatibilidad corre en tu CI (`check-compat.mjs`) y también como
backstop del lado servidor al subir un build. Así se interpreta cada
resultado:

| Resultado | Qué significa | Cómo lo arreglás |
|---|---|---|
| ✅ **Compatible** | Tus `shared` están dentro del rango que el host provee y ningún nativo autolinkeado te falta. | Nada — seguí publicando. |
| ❌ **Skew** | Una lib compartida (ej. `react-query`) quedó **fuera del rango** que el host soporta hoy. | Alineá tu versión instalada con la del Host Contract (`curl .../api/host-contract`) y volvé a correr `gen-manifest-shared.mjs` / publicar. |
| ❌ **Nativo faltante** | Tu miniapp autolinkea un módulo nativo que el host **no** tiene compilado en su binario. | No lo agregues por tu cuenta — el gate abre un **issue automático** pidiendo ese nativo al equipo del host. Coordiná el timeline con la plataforma; mientras tanto, evitá esa dependencia. |
| ❌ **host-too-old** (en runtime, no en CI) | Tu `minHostContract` exige un host más nuevo que el binario instalado en el dispositivo del usuario. | Bajá tu dependencia de la capability nueva, o esperá a que los usuarios actualicen el binario del host (esto lo ve el host en producción, no vos en CI). |

**Modo por defecto: WARN.** El gate hoy **loguea** una incompatibilidad y te
**deja publicar** igual — es una red de seguridad para que veas el problema
antes de que se vuelva bloqueante. Cuando la plataforma active
`COMPAT_ENFORCE=1`, el mismo chequeo **rechaza el publish con HTTP 422** (o
falla el build de CI) en vez de solo avisar. Tratá cualquier WARN como algo a
resolver, no a ignorar — puede pasar a bloquear en cualquier momento.

---

## 10. Do's & Don'ts

**Hacé:**
- Declará como `singleton` **solo** las libs compartidas que tu miniapp
  realmente usa, y mantenelas alineadas al Host Contract.
- Corré `gen-manifest-shared.mjs` (o dejá que lo corra el CI) antes de cada
  publish — no escribas `shared`/`nativeModules` a mano.
- Usá el **build estático** (`bundle:android`/`bundle:ios`) para lo que vayas
  a publicar — nunca el dev server webpack.
- Chequeá la capability requerida en `Entry.tsx` antes de renderizar tu
  feature — nunca asumas que el grant está.
- Contenete al scope de tu propio dominio de datos; usá `capabilities` para
  cualquier dato que necesites del host, no accesos directos.

**No hagas:**
- No agregues un módulo nativo nuevo sin coordinarlo antes con la plataforma —
  el gate lo va a frenar igual.
- No dupliques una lib con estado (react-query, zustand, tu propio ui-kit) sin
  marcarla singleton — vas a romper theme/caché en runtime, no en build.
- No hardcodees `BACKSTAGE_URL` ni `PUBLISH_TOKEN` — ya vienen como secrets en
  tu repo desde el scaffold.
- No repitas una versión ya publicada esperando "sobreescribirla" — el
  registro es inmutable, vas a recibir `409`.
- No publiques builds del dev server webpack (`pnpm start` / `webpack-start`)
  — esas URLs con `?platform=...` no cargan como remote federado.

---

## 11. Permisos & gobernanza

- **Crear una miniapp nueva** (scaffold) requiere ser **platform-admin**
  (login en el allowlist del control-plane). Si tu equipo no tiene ese
  permiso, pedile a un admin de la plataforma que scaffoldee el repo por
  ustedes.
- **Gestionar una miniapp existente** (publicar/deploy manual, pin/rollback,
  gestionar maintainers) requiere ser **platform-admin O maintainer** de esa
  miniapp específica — no hace falta ser admin de toda la plataforma para
  operar la tuya.
- **Ser maintainer** de una miniapp solo se le puede otorgar a alguien que ya
  sea **collaborator del repo de GitHub** de esa miniapp — Backstage valida
  esto contra la API de GitHub, no confía en el cliente. Es decir: primero
  agregás a la persona como collaborator en GitHub, después la sumás como
  maintainer en Backstage.
- El **push a `main`** en tu propio repo (con `PUBLISH_TOKEN` ya cargado como
  secret) es suficiente para publicar — no requiere sesión de Backstage. Ese
  token es específico de tu miniapp; no lo compartas ni lo hardcodees en otro
  lado.

---

## 12. Ayuda & referencia

| Documento | Qué cubre |
|---|---|
| `apps/host/RUN.md` (repo del host) | Referencia rápida de los 4 escenarios de correr el host + los modos de dev-loop (Modo 1/2) en detalle. |
| `docs/mounting-miniapps.md` (repo del host) | Playbook de montar una miniapp en cualquier punto del host + troubleshooting del lado host. |
| `docs/miniapps-guide.md` (este repo) | Ciclo de vida completo crear → publicar → usar, con foco en el flujo vía UI/API de Backstage. |
| `docs/LOCAL-DEV.md` (este repo) | El inner loop 100% local (Backstage + host + miniapp en tu máquina), útil si además vas a levantar el host localmente. |
| `README.md` del `miniapp-template` | Qué trae el template, estructura de carpetas, requisitos. |

**Troubleshooting rápido — señales comunes:**

| Síntoma | Causa probable |
|---|---|
| `useTheme must be used within a <ThemeProvider>` | `@dentvega/ui-kit` no está declarado `singleton` en tu `shared` (o el host tampoco lo tiene así — pero eso ya está resuelto de su lado). |
| `resolve` → `NO_COMPATIBLE_VERSION` | Tu miniapp está registrada pero todavía no publicaste ninguna versión. |
| `409` al publicar | Estás reusando un `version` ya publicado — dejá que `publish.mjs` haga el auto-bump. |
| `401` al publicar | `PUBLISH_TOKEN` ausente o inválido en el secret de tu repo. |
| "Acceso no autorizado" dentro de tu propia miniapp | El grant que te llega en `Entry.tsx` no incluye la capability que estás chequeando — revisá `manifest.json` vs. lo que pedís en código. |
| CI marca ❌ de compat | Ver la Sección 9 — leé el detalle del log (te dice si es skew de una lib puntual o un nativo faltante). |

Si algo de esta guía no coincide con lo que ves en la práctica, es señal de
que el contrato cambió del lado del host — consultá el Host Contract vigente
(`GET /api/host-contract`) como fuente de verdad y, si hace falta, abrí un
issue en tu repo de miniapp o coordiná con el equipo de plataforma.

---

## 13. Próximos pasos

- [Guía de miniapps](/docs/miniapps-guide) — el mismo ciclo crear → publicar →
  usar pero visto desde Backstage (UI/API), útil si además vas a operar tu
  miniapp desde ahí (pin, maintainers, borrado).
- [Desarrollo local](/docs/local-dev) — el inner loop completo con hot-reload
  (Modo 1/2) si vas a pasar más tiempo iterando en tu máquina.
- [Compat gate](/docs/compat-gate) — el porqué y el detalle técnico del gate
  que viste corriendo en la Sección 9, para entender qué exactamente valida.
- [Troubleshooting](/docs/troubleshooting) — más síntomas y fixes que la
  tabla rápida de arriba, organizados por área (publish, montaje, compat, dev-loop).
