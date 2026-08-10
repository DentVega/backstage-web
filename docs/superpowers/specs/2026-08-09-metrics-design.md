# Métricas — telemetría de mounts/fallbacks (#12) — Design

**Fecha:** 2026-08-09
**Estado:** Aprobado (listo para plan)
**Repos:** `backstage-web` (ingest + KV + dashboard) + `backstagereactnative` (host reporta)
**Owner:** DentVega
**Roadmap:** #12. Habilitado por el cache host-side (el server ya no ve los mounts cacheados → la verdad de "qué se monta" está en el host).

---

## Goal

Saber **qué miniapps/versiones se montan** y **qué falla** en runtime. El host reporta eventos (mount / fallback) a Backstage; Backstage los agrega en contadores KV; un dashboard `/metrics` los muestra.

## Background

- El **host** dispatchea `mounted` (con `resolved.id/version`) y `fail` (con `FallbackReason`) en `useMiniapp` → puntos exactos de emisión.
- El **cache** (recién hecho) intercepta resolves → contar en el server subcontaría los mounts. Por eso la telemetría sale del host.
- **KvClient** hoy solo `get`/`set` → hay que sumar **`incr`** (atómico; Upstash Redis `INCR`).
- `FallbackReason` = enum fijo: `resolve-failed`, `download-failed`, `invalid-manifest`, `skew`, `integrity-failed`, `host-too-old`.

## Approach

Host: un `MetricsClient` (fire-and-forget, nunca tira) cableado en `useMiniapp`. Backend: `POST /api/metrics` (ingest → `incr` de contadores, público best-effort + validación liviana) + `GET /api/metrics` (agrega) + página `/metrics`. **Métricas NUNCA rompen la app ni el publish** (best-effort en ambos lados).

## Diseño detallado

### Backend — `backstage-web`

**`lib/registry/kv.ts`** — `KvClient` += `incr(key: string): Promise<number>`. `upstashClient` → `redis.incr(key)`. (El client in-memory de tests: un `Map<string,number>`.)

**`lib/metrics/types.ts` (nuevo)**
```ts
export type MetricEvent =
  | { readonly type: "mount"; readonly id: string; readonly version?: string }
  | { readonly type: "fallback"; readonly id: string; readonly reason: string };
export interface MetricsSnapshot {
  readonly mounts: Readonly<Record<string, number>>;    // id → total
  readonly fallbacks: Readonly<Record<string, number>>; // reason → total
}
```

**`lib/metrics/store.ts` (nuevo)** — contadores atómicos:
```ts
const FALLBACK_REASONS = ["resolve-failed","download-failed","invalid-manifest","skew","integrity-failed","host-too-old"] as const;

export function metricsStore(kv: KvClient) {
  return {
    async track(ev: MetricEvent): Promise<void> {
      if (ev.type === "mount") await kv.incr(`metrics:mount:${ev.id}`);
      else if (FALLBACK_REASONS.includes(ev.reason as never)) await kv.incr(`metrics:fallback:${ev.reason}`);
    },
    async snapshot(ids: readonly string[]): Promise<MetricsSnapshot> {
      const mounts: Record<string, number> = {};
      for (const id of ids) mounts[id] = Number((await kv.get(`metrics:mount:${id}`)) ?? 0);
      const fallbacks: Record<string, number> = {};
      for (const r of FALLBACK_REASONS) fallbacks[r] = Number((await kv.get(`metrics:fallback:${r}`)) ?? 0);
      return { mounts, fallbacks };
    },
  };
}
```
Env-selected (kv en prod, in-memory en dev/tests) — espeja `getHostContractStore`.

**`app/api/metrics/route.ts` (nuevo)**
- **`POST`** — ingest público best-effort. Body `{ events: MetricEvent[] }`. Validación liviana: tipo conocido; `id` **existe en el registry** (evita poisoning de ids arbitrarios); batch acotado (ej. ≤ 50). Best-effort: si algo falla, loguea y devuelve 200 igual (nunca rompe el reporte del host). No auth (el host móvil no está autenticado).
- **`GET`** — devuelve `metricsStore.snapshot(ids del registry)`. Público (dashboard interno).

**`app/metrics/page.tsx` (nuevo)** — dashboard: **mounts por miniapp** (lista/barras, ordenado desc) + **fallbacks por razón**. Server component (fetch del snapshot). Fuera del path caliente del catálogo → no suma reads ahí.

### Host — `backstagereactnative`

**`packages/host-runtime/src/MetricsClient.ts` (nuevo)**
```ts
export interface MetricsClient { track(event: MetricEvent): void; }
/** POST fire-and-forget; nunca tira (las métricas no rompen la app). */
export function httpMetricsClient(baseUrl: string): MetricsClient {
  return { track(event) {
    void fetch(`${baseUrl.replace(/\/+$/,"")}/api/metrics`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [event] }),
    }).catch(() => {}); // best-effort
  }};
}
export const noopMetricsClient: MetricsClient = { track() {} };
```
(MVP: 1 POST por evento, fire-and-forget. Batching = optimización futura.)

**`useMiniapp.ts`** — dep `metrics?: MetricsClient`. Tras `dispatch({type:"mounted"})` → `deps.metrics?.track({type:"mount", id, version: resolved.version})`. En el `fail` → `deps.metrics?.track({type:"fallback", id, reason: f.reason})`.

**`MiniappHost.tsx`** — prop `metrics?: MetricsClient` → pasarla a `useMiniapp`.

**`MiniappScreen.tsx`** — `const metricsClient = httpMetricsClient(BACKSTAGE_BASE_URL)` (singleton módulo); pasar `metrics={metricsClient}` a `<MiniappHost>`.

## Verificación

- **Backend (vitest):** `metricsStore` (incr por mount/fallback; snapshot agrega; razón inválida se ignora); `POST /api/metrics` (incr los contadores; id fuera del registry se ignora; batch > límite se recorta/rechaza; siempre 200); `GET` devuelve el snapshot; `KvClient.incr` (in-memory).
- **Host (jest):** `httpMetricsClient` postea y **no tira** si el fetch falla; `useMiniapp` llama `metrics.track` en mount y en fail (con la razón correcta); sin `metrics` es no-op.
- **e2e:** montar hellow_widget en el emulador → `GET /api/metrics` muestra `mounts.hellow_widget >= 1`.

## Qué NO cambia

- El resolve/cache/pin — el `track` es fire-and-forget al costado.
- El publish — no se toca (los publishes se pueden sumar como métrica en un follow-up).

## Fuera de alcance (follow-ups)

- **Per-versión** y **per-miniapp-per-razón** (drill-down) — el MVP cuenta `mount:{id}` + `fallback:{reason}`.
- **Series temporales** (necesita un store analítico; KV solo da totales).
- **Auth/token** en el ingest — hoy público best-effort + validación por-registry.
- **Batching** en el host.
- Métricas de **cache hit/miss** (el `cachingResolveClient` es el hook natural, se suma después).
- Publishes / gates bloqueados como métrica.

## Archivos afectados

- **backstage-web:** `lib/registry/kv.ts` (+incr), `lib/metrics/{types,store}.ts` (nuevos), `app/api/metrics/route.ts` (nuevo), `app/metrics/page.tsx` (nuevo) + tests.
- **backstagereactnative:** `packages/host-runtime/src/MetricsClient.ts` (nuevo) + `useMiniapp.ts` + `MiniappHost.tsx` + `apps/host/src/screens/MiniappScreen.tsx` + tests. (Entra por PR — main protegido.)
