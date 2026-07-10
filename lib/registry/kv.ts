/** KV-backed RegistryStore (ADR-014). Prod: Upstash Redis (Vercel KV). */
import { Redis } from "@upstash/redis";
import type { Registry } from "./types";
import type { RegistryStore } from "./store";

/** Minimal key-value abstraction so the store is testable with an in-memory impl. */
export interface KvClient {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
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

/** Upstash Redis client from env (injected by the Vercel integration). */
export function upstashClient(): KvClient {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    throw new Error("KV_REST_API_URL / KV_REST_API_TOKEN are not set");
  }
  const redis = new Redis({ url, token });
  return {
    async get(key: string): Promise<string | null> {
      // Upstash returns the parsed value; store as string for a stable contract.
      const v = await redis.get<string>(key);
      return v ?? null;
    },
    async set(key: string, value: string): Promise<void> {
      await redis.set(key, value);
    },
  };
}
