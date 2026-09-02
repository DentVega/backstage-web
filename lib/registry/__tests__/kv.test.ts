import { describe, expect, it } from "vitest";
import { kvStore, inMemoryKvClient } from "@/lib/registry/kv";
import { seedRegistry } from "@/lib/registry/seed";
import type { Registry } from "@/lib/registry/types";

const inMemoryKv = inMemoryKvClient;

describe("kvStore", () => {
  it("returns {} when empty", async () => {
    const store = kvStore(inMemoryKv());
    expect(await store.load()).toEqual({});
  });

  it("round-trips mutateApp → getAll", async () => {
    const store = kvStore(inMemoryKv());
    const rec = { id: "acc", name: "A", owner: "o", versions: [] };
    await store.mutateApp("acc", () => rec as never);
    expect(await store.getAll()).toEqual({ acc: rec } as unknown as Registry);
  });

  it("persists across store instances backed by the same client", async () => {
    const kv = inMemoryKv();
    const rec = { id: "acc", name: "A", owner: "o", versions: [] };
    await kvStore(kv).mutateApp("acc", () => rec as never);
    expect(await kvStore(kv).getApp("acc")).toEqual(rec);
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
    await store.mutateApp(
      "account_dashboard",
      () => ({ id: "account_dashboard", name: "Mine", owner: "me", versions: [] } as never),
    );
    await seedRegistry(store);
    const loaded = await store.load();
    expect(loaded.account_dashboard.name).toBe("Mine");
  });
});

describe("KvClient — casSet / casDel", () => {
  it("casSet setea cuando expected coincide", async () => {
    const kv = inMemoryKvClient();
    await kv.set("k", "v1");
    expect(await kv.casSet("k", "v1", "v2")).toBe(true);
    expect(await kv.get("k")).toBe("v2");
  });
  it("casSet rechaza cuando el valor cambió", async () => {
    const kv = inMemoryKvClient();
    await kv.set("k", "v1");
    expect(await kv.casSet("k", "OTRO", "v2")).toBe(false);
    expect(await kv.get("k")).toBe("v1");
  });
  it("casSet con expected=null crea si no existe / rechaza si existe", async () => {
    const kv = inMemoryKvClient();
    expect(await kv.casSet("k", null, "v1")).toBe(true);
    expect(await kv.casSet("k", null, "v2")).toBe(false);
    expect(await kv.get("k")).toBe("v1");
  });
  it("casDel borra si coincide", async () => {
    const kv = inMemoryKvClient();
    await kv.set("k", "v1");
    expect(await kv.casDel("k", "v1")).toBe(true);
    expect(await kv.get("k")).toBeNull();
  });
});

describe("KvClient — sets + mget", () => {
  it("sadd/srem/smembers", async () => {
    const kv = inMemoryKvClient();
    await kv.sadd("s", "a");
    await kv.sadd("s", "b");
    await kv.sadd("s", "a");
    expect((await kv.smembers("s")).sort()).toEqual(["a", "b"]);
    await kv.srem("s", "a");
    expect(await kv.smembers("s")).toEqual(["b"]);
  });
  it("mget devuelve valores/nulls en orden", async () => {
    const kv = inMemoryKvClient();
    await kv.set("a", "1");
    await kv.set("c", "3");
    expect(await kv.mget(["a", "b", "c"])).toEqual(["1", null, "3"]);
  });
});
