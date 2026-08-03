import { describe, expect, it } from "vitest";
import { updateMiniappMeta } from "@/lib/registry/registry";
import { MiniappNotFoundError } from "@/lib/registry/types";
import type { Registry } from "@/lib/registry/types";

function baseReg(): Registry {
  return {
    account_dashboard: { id: "account_dashboard", name: "Account Dashboard", owner: "payments-team", versions: [] },
    cards_wallet: { id: "cards_wallet", name: "Cards", owner: "o", versions: [] },
  } as unknown as Registry;
}

const REAL_URL = "https://github.com/DentVega/miniapp-account-dashboard";

describe("updateMiniappMeta", () => {
  it("actualiza el repoUrl", () => {
    const next = updateMiniappMeta(baseReg(), "account_dashboard", { repoUrl: REAL_URL });
    expect(next.account_dashboard.repoUrl).toBe(REAL_URL);
  });
  it("actualiza el owner", () => {
    const next = updateMiniappMeta(baseReg(), "account_dashboard", { owner: "DentVega" });
    expect(next.account_dashboard.owner).toBe("DentVega");
  });
  it("actualiza ambos y no toca otras miniapps", () => {
    const next = updateMiniappMeta(baseReg(), "account_dashboard", { repoUrl: REAL_URL, owner: "DentVega" });
    expect(next.account_dashboard.owner).toBe("DentVega");
    expect(next.account_dashboard.repoUrl).toBe(REAL_URL);
    expect(next.cards_wallet.owner).toBe("o");
  });
  it("no muta el registry original", () => {
    const reg = baseReg();
    updateMiniappMeta(reg, "account_dashboard", { owner: "DentVega" });
    expect(reg.account_dashboard.owner).toBe("payments-team");
  });
  it("MiniappNotFoundError si el id no existe", () => {
    expect(() => updateMiniappMeta(baseReg(), "ghost", { owner: "x" })).toThrow(MiniappNotFoundError);
  });
});
