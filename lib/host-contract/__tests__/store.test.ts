import { describe, expect, it } from "vitest";
import { isHostContract } from "@/lib/host-contract/types";
import { kvHostContractStore, jsonHostContractStore } from "@/lib/host-contract/store";
import { inMemoryKvClient } from "@/lib/registry/kv";

const VALID = {
  contractVersion: "1.0.0",
  reactNative: "0.76.6",
  shared: { react: "18.3.1", "react-native": "0.76.6" },
  nativeModules: ["react-native-screens"],
};

describe("isHostContract", () => {
  it("acepta un contract válido", () => expect(isHostContract(VALID)).toBe(true));
  it("rechaza objetos incompletos / mal tipados", () => {
    expect(isHostContract(null)).toBe(false);
    expect(isHostContract({ ...VALID, shared: "x" })).toBe(false);
    expect(isHostContract({ ...VALID, shared: { react: 123 } })).toBe(false);
    expect(isHostContract({ ...VALID, nativeModules: "x" })).toBe(false);
    expect(isHostContract({ contractVersion: "1.0.0" })).toBe(false);
  });
});

const memKv = inMemoryKvClient;

describe("kvHostContractStore", () => {
  it("load null cuando no hay contract", async () => {
    expect(await kvHostContractStore(memKv()).load()).toBeNull();
  });
  it("save + load roundtrip", async () => {
    const store = kvHostContractStore(memKv());
    await store.save(VALID as never);
    expect(await store.load()).toEqual(VALID);
  });
});
