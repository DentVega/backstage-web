import { describe, expect, it } from "vitest";
import { kvStoragePreferenceStore } from "@/lib/storage/preference";
import type { KvClient } from "@/lib/registry/kv";

function memClient(): KvClient & { data: Map<string, string> } {
  const data = new Map<string, string>();
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
