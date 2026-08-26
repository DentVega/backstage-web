import { describe, expect, it } from "vitest";
import { registerMiniapp, setMiniappPublicKey } from "@/lib/registry/registry";
import { MiniappNotFoundError } from "@/lib/registry/types";

const base = () => registerMiniapp({}, { id: "cards_wallet", name: "C", owner: "o" }, "t0");

describe("setMiniappPublicKey", () => {
  it("setea la pubkey", () => {
    const reg = setMiniappPublicKey(base(), "cards_wallet", "PK");
    expect(reg.cards_wallet.publicKey).toBe("PK");
  });
  it("null limpia el campo", () => {
    const withKey = setMiniappPublicKey(base(), "cards_wallet", "PK");
    const cleared = setMiniappPublicKey(withKey, "cards_wallet", null);
    expect(cleared.cards_wallet.publicKey).toBeUndefined();
  });
  it("tira MiniappNotFoundError si no existe", () => {
    expect(() => setMiniappPublicKey({}, "ghost", "PK")).toThrow(MiniappNotFoundError);
  });
});
