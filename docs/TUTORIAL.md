# Tutorial — de un botón a un feature publicado

> Esta es la versión **larga y con código real** de cómo se construye una miniapp de
> punta a punta: creás el repo, tocás el componente de verdad, la buildeás con los
> comandos exactos, la publicás a mano (los mismos pasos que corre tu CI) y la ves
> montada en el host. Si querés la versión rápida de 10 minutos, andá al
> [Quickstart](/docs/quickstart); si necesitás el contrato completo (compat gate,
> capabilities, permisos), la referencia es la [Integration Guide](/docs/integration-guide).
> Acá vamos más lento, pero no salteamos nada.

> [!NOTE]
> Una **miniapp** es un *remote* de Module Federation: un bundle de JS que expone
> `./Entry` y que el **host móvil descarga y monta en runtime** (no en build-time del
> host). La desarrollás en **tu propio repo**, y Backstage la cataloga, versiona y
> distribuye.

---

## 1. Qué vamos a construir

Una miniapp mínima pero real: **Hello Counter**. Una pantalla con un título, una
tarjeta que muestra un número, y un botón que lo incrementa. Es deliberadamente
simple — la idea es que recorras el ciclo completo (crear → codear → buildear →
publicar → ver en el host) sin que la lógica del feature te distraiga.

Va a quedar con la misma forma que `hellow_widget` (una miniapp real ya publicada en
esta plataforma): un `Screen.tsx` que usa los primitivos de `@dentvega/ui-kit`, un
`Entry.tsx` que verifica una capability antes de renderizar, y un `manifest.json` que
declara esa capability. La diferencia es que la nuestra tiene **estado** (el contador),
no solo texto estático.

No vamos a agregar ninguna capability nueva: reusamos `session:whoami`, la que ya trae
el template — así el foco queda en el flujo de build/publish, no en el contrato de
permisos (eso lo cubre a fondo la Integration Guide, sección 5.4).

El único archivo que vas a **editar** es `src/Screen.tsx`.

---

## 2. Crear el repo

El camino real y reproducible es el scaffolder de Backstage: **`/create`**. Clona el
`miniapp-template`, sustituye los placeholders (`__MINIAPP_ID__`, `__MINIAPP_NAME__`,
`__MINIAPP_OWNER__`) y registra la miniapp en el catálogo — todo en un paso.

1. Entrá a `https://<tu-backstage>/create` (logueado con GitHub).
2. Completá el form:
   - **id** — `hello_counter` (minúsculas, dígitos, `-`/`_`; el form valida esto en
     vivo con la misma regla que usa el server).
   - **name** — `Hello Counter`.
   - **owner** — viene prellenado con tu usuario de GitHub; dejalo o cambialo si el
     dueño real del repo es una organización.
3. Apretá **Crear miniapp**.

> [!IMPORTANT]
> Crear una miniapp nueva requiere estar en el allowlist de plataforma
> (`SCAFFOLD_ALLOWED_LOGINS`). Si tu login no está habilitado, pedile a un
> platform-admin que la scaffoldee y te agregue como **maintainer** de ese repo
> puntual — eso sí lo podés hacer vos después sin ser admin de toda la plataforma.

Lo mismo por API, si tenés sesión con permiso de scaffold:

```bash
curl -X POST https://<tu-backstage>/api/scaffold \
  -H "content-type: application/json" -b <cookie-de-sesión> \
  -d '{"id":"hello_counter","name":"Hello Counter","owner":"<tu-owner>"}'
```

**Qué te deja esto:**

- Un repo nuevo `github.com/<owner>/miniapp-hello_counter` (privado), clonado del
  template, con los placeholders ya reemplazados.
- El **CI ya cableado**: los workflows reusables del template (`ci.yml`,
  `publish.yml`, `check-compat.yml`) apuntando a `@main` — no escribís pipeline.
- Dos **secrets de GitHub Actions** ya sembrados: `BACKSTAGE_URL` y `PUBLISH_TOKEN`.
  No los toques a mano.
- Tu miniapp **en el catálogo** de Backstage, todavía sin ninguna versión publicada
  (`GET /api/resolve?id=hello_counter` te va a dar `NO_COMPATIBLE_VERSION` hasta el
  primer publish — es esperado, lo arreglamos en la sección 6).

Clonate el repo y instalá:

```bash
git clone git@github.com:<owner>/miniapp-hello_counter.git
cd miniapp-hello_counter
pnpm install
```

---

## 3. El esqueleto

Esto es lo que trae el repo recién creado (ya con los placeholders resueltos):

```
manifest.json           Manifest: id, version, entry, shared, capabilities
rspack.config.mjs       Re.Pack / Module Federation — expone ./Entry
src/Entry.tsx           Punto de entrada federado — chequea la capability
src/Screen.tsx          Tu feature — el único archivo que vas a tocar
scripts/                build, publish, gen-manifest-shared, check-compat, ...
.github/workflows/      CI: build android+iOS → compat gate → publish
```

### `manifest.json`

```json
{
  "id": "hello_counter",
  "version": "0.1.0",
  "entry": "./Entry",
  "shared": [
    { "name": "react", "requiredRange": "^18.3.0", "singleton": true },
    { "name": "react-native", "requiredRange": "^0.76.0", "singleton": true }
  ],
  "capabilities": ["session:whoami"]
}
```

No hace falta tocarlo para este tutorial: `shared` se **rederiva sola** en cada
publish (`scripts/gen-manifest-shared.mjs`, corre en tu CI) a partir de tus deps
reales, y no vamos a pedir una capability nueva.

### `rspack.config.mjs` — dónde se expone `./Entry`

```js
new Repack.plugins.ModuleFederationPluginV2({
  name: 'hello_counter',
  filename: 'hello_counter.container.js.bundle',
  exposes: {
    './Entry': './src/Entry.tsx',
  },
  shared: {
    react: { singleton: true, eager: false, requiredVersion: '18.3.1' },
    'react-native': { singleton: true, eager: false, requiredVersion: '0.76.6' },
    '@dentvega/ui-kit': { singleton: true, eager: false, requiredVersion: '^0.1.0' },
  },
}),
```

Esto es lo que hace que el host pueda hacer `loadRemote('hello_counter/Entry')`. No lo
toques salvo que agregues una lib compartida nueva.

### `src/Entry.tsx` — el punto de entrada federado

```tsx
import React from 'react';
import type {MiniappEntryProps} from '@dentvega/miniapp-contract';
import {AppText, Box} from '@dentvega/ui-kit';
import {Screen} from './Screen';

// The capability this miniapp requires. Change it to what your feature needs
// and keep it in sync with manifest.json.
const REQUIRED_CAPABILITY = 'session:whoami';

export default function Entry({capabilities}: MiniappEntryProps): React.JSX.Element {
  const allowed =
    capabilities.granted.includes(REQUIRED_CAPABILITY) && !capabilities.isRevoked();

  if (!allowed) {
    return (
      <Box padding="xl" gap="sm">
        <AppText variant="title" color="danger" accessibilityRole="header">
          Acceso no autorizado
        </AppText>
        <AppText variant="body" color="textMuted">
          Esta miniapp necesita el permiso “{REQUIRED_CAPABILITY}”.
        </AppText>
      </Box>
    );
  }

  return <Screen />;
}
```

`capabilities` es un `CapabilityGrant` (`{ granted: readonly Capability[], isRevoked:
() => boolean }`) — el host te lo inyecta, **nunca** te da credenciales crudas. No hace
falta tocar este archivo para el tutorial: seguimos pidiendo `session:whoami`.

### `src/Screen.tsx` — el punto de partida

Así viene de fábrica (el mismo placeholder que trae cualquier miniapp recién
scaffoldeada, `hellow_widget` incluida):

```tsx
import React from 'react';
import {SafeAreaView, StyleSheet} from 'react-native';
import {AppText, Box, Card, useTheme} from '@dentvega/ui-kit';

export function Screen(): React.JSX.Element {
  const theme = useTheme();
  return (
    <SafeAreaView style={[styles.fill, {backgroundColor: theme.colors.background}]}>
      <Box padding="xl" gap="lg" style={styles.fill}>
        <AppText variant="heading" accessibilityRole="header">
          Hello Counter
        </AppText>
        <Card>
          <AppText variant="body" color="textMuted">
            Miniapp generada desde el template. Edita src/Screen.tsx para construir
            tu feature.
          </AppText>
        </Card>
      </Box>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1},
});
```

Este es el archivo que vamos a editar en la próxima sección.

---

## 4. Escribir el feature

Reemplazá `src/Screen.tsx` completo por esto — mismo esqueleto, pero con estado y un
botón:

```tsx
import React, {useState} from 'react';
import {SafeAreaView, StyleSheet} from 'react-native';
import {AppText, Box, Button, Card, useTheme} from '@dentvega/ui-kit';

export function Screen(): React.JSX.Element {
  const theme = useTheme();
  const [count, setCount] = useState(0);

  return (
    <SafeAreaView style={[styles.fill, {backgroundColor: theme.colors.background}]}>
      <Box padding="xl" gap="lg" style={styles.fill}>
        <AppText variant="heading" accessibilityRole="header">
          Hello Counter
        </AppText>
        <Card>
          <Box gap="md">
            <AppText variant="body" color="textMuted">
              Vos apretaste el botón:
            </AppText>
            <AppText variant="display">{count}</AppText>
            <Button label="Sumar +1" onPress={() => setCount(c => c + 1)} />
          </Box>
        </Card>
      </Box>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  fill: {flex: 1},
});
```

Qué cambió, y por qué es código "real" del kit (no inventado):

- `Button` es un primitivo de `@dentvega/ui-kit` (`export { Button }` en su
  `index.d.ts`), con `label: string` y las props de `PressableProps` de React Native
  (`onPress`, `disabled`, etc.) — no un `<Pressable>` armado a mano.
- `AppText variant="display"` es un token de tipografía real
  (`typography.display`, 40px/800) — usalo para números grandes como este contador.
- `Box gap="md"` anida adentro de `Card` sin problema: `Card` es solo un `View` con
  estilo; `Box` maneja `padding`/`gap`/`background`/`radius` vía tokens.
- Todo el estado (`useState`) vive **local** al componente — no toca nada del host.

> [!TIP]
> Si tenés el repo del host clonado al lado, podés ver este cambio con Fast Refresh
> **antes** de buildear/publicar nada, montando tu miniapp local contra el host
> (Modo 1 — dev-mount):
> ```bash
> DEV_MINIAPP_PATH=../miniapp-hello_counter pnpm --filter @app/host start
> ```
> (o, con un comando, agregala al `dev-miniapps.config.mjs` con `mode: 'mount'` y corré `pnpm dev`.)
> Está detallado en [Desarrollo local](/docs/local-dev) y en la Integration Guide §6.
> No es un paso obligatorio para este tutorial — seguimos directo al build estático.

---

## 5. Buildear

El build que importa es el **estático** (el que se publica) — nunca el dev server
webpack (`pnpm start`), porque sus URLs llevan `?platform=...` y el host no las puede
cargar como remote federado.

::::tabs

:::tab{label="Android"}
```bash
pnpm bundle:android
```
:::

:::tab{label="iOS"}
```bash
pnpm bundle:ios
```
:::

::::

Estos dos comandos son exactamente los que corre tu CI (`.github/workflows/publish.yml`,
step "Build chunks"). El resultado — el container federado (`hello_counter.container.js.bundle`)
**más** sus chunks — queda co-ubicado en:

```
build/generated/android/hello_counter.container.js.bundle   (+ chunks)
build/generated/ios/hello_counter.container.js.bundle       (+ chunks)
```

> [!WARNING]
> Los chunks federados van a `build/generated/<platform>/`, **no** a
> `build/<id>.container.js.bundle` ni a `build/ios/...` — ojo si mirás algún README
> viejo del template, esa ruta corta está desactualizada. La fuente de verdad es el
> propio `publish.yml`: zipea `build/generated/android` y `build/generated/ios`.
> Los sub-chunks se resuelven **relativos al directorio del container**, así que tienen
> que quedar co-ubicados con él — el build ya los deja así.

El build de iOS es **best-effort** en el pipeline real: si falla, no bloquea el publish
de Android. Localmente, corré el que necesites.

---

## 6. Publicar

En producción, esto lo dispara un `git push` a `main` — el CI hace build → compat gate
→ zip → publish, sin que vos toques nada. Acá lo vamos a correr **a mano**, paso por
paso, para que veas exactamente qué hace `scripts/publish.mjs` (es útil entenderlo,
porque los códigos de error que vas a ver en producción — `401`, `409`, `400` — salen
de este mismo camino).

### 6.1 Zipear el build

El zip tiene que tener el contenido **plano** de cada carpeta de build (el container en
la raíz del zip, no en una subcarpeta):

```bash
(cd build/generated/android && zip -r ../../../android.zip .)
(cd build/generated/ios && zip -r ../../../ios.zip .)
```

Esto te deja `android.zip` e `ios.zip` en la raíz del repo.

### 6.2 Publicar con `scripts/publish.mjs`

```bash
export BACKSTAGE_URL="https://<tu-backstage>"
export PUBLISH_TOKEN="<el PUBLISH_TOKEN de tu repo>"

node scripts/publish.mjs android.zip ios.zip
```

Qué hace ese script (`scripts/publish.mjs`, reusado por todas las miniapps):

1. Lee `id`/`version` de `manifest.json` (con `package.json.version` como fallback).
2. Consulta `GET /api/miniapps` para encontrar la `latestVersion` publicada de
   `hello_counter` (si es la primera vez, no hay ninguna).
3. Calcula la versión a publicar con **auto-bump**: si `manifest.version` ya es mayor
   a la última publicada, usa esa; si no, incrementa el **patch** de la última
   automáticamente. Vos no editás la versión a mano en cada release.
4. Sube **ambos** chunks (android primero, iOS después) a **la misma versión**, con
   `POST /api/miniapps/hello_counter/upload` (`Authorization: Bearer $PUBLISH_TOKEN`,
   multipart con `file`, `version`, `manifest`, `platform`).

> [!CAUTION]
> El registro es **inmutable**: publicar dos veces la misma `version` da **`409`**. No
> es un bug — es la garantía de que una versión publicada nunca cambia por debajo del
> host. Por eso el auto-bump existe: dejá que `publish.mjs` elija la versión, no la
> fijes vos salvo que quieras un bump de minor/major intencional en `manifest.json`.

> [!NOTE]
> `PUBLISH_TOKEN` es un secret de servicio (uno por instancia de Backstage, no por
> miniapp) que el scaffolder ya sembró en tu repo como GitHub Actions secret — **no se
> puede leer de vuelta** desde GitHub una vez guardado. Si vas a correr este comando en
> tu máquina (en vez de dejar que lo corra el CI), necesitás el valor real, que solo
> tiene quien opera la plataforma. Si no lo tenés, saltá directo a hacer `git push` — el
> CI hace exactamente estos mismos pasos con el secret ya cargado.

### 6.3 Verificar que quedó publicada

```bash
curl "https://<tu-backstage>/api/resolve?id=hello_counter"
curl "https://<tu-backstage>/api/resolve?id=hello_counter&platform=ios"
```

Cada uno te devuelve `{ id, version, url, manifest }` con la URL del chunk de esa
plataforma. El upload guarda los chunks con integridad **sha256** — el host la verifica
antes de ejecutar el código que descarga.

---

## 7. Verla en el host

El host resuelve **en runtime**, no en build-time — no hace falta recompilarlo ni
pasar por las tiendas para que vea tu versión nueva.

1. Abrí el host (dispositivo o emulador/simulador).
2. Buscá **Hello Counter** en el catálogo/Home — ya estaba listada desde que la
   scaffoldeaste; antes del primer publish mostraba "no disponible", ahora debería
   resolver bien.
3. Entrá. El componente `<MiniappHost/>` del lado host corre el ciclo completo:
   **resuelve** (`GET /api/resolve`) → **descarga** el chunk → **verifica** el sha256 →
   **monta** tu `Entry`. Vas a ver tu pantalla con el contador en 0.
4. Apretá **Sumar +1** un par de veces — es tu componente, corriendo dentro del host,
   compartiendo el mismo `ThemeProvider` (por eso el fondo/colores calzan con el resto
   de la app).

> [!TIP]
> Si ya habías abierto esta miniapp antes de publicar (por ejemplo, mientras
> desarrollabas con dev-mount) y no ves el cambio, **salí y volvé a entrar** a la
> miniapp, o recargá la app entera. El catálogo del Home cachea la lista con React
> Query y no la revalida por volver de background — un reload completo fuerza un
> `resolve` nuevo.

Si en vez de tu pantalla ves **"Miniapp no disponible"**, el motivo específico
(`resolve-failed`, `download-failed`, `integrity-failed`, `skew`, `host-too-old`, etc.)
y su fix están en el [Troubleshooting, §2](/docs/troubleshooting#2-la-miniapp-no-monta-en-el-host).

---

## 8. Qué sigue

Ya recorriste el ciclo completo: crear → codear → buildear → publicar → ver montado.
De acá para adelante:

- **[Integration Guide](/docs/integration-guide)** — el contrato completo que tenés
  que cumplir: singletons compartidos en rango, capabilities, nativos permitidos, y
  cómo versionar/hacer rollback.
- **[Host Contract](/docs/host-contract)** — qué declara el host hoy (versiones de
  `react`/`react-native`, libs compartidas, nativos) — la fuente de verdad contra la
  que se valida tu `manifest.shared`.
- **[Compat gate](/docs/compat-gate)** — los dos gates (CI y server-side) que frenan
  una miniapp incompatible, en modo WARN vs ENFORCE.
- **[Troubleshooting](/docs/troubleshooting)** — síntoma → causa → fix para publish,
  montaje en el host, compat gate y dev-loop.
- **[Desarrollo local](/docs/local-dev)** — el inner loop completo (dev-mount y
  remotes federados) si querés iterar más rápido que build+publish en cada cambio.
