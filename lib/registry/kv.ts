/** KV-backed RegistryStore (ADR-014). Prod: Upstash Redis (Vercel KV). */
import { Redis } from "@upstash/redis";
import type { Registry } from "./types";
import type { RegistryStore } from "./store";

/** Minimal key-value abstraction so the store is testable with an in-memory impl. */
export interface KvClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  /** Incremento atómico (para contadores de métricas). Devuelve el valor nuevo. */
  incr(key: string): Promise<number>;
}

const REGISTRY_KEY = "registry";

/** Whole-registry-under-one-key store (ADR-014). */
export function kvStore(client: KvClient): RegistryStore {
  return {
    async load(): Promise<Registry> {
      const raw = await client.get(REGISTRY_KEY);
      return raw ? (JSON.parse(raw) as Registry) : {};
    },
    async save(reg: Registry): Promise<void> {
      await client.set(REGISTRY_KEY, JSON.stringify(reg));
    },
  };
}

/** KvClient en memoria (fallback dev / tests). No persiste. */
export function inMemoryKvClient(): KvClient {
  const map = new Map<string, string>();
  return {
    async get(key) {
      return map.get(key) ?? null;
    },
    async set(key, value) {
      map.set(key, value);
    },
    async incr(key) {
      const next = Number(map.get(key) ?? 0) + 1;
      map.set(key, String(next));
      return next;
    },
  };
}

/** Upstash Redis client from env (injected by the Vercel integration). */
export function upstashClient(): KvClient {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("KV_REST_API_URL / KV_REST_API_TOKEN are not set");
  }
  // `automaticDeserialization: false` — @upstash/redis otherwise JSON.parses the
  // stored value on `get`, returning an object; `kvStore` then double-parses and
  // throws (`"[object Object]" is not valid JSON`). Keep raw strings so the
  // JSON.stringify/parse in `kvStore` is the single encoding layer. (This only
  // reproduces against real Upstash — the in-memory test client doesn't parse.)
  const redis = new Redis({ url, token, automaticDeserialization: false });
  return {
    async get(key: string): Promise<string | null> {
      const v = await redis.get<string>(key);
      return v ?? null;
    },
    async set(key: string, value: string): Promise<void> {
      await redis.set(key, value);
    },
    async incr(key: string): Promise<number> {
      return redis.incr(key);
    },
  };
}
