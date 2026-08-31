/** Contadores de métricas sobre KV (atómicos vía incr). Espeja el patrón de host-contract. */
import type { KvClient } from "@/lib/registry/kv";
import { upstashClient, inMemoryKvClient } from "@/lib/registry/kv";
import type { MetricEvent, MetricsSnapshot } from "./types";

/** Razones de fallback válidas (whitelist — evita contar basura arbitraria). */
export const FALLBACK_REASONS = [
  "resolve-failed",
  "download-failed",
  "invalid-manifest",
  "skew",
  "integrity-failed",
  "host-too-old",
  "invalid-signature",
  "unknown-key",
] as const;

export interface MetricsStore {
  /** Cuenta un evento (best-effort; ignora razones fuera de la whitelist). */
  track(ev: MetricEvent): Promise<void>;
  /** Agrega los contadores de los ids dados + todas las razones. */
  snapshot(ids: readonly string[]): Promise<MetricsSnapshot>;
}

export function metricsStore(kv: KvClient): MetricsStore {
  return {
    async track(ev: MetricEvent): Promise<void> {
      if (ev.type === "mount") {
        await kv.incr(`metrics:mount:${ev.id}`);
      } else if ((FALLBACK_REASONS as readonly string[]).includes(ev.reason)) {
        await kv.incr(`metrics:fallback:${ev.reason}`);
      }
    },
    async snapshot(ids: readonly string[]): Promise<MetricsSnapshot> {
      const mounts: Record<string, number> = {};
      for (const id of ids) {
        mounts[id] = Number((await kv.get(`metrics:mount:${id}`)) ?? 0);
      }
      const fallbacks: Record<string, number> = {};
      for (const r of FALLBACK_REASONS) {
        fallbacks[r] = Number((await kv.get(`metrics:fallback:${r}`)) ?? 0);
      }
      return { mounts, fallbacks };
    },
  };
}

/** Env-selected: Upstash KV en prod, in-memory (singleton) en dev (espeja getHostContractStore). */
let devKv: KvClient | null = null;
export function getMetricsStore(): MetricsStore {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return metricsStore(upstashClient());
  }
  devKv ??= inMemoryKvClient(); // singleton → acumula durante la sesión del dev server
  return metricsStore(devKv);
}
