import { describe, expect, it } from "vitest";
import { setMaintainers, getMiniappDetail } from "@/lib/registry/registry";
import { MiniappNotFoundError } from "@/lib/registry/types";
import type { Registry } from "@/lib/registry/types";

function baseReg(): Registry {
  return {
    acc: { id: "acc", name: "Acc", owner: "o", versions: [] },
  } as unknown as Registry;
}

describe("setMaintainers", () => {
  it("setea la lista (normaliza + dedup)", () => {
    const reg = setMaintainers(baseReg(), "acc", [" alice ", "bob", "alice"]);
    expect(reg.acc!.maintainers).toEqual(["alice", "bob"]);
  });
  it("lista vacía borra el campo", () => {
    const withM = setMaintainers(baseReg(), "acc", ["alice"]);
    const cleared = setMaintainers(withM, "acc", []);
    expect(cleared.acc!.maintainers).toBeUndefined();
    expect("maintainers" in cleared.acc!).toBe(false);
  });
  it("MiniappNotFoundError si no existe", () => {
    expect(() => setMaintainers(baseReg(), "ghost", ["x"])).toThrow(MiniappNotFoundError);
  });
  it("no muta el registry original", () => {
    const reg = baseReg();
    setMaintainers(reg, "acc", ["alice"]);
    expect(reg.acc!.maintainers).toBeUndefined();
  });
});

describe("getMiniappDetail — maintainers", () => {
  it("proyecta los maintainers cuando el record los tiene", () => {
    const reg = setMaintainers(baseReg(), "acc", ["alice"]);
    expect(getMiniappDetail(reg, "acc").maintainers).toEqual(["alice"]);
  });
  it("los omite cuando no hay", () => {
    expect(getMiniappDetail(baseReg(), "acc").maintainers).toBeUndefined();
  });
});
