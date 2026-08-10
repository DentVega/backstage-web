import { describe, expect, it } from "vitest";
import { metricsStore } from "@/lib/metrics/store";
import { inMemoryKvClient } from "@/lib/registry/kv";

describe("metricsStore", () => {
  it("cuenta mounts por id", async () => {
    const s = metricsStore(inMemoryKvClient());
    await s.track({ type: "mount", id: "a", version: "1.0.0" });
    await s.track({ type: "mount", id: "a" });
    await s.track({ type: "mount", id: "b" });
    const snap = await s.snapshot(["a", "b"]);
    expect(snap.mounts).toEqual({ a: 2, b: 1 });
  });

  it("cuenta fallbacks por razón; ignora razones fuera de la whitelist", async () => {
    const s = metricsStore(inMemoryKvClient());
    await s.track({ type: "fallback", id: "a", reason: "skew" });
    await s.track({ type: "fallback", id: "a", reason: "skew" });
    await s.track({ type: "fallback", id: "a", reason: "inventada" }); // ignorada
    const snap = await s.snapshot([]);
    expect(snap.fallbacks.skew).toBe(2);
    expect((snap.fallbacks as Record<string, number>).inventada).toBeUndefined();
  });

  it("snapshot devuelve 0 para ids/razones sin eventos", async () => {
    const snap = await metricsStore(inMemoryKvClient()).snapshot(["x"]);
    expect(snap.mounts.x).toBe(0);
    expect(snap.fallbacks["host-too-old"]).toBe(0);
  });
});
