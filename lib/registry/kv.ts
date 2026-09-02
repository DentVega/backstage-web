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
  /** Compare-and-set: setea SOLO si GET(key)===expected (o expected===null y no existe). */
  casSet(key: string, expected: string | null, value: string): Promise<boolean>;
  /** Compare-and-del: borra SOLO si GET(key)===expected. expected===null es no-op ok. */
  casDel(key: string, expected: string | null): Promise<boolean>;
  sadd(key: string, member: string): Promise<void>;
  srem(key: string, member: string): Promise<void>;
  smembers(key: string): Promise<string[]>;
  mget(keys: string[]): Promise<(string | null)[]>;
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
  const sets = new Map<string, Set<string>>();
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
    async casSet(key, expected, value) {
      const cur = map.has(key) ? map.get(key)! : null;
      if (cur === expected) {
        map.set(key, value);
        return true;
      }
      return false;
    },
    async casDel(key, expected) {
      if (expected === null) return true;
      const cur = map.has(key) ? map.get(key)! : null;
      if (cur === expected) {
        map.delete(key);
        return true;
      }
      return false;
    },
    async sadd(key, member) {
      const s = sets.get(key) ?? new Set<string>();
      s.add(member);
      sets.set(key, s);
    },
    async srem(key, member) {
      sets.get(key)?.delete(member);
    },
    async smembers(key) {
      return [...(sets.get(key) ?? [])];
    },
    async mget(keys) {
      return keys.map((k) => map.get(k) ?? null);
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
  // CAS atómico vía Lua (Upstash REST no soporta WATCH). GET de key inexistente → false en Lua.
  const CAS_SET = `local cur = redis.call('GET', KEYS[1])
if ARGV[3] == '0' then
  if cur == false then redis.call('SET', KEYS[1], ARGV[2]); return 1 end
else
  if cur == ARGV[1] then redis.call('SET', KEYS[1], ARGV[2]); return 1 end
end
return 0`;
  const CAS_DEL = `local cur = redis.call('GET', KEYS[1])
if cur == ARGV[1] then redis.call('DEL', KEYS[1]); return 1 end
return 0`;
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
    async casSet(key, expected, value) {
      const r = await redis.eval(CAS_SET, [key], [expected ?? "", value, expected === null ? "0" : "1"]);
      return r === 1;
    },
    async casDel(key, expected) {
      if (expected === null) return true;
      const r = await redis.eval(CAS_DEL, [key], [expected]);
      return r === 1;
    },
    async sadd(key, member) {
      await redis.sadd(key, member);
    },
    async srem(key, member) {
      await redis.srem(key, member);
    },
    async smembers(key) {
      return (await redis.smembers<string[]>(key)) ?? [];
    },
    async mget(keys) {
      return keys.length ? await redis.mget<(string | null)[]>(...keys) : [];
    },
  };
}
