# Playbook: montar una miniapp en el host (donde quieras)

> [!NOTE]
> Este doc es un **espejo** de `docs/mounting-miniapps.md` del repo [`backstagereactnative`](https://github.com/DentVega/backstagereactnative/blob/main/docs/mounting-miniapps.md). Editalo allá; acá es una copia para el sitio.

> Guía práctica para publicar una miniapp y montarla en **cualquier lugar** del
> host RN — un tab, una sección de una pantalla, un modal, inline — no solo en una
> card. Refleja el estado real tras hacer el loader genérico (`chunkLoader.ts` usa
> `loadRemote(<id>/Entry)`, así que **no hay que tocar `rspack.config` por cada
> miniapp**).

## TL;DR — montar una miniapp en 1 componente

Una vez la miniapp está **registrada en Backstage** y su **chunk servido en una
URL alcanzable**, la montás así en cualquier punto del árbol:

```tsx
import React, {useMemo} from 'react';
import {View} from 'react-native';
import type {MiniappId} from '@org/miniapp-contract';
import {MiniappHost, createScopedGrant, httpResolveClient} from '@org/host-runtime';
import {repackChunkLoader} from '../chunkLoader';
import {HOST_PROVIDED, BACKSTAGE_BASE_URL} from '../hostProvided';
import {useSession, deriveCapabilities} from '../session/store';

const resolveClient = httpResolveClient(BACKSTAGE_BASE_URL);

export function MiniappSlot({id}: {id: MiniappId}) {
  const isAuth = useSession(s => s.isAuthenticated);
  // Inyectá SOLO las capabilities que la miniapp necesita (scoped, revocables).
  const grant = useMemo(
    () => createScopedGrant(deriveCapabilities(isAuth)).grant,
    [isAuth],
  );
  return (
    <View style={{height: 480}}>  {/* dale un tamaño acotado (flex o height) */}
      <MiniappHost
        id={id}
        resolveClient={resolveClient}
        chunkLoader={repackChunkLoader}
        hostProvided={HOST_PROVIDED}
        capabilities={grant}
      />
    </View>
  );
}
```

`MiniappHost` hace todo el ciclo: `resolve → verify → download → mount → fallback`.
Ponelo en un `Tab.Screen`, dentro de una `ScrollView`, en un modal, donde sea.
Solo necesita un contenedor con altura (flex o `height`).

> El paso `verify` cubre la **integridad** sha256 del chunk y, además, la **firma**
> (autenticidad, contra un trust bundle firmado por el root). La firma corre en modo **warn**
> (monta igual + métrica) y está **off** hasta pinear una `ROOT_PUBLIC_KEY`; pasar a **enforce**
> (rechaza sin firma válida) es un paso operacional.

---

## Los 3 pasos completos

### 1. Preparar la miniapp (el remote)

- Repo Re.Pack que **expone `./Entry`** con la firma `MiniappEntryProps` del
  contrato (`@org/miniapp-contract`): recibe `{ capabilities }`.
- En su `rspack.config.mjs`, la lista `shared` **debe coincidir con la del host**
  (mismos singletons), o la miniapp usará copias propias y romperá theme/estado/caché:
  ```js
  shared: {
    react:                   { singleton: true, eager: false, requiredVersion: '18.3.1' },
    'react-native':          { singleton: true, eager: false, requiredVersion: '0.76.6' },
    '@tanstack/react-query': { singleton: true, requiredVersion: '^5.0.0' },
    '@shopify/flash-list':   { singleton: true, requiredVersion: '^1.7.0' },
    '@org/ui-kit':           { singleton: true, eager: false, requiredVersion: '^0.1.0' },
    // + zustand / navigation si la miniapp los usa
  }
  ```
  > Regla: framework libs **y libs con estado/contexto** (ui-kit=ThemeProvider,
  > react-query, stores, i18n) van `singleton: true`. Es la causa del clásico
  > `useTheme must be used within a <ThemeProvider>`.
- **Build estático** del container (NO el dev server webpack-start, que exige
  `?platform` y rompe la carga como remote):
  ```bash
  pnpm bundle:android   # → build/generated/android/<id>.container.js.bundle + chunks
  pnpm bundle:ios       # idem para iOS
  ```
  Los sub-chunks quedan **co-ubicados** junto al container (mismo directorio).

### 2. Publicar / registrar en Backstage

El host pregunta `GET /api/resolve?id=<id>&platform=<android|ios>` y espera
`{ url, manifest }` (el resolve responde con el chunk de la plataforma pedida:
`platform=ios` → `iosUrl`, la integrity del manifest corresponde al chunk de esa
plataforma; sin `platform` → chunk android). Hay que dejar la miniapp en el
registry con una versión que tenga **ambos** `url` (android) e `iosUrl` (ios)
apuntando a sus chunks:

- **Dev rápido:** agregar la entrada en `backstage-web/data/registry.json` (o
  `POST /api/miniapps/:id/publish`) con el `url` del chunk (y `iosUrl` si aplica).
- **Prod / CI:** `POST /api/miniapps/:id/upload` (Bearer `PUBLISH_TOKEN`), una vez
  por plataforma (`platform=android`, `platform=ios`) con el zip del build de esa
  plataforma → se guarda en Blob bajo `${id}/${version}/ios/` (o `/android/`) →
  resolve devuelve la URL de Blob correspondiente.

**Servir el chunk en una URL alcanzable por el device:**
- **Dev — Android:** static server del directorio del build + `adb reverse tcp:<port> tcp:<port>`,
  URL **limpia** (sin `?platform`). Ej.:
  ```bash
  python3 -m http.server 9000 --directory build/generated/android
  adb reverse tcp:9000 tcp:9000
  # registry url = http://localhost:9000/<id>.container.js.bundle
  ```
- **Dev — iOS:** mismo esquema, pero serví el directorio generado por `bundle:ios`
  (`build/generated/ios/`, con el container + vendor chunks co-ubicados). El
  Simulador llega directo a `localhost`; un iPhone real necesita la IP de la Mac
  en la LAN (no hay `adb reverse` en iOS):
  ```bash
  python3 -m http.server 9001 --directory build/generated/ios
  # registry iosUrl = http://localhost:9001/<id>.container.js.bundle          (Simulador)
  # registry iosUrl = http://<IP-de-la-Mac>:9001/<id>.container.js.bundle     (iPhone real)
  ```
- **Prod:** URL pública de Blob/CDN, una por plataforma.
- ⚠️ Los sub-chunks se resuelven **relativos al directorio del container**, así que
  deben estar co-ubicados con él (el build ya los deja así, por plataforma).

### 3. Montar en el host

- Renderizá `<MiniappHost id=... />` (ver TL;DR) **donde quieras**.
- **No hace falta** tocar `apps/host/rspack.config.mjs` por cada miniapp: el
  `repackChunkLoader` es genérico (usa `resolved.id` + `loadRemote`).
- **Capabilities:** pasá el grant con los permisos que la miniapp requiere. La
  miniapp hace gating por su capability (sin el permiso → muestra su pantalla de
  acceso denegado). El host nunca expone credenciales, solo el grant scoped.

---

## Checklist de troubleshooting (visto en la práctica)

| Síntoma | Causa / fix |
|---|---|
| `useTheme must be used within a <ThemeProvider>` | `@org/ui-kit` no está en `shared` singleton (host **y** miniapp). |
| `remoteEntryExports is undefined` / 404 al `.container.js.bundle` | El chunk no está servido en la URL del registry, o no es build estático. |
| URL con `.javascript` al final → 404 | Usar `Script.getRemoteURL(url, {excludeExtension:true})` (ya está en el loader). |
| `URLSearchParams.set is not implemented` | Hermes no lo implementa; el `ResolveClient` ya arma el query a mano. |
| "Acceso no autorizado" en la miniapp | Falta la capability requerida — inyectá el grant correcto (ej. login → `accounts:read`). |
| Sub-chunks van a `:8081` (dev server del host) y 404 | El loader los rutea a la base del remote por `caller` (ya resuelto). |

## Referencias
- Loader: `apps/host/src/chunkLoader.ts` (resolver + `registerRemotes` + `loadRemote`).
- Componente de montaje: `@org/host-runtime` → `MiniappHost`, `httpResolveClient`, `createScopedGrant`.
- Contrato: `@org/miniapp-contract` (`MiniappEntryProps`, `Manifest`, `ResolveResponse`).
- Capabilities de sesión: `apps/host/src/session/store.ts` (`deriveCapabilities`).
