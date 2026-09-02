import { describe, expect, it } from "vitest";
import { kvStoragePreferenceStore } from "@/lib/storage/preference";
import type { KvClient } from "@/lib/registry/kv";

function memClient(): KvClient & { data: Map<string, string> } {
  const data = new Map<string, string>();
  const sets = new Map<string, Set<string>>();
  return {
    data,
    async get(k) {
      return data.get(k) ?? null;
    },
    async set(k, v) {
      data.set(k, v);
    },
    async incr(k) {
      const n = Number(data.get(k) ?? 0) + 1;
      data.set(k, String(n));
      return n;
    },
    async casSet(k, expected, v) {
      const cur = data.has(k) ? data.get(k)! : null;
      if (cur === expected) {
        data.set(k, v);
        return true;
      }
      return false;
    },
    async casDel(k, expected) {
      if (expected === null) return true;
      const cur = data.has(k) ? data.get(k)! : null;
      if (cur === expected) {
        data.delete(k);
        return true;
      }
      return false;
    },
    async sadd(k, m) {
      (sets.get(k) ?? sets.set(k, new Set()).get(k)!).add(m);
    },
    async srem(k, m) {
      sets.get(k)?.delete(m);
    },
    async smembers(k) {
      return [...(sets.get(k) ?? [])];
    },
    async mget(keys) {
      return keys.map((k) => data.get(k) ?? null);
    },
  };
}

describe("kvStoragePreferenceStore", () => {
  it("save + load round-trip (string cruda bajo 'storage-provider')", async () => {
    const c = memClient();
    const store = kvStoragePreferenceStore(c);
    await store.save("r2");
    expect(c.data.get("storage-provider")).toBe("r2"); // raw, no JSON wrap
    expect(await store.load()).toBe("r2");
  });
  it("load sin valor → null", async () => {
    expect(await kvStoragePreferenceStore(memClient()).load()).toBeNull();
  });
  it("load de un valor inválido → null (defensivo)", async () => {
    const c = memClient();
    await c.set("storage-provider", "s3");
    expect(await kvStoragePreferenceStore(c).load()).toBeNull();
  });
});
