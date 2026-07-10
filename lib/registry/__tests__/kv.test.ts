import { describe, expect, it } from "vitest";
import { kvStore, type KvClient } from "@/lib/registry/kv";
import { seedRegistry } from "@/lib/registry/seed";
import type { Registry } from "@/lib/registry/types";

function inMemoryKv(): KvClient {
  const map = new Map<string, string>();
  return {
    async get(k) {
      return map.get(k) ?? null;
    },
    async set(k, v) {
      map.set(k, v);
    },
  };
}

describe("kvStore", () => {
  it("returns {} when empty", async () => {
    const store = kvStore(inMemoryKv());
    expect(await store.load()).toEqual({});
  });

  it("round-trips save → load", async () => {
    const store = kvStore(inMemoryKv());
    const reg = {
      acc: { id: "acc", name: "A", owner: "o", versions: [] },
    } as unknown as Registry;
    await store.save(reg);
    expect(await store.load()).toEqual(reg);
  });

  it("persists across store instances backed by the same client", async () => {
    const kv = inMemoryKv();
    const reg = { acc: { id: "acc", name: "A", owner: "o", versions: [] } } as unknown as Registry;
    await kvStore(kv).save(reg);
    expect(await kvStore(kv).load()).toEqual(reg);
  });
});

describe("seedRegistry", () => {
  it("seeds account_dashboard into an empty store", async () => {
    const store = kvStore(inMemoryKv());
    const reg = await seedRegistry(store);
    expect(reg.account_dashboard).toBeDefined();
    expect(await store.load()).toEqual(reg);
  });

  it("does not clobber an already-registered miniapp", async () => {
    const kv = inMemoryKv();
    const store = kvStore(kv);
    const existing = {
      account_dashboard: { id: "account_dashboard", name: "Mine", owner: "me", versions: [] },
    } as unknown as Registry;
    await store.save(existing);
    await seedRegistry(store);
    const loaded = await store.load();
    expect(loaded.account_dashboard.name).toBe("Mine");
  });
});
