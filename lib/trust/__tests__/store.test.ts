import { describe, expect, it } from "vitest";
import { inMemoryKvClient } from "@/lib/registry/kv";
import { kvTrustBundleStore } from "@/lib/trust/store";
import type { SignedTrustBundle } from "@/lib/trust/types";

const sample: SignedTrustBundle = {
  bundle: { version: 1, updatedAt: "2026-08-26T00:00:00.000Z", keys: { cards_wallet: "PK" } },
  signature: "rootsig",
};

describe("kvTrustBundleStore", () => {
  it("load devuelve null cuando no hay nada", async () => {
    const store = kvTrustBundleStore(inMemoryKvClient());
    expect(await store.load()).toBeNull();
  });
  it("save y load hacen round-trip", async () => {
    const store = kvTrustBundleStore(inMemoryKvClient());
    await store.save(sample);
    expect(await store.load()).toEqual(sample);
  });
});
