import { describe, it, expect } from "vitest";
import { inMemoryKvClient } from "../../registry/kv";
import { auditStore } from "../log";
import { verifyChain } from "../chain";

describe("auditStore", () => {
  it("records a chain of events with linked hashes, verifiable", async () => {
    const s = auditStore(inMemoryKvClient());
    await s.record({ actor: { type: "user", login: "brian" }, action: "publish", chain: "hellow", miniappId: "hellow", details: { version: "0.1.1" } });
    await s.record({ actor: { type: "ci", login: "bot" }, action: "publish", chain: "hellow", miniappId: "hellow", details: { version: "0.1.2" } });
    const chain = await s.readChain("hellow");
    expect(chain.map((e) => e.seq)).toEqual([2, 1]); // newest-first
    expect(chain[1].prevHash).toBe(""); // el primero
    expect(chain[0].prevHash).toBe(chain[1].hash); // encadenado
    // verifyChain espera oldest-first
    expect(verifyChain([...chain].reverse())).toEqual({ ok: true });
  });

  it("readAll merges chains newest-first and filters", async () => {
    const s = auditStore(inMemoryKvClient());
    await s.record({ actor: { type: "user", login: "a" }, action: "pin", chain: "x", miniappId: "x", details: {} });
    await s.record({ actor: { type: "user", login: "b" }, action: "publish", chain: "y", miniappId: "y", details: {} });
    const all = await s.readAll();
    expect(all.length).toBe(2);
    expect(all[0].ts).toBeGreaterThanOrEqual(all[1].ts); // newest-first
    expect((await s.readAll({ miniapp: "x" })).every((e) => e.miniappId === "x")).toBe(true);
    expect((await s.readAll({ actor: "b" })).every((e) => e.actor.login === "b")).toBe(true);
    expect((await s.readAll({ action: "pin" })).every((e) => e.action === "pin")).toBe(true);
  });

  it("verify reports ok across chains", async () => {
    const s = auditStore(inMemoryKvClient());
    await s.record({ actor: { type: "user", login: "a" }, action: "seed", chain: "_global", details: { count: 3 } });
    const v = await s.verify();
    expect(v.ok).toBe(true);
    expect(v.chains.find((c) => c.chain === "_global")?.ok).toBe(true);
  });
});
