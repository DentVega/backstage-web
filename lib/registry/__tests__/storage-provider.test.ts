import { describe, expect, it } from "vitest";
import { setMiniappStorageProvider, getMiniappDetail } from "@/lib/registry/registry";
import { MiniappNotFoundError } from "@/lib/registry/types";
import type { Registry } from "@/lib/registry/types";

function baseReg(): Registry {
  return {
    cards_wallet: { id: "cards_wallet", name: "Cards", owner: "o", versions: [] },
    hellow_widget: { id: "hellow_widget", name: "Hi", owner: "o", versions: [] },
  } as unknown as Registry;
}

describe("setMiniappStorageProvider", () => {
  it("setea el provider en la miniapp", () => {
    const next = setMiniappStorageProvider(baseReg(), "cards_wallet", "blob");
    expect(next.cards_wallet.storageProvider).toBe("blob");
  });
  it("null limpia el override (borra el campo)", () => {
    const withPref = setMiniappStorageProvider(baseReg(), "cards_wallet", "blob");
    const cleared = setMiniappStorageProvider(withPref, "cards_wallet", null);
    expect(cleared.cards_wallet.storageProvider).toBeUndefined();
    expect("storageProvider" in cleared.cards_wallet).toBe(false);
  });
  it("no toca otras miniapps", () => {
    const next = setMiniappStorageProvider(baseReg(), "cards_wallet", "r2");
    expect(next.hellow_widget.storageProvider).toBeUndefined();
  });
  it("no muta el registry original", () => {
    const reg = baseReg();
    setMiniappStorageProvider(reg, "cards_wallet", "blob");
    expect(reg.cards_wallet.storageProvider).toBeUndefined();
  });
  it("MiniappNotFoundError si el id no existe", () => {
    expect(() => setMiniappStorageProvider(baseReg(), "ghost", "r2")).toThrow(MiniappNotFoundError);
  });
});

describe("getMiniappDetail — storageProvider", () => {
  it("incluye el override cuando el record lo tiene", () => {
    const reg = setMiniappStorageProvider(baseReg(), "cards_wallet", "blob");
    expect(getMiniappDetail(reg, "cards_wallet").storageProvider).toBe("blob");
  });
  it("lo omite cuando no está", () => {
    expect(getMiniappDetail(baseReg(), "cards_wallet").storageProvider).toBeUndefined();
  });
});
