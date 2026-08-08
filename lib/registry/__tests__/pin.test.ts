import { describe, expect, it } from "vitest";
import { InvalidManifestError, MiniappNotFoundError, type Registry } from "@/lib/registry/types";
import {
  getMiniappDetail,
  listCatalog,
  publishVersion,
  registerMiniapp,
  resolveMiniapp,
  setMiniappPin,
} from "@/lib/registry/registry";

const now = "2026-08-06T10:00:00.000Z";
const manifest = (id: string, version: string) => ({
  id,
  version,
  entry: "./Entry",
  shared: [{ name: "react-native", requiredRange: "^0.76.0", singleton: true }],
  capabilities: [],
});

/** acc con versiones 0.1.0, 0.2.0, 0.3.0 (latest = 0.3.0). */
function reg3(): Registry {
  let reg = registerMiniapp({}, { id: "acc", name: "Acc", owner: "o" }, now);
  for (const v of ["0.1.0", "0.2.0", "0.3.0"]) {
    reg = publishVersion(reg, "acc", { version: v, url: `u/${v}`, manifest: manifest("acc", v) }, now);
  }
  return reg;
}

describe("setMiniappPin", () => {
  it("fija una versión existente", () => {
    expect(setMiniappPin(reg3(), "acc", "0.2.0").acc.pinnedVersion).toBe("0.2.0");
  });
  it("null despina (borra el campo)", () => {
    const cleared = setMiniappPin(setMiniappPin(reg3(), "acc", "0.2.0"), "acc", null);
    expect(cleared.acc.pinnedVersion).toBeUndefined();
    expect("pinnedVersion" in cleared.acc).toBe(false);
  });
  it("InvalidManifestError si la versión no existe", () => {
    expect(() => setMiniappPin(reg3(), "acc", "9.9.9")).toThrow(InvalidManifestError);
  });
  it("MiniappNotFoundError si la miniapp no existe", () => {
    expect(() => setMiniappPin(reg3(), "ghost", "0.1.0")).toThrow(MiniappNotFoundError);
  });
  it("no muta el registry original", () => {
    const reg = reg3();
    setMiniappPin(reg, "acc", "0.1.0");
    expect(reg.acc.pinnedVersion).toBeUndefined();
  });
});

describe("resolveMiniapp — pin", () => {
  it("sin pin sirve la última", () => {
    expect(resolveMiniapp(reg3(), "acc").version).toBe("0.3.0");
  });
  it("con pin sirve la fijada (rollback instantáneo)", () => {
    expect(resolveMiniapp(setMiniappPin(reg3(), "acc", "0.1.0"), "acc").version).toBe("0.1.0");
  });
  it("un ?version= explícito ignora el pin", () => {
    const pinned = setMiniappPin(reg3(), "acc", "0.1.0");
    expect(resolveMiniapp(pinned, "acc", { version: "0.2.0" }).version).toBe("0.2.0");
  });
});

describe("getMiniappDetail — pin/served", () => {
  it("sin pin: servedVersion = última, pinnedVersion undefined", () => {
    const d = getMiniappDetail(reg3(), "acc");
    expect(d.servedVersion).toBe("0.3.0");
    expect(d.pinnedVersion).toBeUndefined();
  });
  it("con pin: servedVersion = fijada, pinnedVersion set", () => {
    const d = getMiniappDetail(setMiniappPin(reg3(), "acc", "0.2.0"), "acc");
    expect(d.servedVersion).toBe("0.2.0");
    expect(d.pinnedVersion).toBe("0.2.0");
  });
});

describe("listCatalog — servedVersion", () => {
  const acc = (reg: ReturnType<typeof reg3>) => listCatalog(reg).find((e) => e.id === "acc");
  it("sin pin: servedVersion = latest", () => {
    expect(acc(reg3())?.servedVersion).toBe("0.3.0");
    expect(acc(reg3())?.latestVersion).toBe("0.3.0");
  });
  it("con pin: servedVersion = fijada, latestVersion sigue siendo la última", () => {
    const e = acc(setMiniappPin(reg3(), "acc", "0.1.0"));
    expect(e?.servedVersion).toBe("0.1.0");
    expect(e?.latestVersion).toBe("0.3.0");
  });
});
