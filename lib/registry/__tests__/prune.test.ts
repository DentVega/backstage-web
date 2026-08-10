import { describe, expect, it } from "vitest";
import {
  versionsToPrune,
  publishVersion,
  registerMiniapp,
  setMiniappPin,
} from "@/lib/registry/registry";
import { pruneMiniapp } from "@/lib/registry/prune";
import { mockStorage } from "@/lib/storage/mock";
import type { ChunkStorage } from "@/lib/storage/types";
import type { Registry } from "@/lib/registry/types";

const now = "2026-08-10T10:00:00.000Z";
const manifest = (id: string, version: string) => ({
  id,
  version,
  entry: "./Entry",
  shared: [],
  capabilities: [],
});

function regN(versions: string[]): Registry {
  let reg = registerMiniapp({}, { id: "acc", name: "Acc", owner: "o" }, now);
  for (const v of versions) {
    reg = publishVersion(reg, "acc", { version: v, url: `u/${v}`, manifest: manifest("acc", v) }, now);
  }
  return reg;
}

const V7 = ["0.1.0", "0.2.0", "0.3.0", "0.4.0", "0.5.0", "0.6.0", "0.7.0"];

describe("versionsToPrune", () => {
  it("7 versiones, keepN=5 → prunea las 2 más viejas", () => {
    expect(versionsToPrune(regN(V7).acc!, 5).sort()).toEqual(["0.1.0", "0.2.0"]);
  });
  it("≤ keepN → no prunea nada", () => {
    expect(versionsToPrune(regN(["0.1.0", "0.2.0"]).acc!, 5)).toEqual([]);
  });
  it("una versión pinneada vieja se MANTIENE aunque quede fuera de la ventana", () => {
    const reg = setMiniappPin(regN(V7), "acc", "0.1.0");
    const p = versionsToPrune(reg.acc!, 5);
    expect(p).not.toContain("0.1.0"); // la fijada se mantiene
    expect(p).toEqual(["0.2.0"]); // la otra vieja sí
  });
});

describe("pruneMiniapp", () => {
  it("borra los prefijos y saca las versiones del registry", async () => {
    const deletes: string[] = [];
    const { reg, pruned } = await pruneMiniapp(regN(V7), mockStorage(undefined, deletes), "acc", 5);
    expect(pruned.sort()).toEqual(["0.1.0", "0.2.0"]);
    expect(deletes.sort()).toEqual(["acc/0.1.0", "acc/0.2.0"]);
    expect(reg.acc!.versions.map((v) => v.version).sort()).toEqual([
      "0.3.0", "0.4.0", "0.5.0", "0.6.0", "0.7.0",
    ]);
  });
  it("nada que prunear → no-op (no borra, mismo reg)", async () => {
    const deletes: string[] = [];
    const start = regN(["0.1.0"]);
    const { reg, pruned } = await pruneMiniapp(start, mockStorage(undefined, deletes), "acc", 5);
    expect(pruned).toEqual([]);
    expect(deletes).toEqual([]);
    expect(reg).toBe(start);
  });
  it("error del storage → best-effort: igual saca del registry", async () => {
    const failing: ChunkStorage = {
      putMany: async () => ({ baseUrl: "" }),
      deletePrefix: async () => {
        throw new Error("boom");
      },
    };
    const { reg, pruned } = await pruneMiniapp(regN(V7), failing, "acc", 5);
    expect(pruned.sort()).toEqual(["0.1.0", "0.2.0"]);
    expect(reg.acc!.versions).toHaveLength(5);
  });
});
