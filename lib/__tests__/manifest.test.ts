import { afterEach, describe, expect, it, vi } from "vitest";
import type { HostContract } from "@/lib/host-contract/types";

const state = vi.hoisted(() => ({ contract: null as HostContract | null }));
vi.mock("@/lib/host-contract/store", () => ({
  getHostContractStore: () => ({ load: async () => state.contract, save: async () => {} }),
}));

import { resolveDefaultShared } from "@/lib/manifest";

afterEach(() => { state.contract = null; });

describe("resolveDefaultShared", () => {
  it("deriva del contract guardado (^version)", async () => {
    state.contract = {
      contractVersion: "1.0.0", reactNative: "0.76.6",
      shared: { react: "18.3.1", "react-native": "0.76.6" }, nativeModules: [],
    };
    const shared = await resolveDefaultShared();
    expect(shared).toContainEqual({ name: "react-native", requiredRange: "^0.76.6", singleton: true });
    expect(shared).toContainEqual({ name: "react", requiredRange: "^18.3.1", singleton: true });
  });
  it("fallback al hardcodeado si no hay contract", async () => {
    state.contract = null;
    const shared = await resolveDefaultShared();
    expect(shared.some((s) => s.name === "react-native")).toBe(true);
  });
});
