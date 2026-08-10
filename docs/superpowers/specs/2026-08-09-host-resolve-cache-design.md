# Cache host-side de resolve (por-versión) — Design

**Fecha:** 2026-08-09
**Estado:** Aprobado (listo para plan)
**Repo:** `backstagereactnative` (host) — `backstage-web` NO cambia.
**Owner:** DentVega
**Roadmap:** cache host-side (flagged en #9). Enabler de #12 (métricas).

---

## Goal

Bajar las lecturas a Backstage/KV: hoy el host hace `GET /api/resolve` **en cada mount**. Con un cache **por-versión in-memory**, un mismo `(id, versión)` se resuelve **una sola vez por sesión**, sin quedar stale y **sin frenar el rollback** (la invalidación viaja por el `servedVersion` del catálogo).

## Background

- `useMiniapp` (host-runtime) llama `resolveClient.resolve({id})` en cada mount → `httpResolveClient` hace un `fetch` pelado (sin cache) → una lectura de KV.
- `/api/resolve` ya acepta `?version=` (devuelve esa versión exacta). El **chunk de una versión es inmutable** (la URL incluye la versión) → un resolve `(id, versión)` **nunca cambia** → cacheable para siempre (en memoria).
- El **catálogo (`/api/miniapps`) ya devuelve `servedVersion`** (= `pinnedVersion ?? latest`) y el host lo fetchea en `HomeScreen`. Ese es el **origen de verdad de qué versión montar** y la **señal de invalidación**: cuando cambia (pin/rollback/publish), cambia la llave del cache → re-resuelve.

## Approach

El host **resuelve la versión explícita** que le da el catálogo (`servedVersion`), en vez de dejar que el server elija. Como es determinístico e inmutable, se cachea por `(id, versión)`. Plumbing: `servedVersion` viaja `HomeScreen → nav → MiniappScreen → MiniappHost → useMiniapp → resolve({id, version})`. El cache es un wrapper `cachingResolveClient` (singleton de módulo, in-memory).

Por qué explícito y no "resolve by id + comparar": resolver la versión explícita hace el cache un `Map` puro `(id,versión)→respuesta` (inmutable, cero staleness) y la lógica de pin queda **una sola vez** en el catálogo. Resultado idéntico a resolve-by-id (porque `servedVersion == pinnedVersion ?? latest`), pero determinístico y cacheable.

## Diseño detallado

### 1. `packages/miniapp-contract/src/types.ts`
`ResolveRequest` += campo opcional (backward-compat; backstage-web ya lee `?version` del querystring, no del type):
```ts
readonly version?: SemVer;
```

### 2. `packages/host-runtime/src/ResolveClient.ts`
`httpResolveClient`: si `request.version`, sumar `&version=` a la query (igual que ya hace con `hostVersion`).

### 3. `packages/host-runtime/src/cachingResolveClient.ts` (nuevo)
```ts
/**
 * Envuelve un ResolveClient con un cache in-memory por (id, versión). Un resolve
 * de una versión concreta es inmutable → se cachea para siempre (por sesión).
 * Solo cachea cuando el request trae `version` (determinístico); sin versión pasa
 * derecho (el server elige, no se cachea). Los fallos NO se cachean.
 * (Este es el punto de hook natural para métricas: hits vs misses = resolves reales.)
 */
export function cachingResolveClient(inner: ResolveClient): ResolveClient {
  const cache = new Map<string, ResolveResponse>();
  return {
    async resolve(request) {
      const key = request.version ? `${request.id}@${request.version}` : null;
      if (key && cache.has(key)) return cache.get(key)!;      // hit
      const res = await inner.resolve(request);
      cache.set(`${request.id}@${res.version}`, res);          // cachea por la versión resuelta
      return res;
    },
  };
}
```

### 4. `packages/host-runtime/src/useMiniapp.ts`
- `deps` += `resolveVersion?: string`.
- Llamar `resolveClient.resolve({ id, version: deps.resolveVersion })`.
- Agregar `deps.resolveVersion` al array de dependencias del efecto (re-resuelve si cambia la versión servida).

### 5. `packages/host-runtime/src/MiniappHost.tsx`
- Prop += `resolveVersion?: string`; pasarla a `useMiniapp`.

### 6. `apps/host` (plumbing)
- `navigation.ts`: `Miniapp: {id; title; servedVersion?: string}`.
- `HomeScreen.tsx`: `navigation.navigate('Miniapp', { id, title, servedVersion: served })` (ya computa `served`).
- `MiniappScreen.tsx`:
  - Envolver el client: `const resolveClient = cachingResolveClient(__DEV__ ? devResolveClient(...) : httpResolveClient(...))` (singleton de módulo → el cache persiste entre mounts de la sesión).
  - Pasar `resolveVersion={route.params.servedVersion}` a `<MiniappHost>`.

## Verificación

Unit (jest / RN Testing Library, corre en el `tests.yml` del host):
- **`cachingResolveClient`:** hit con misma `(id,versión)` (no re-llama al inner); miss con versión distinta → re-llama; sin `version` pasa derecho (no cachea); un fallo del inner no se cachea (el próximo reintenta).
- **`httpResolveClient`:** arma `&version=` cuando se pasa.
- **`useMiniapp`:** pasa `resolveVersion` al resolve y re-resuelve cuando cambia.
- **wiring:** `HomeScreen` navega con `servedVersion`; `MiniappScreen` lo pasa.

Razonamiento e2e: montar la misma miniapp 2× en una sesión → **1 solo** `GET /api/resolve`. Cambiar el pin → el catálogo trae otro `servedVersion` → próximo mount = otra llave → re-resuelve (rollback llega con el refetch del catálogo).

## Qué NO cambia

- `backstage-web` — `/api/resolve` ya soporta `?version`. Cero cambios.
- La semántica de pin/rollback (#10) — el cache la respeta vía la llave por versión.
- Persistencia: **in-memory por sesión** (se pierde al cerrar la app; simple, sin storage, sin staleness entre sesiones).

## Fuera de alcance

- Cache **persistente** (AsyncStorage/MMKV) — YAGNI para el MVP.
- **Métricas** (#12) — este cache es el *hook* (hits/misses); las métricas son un feature aparte.
- TTL / stale-while-revalidate — innecesario: la llave por versión es inmutable y el catálogo invalida.
- Cachear el catálogo/manifests — ya lo maneja React Query en `HomeScreen`.

## Archivos afectados (todo en `backstagereactnative`, entra por PR)

- `packages/miniapp-contract/src/types.ts` (+`version?` en ResolveRequest)
- `packages/host-runtime/src/ResolveClient.ts` (query `&version=`)
- `packages/host-runtime/src/cachingResolveClient.ts` (**nuevo**) + test
- `packages/host-runtime/src/useMiniapp.ts` (+`resolveVersion`)
- `packages/host-runtime/src/MiniappHost.tsx` (+prop)
- `apps/host/src/{navigation.ts, screens/HomeScreen.tsx, screens/MiniappScreen.tsx}` + tests
