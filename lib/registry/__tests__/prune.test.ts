import { describe, expect, it } from "vitest";
import {
  versionsToPrune,
  removeVersion,
  publishVersion,
  registerMiniapp,
  setMiniappPin,
} from "@/lib/registry/registry";
import { InvalidManifestError, MiniappNotFoundError } from "@/lib/registry/types";
import { pruneChunks, removePrunedVersions } from "@/lib/registry/prune";
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

describe("pruneChunks", () => {
  it("borra un prefijo por versión a prunear", async () => {
    const deletes: string[] = [];
    await pruneChunks(mockStorage(undefined, deletes), "acc", ["0.1.0", "0.2.0"] as never);
    expect(deletes.sort()).toEqual(["acc/0.1.0", "acc/0.2.0"]);
  });
  it("error del storage → best-effort (no tira)", async () => {
    const failing: ChunkStorage = {
      putMany: async () => ({ baseUrl: "" }),
      deletePrefix: async () => {
        throw new Error("boom");
      },
    };
    await expect(pruneChunks(failing, "acc", ["0.1.0"] as never)).resolves.toBeUndefined();
  });
});

describe("removePrunedVersions", () => {
  it("saca del record las versiones prunadas", () => {
    const rec = removePrunedVersions(regN(V7).acc!, ["0.1.0", "0.2.0"] as never);
    expect(rec.versions.map((v) => v.version).sort()).toEqual([
      "0.3.0", "0.4.0", "0.5.0", "0.6.0", "0.7.0",
    ]);
  });
});

describe("removeVersion", () => {
  it("saca una versión no-servida", () => {
    const reg = removeVersion(regN(V7), "acc", "0.1.0");
    expect(reg.acc!.versions.map((v) => v.version)).not.toContain("0.1.0");
    expect(reg.acc!.versions).toHaveLength(6);
  });
  it("rechaza borrar la servida (latest)", () => {
    expect(() => removeVersion(regN(V7), "acc", "0.7.0")).toThrow(InvalidManifestError);
  });
  it("rechaza borrar la servida (pinneada)", () => {
    const reg = setMiniappPin(regN(V7), "acc", "0.3.0");
    expect(() => removeVersion(reg, "acc", "0.3.0")).toThrow(InvalidManifestError);
  });
  it("versión inexistente → InvalidManifest; miniapp inexistente → NotFound", () => {
    expect(() => removeVersion(regN(V7), "acc", "9.9.9")).toThrow(InvalidManifestError);
    expect(() => removeVersion(regN(V7), "ghost", "0.1.0")).toThrow(MiniappNotFoundError);
  });
  it("no muta el registry original", () => {
    const start = regN(V7);
    removeVersion(start, "acc", "0.1.0");
    expect(start.acc!.versions).toHaveLength(7);
  });
});
