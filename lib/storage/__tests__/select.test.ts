import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pref: null as string | null }));

vi.mock("@/lib/storage/r2", () => ({
  r2ConfigFromEnv: () => (process.env.R2_ACCOUNT_ID ? { accountId: "a" } : null),
  r2Storage: () => ({ __kind: "r2" }),
}));
vi.mock("@/lib/storage/blob", () => ({ blobStorage: () => ({ __kind: "blob" }) }));
vi.mock("@/lib/storage/fs", () => ({ fsStorage: () => ({ __kind: "fs" }) }));
vi.mock("@/lib/storage/preference", () => ({
  getStoragePreferenceStore: () => ({ load: async () => state.pref }),
}));

import { getStorage, getStorageProviderState, getMiniappStorageState } from "@/lib/storage";

const kind = (s: unknown) => (s as { __kind: string }).__kind;

beforeEach(() => {
  state.pref = null;
});
afterEach(() => {
  delete process.env.R2_ACCOUNT_ID;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  vi.restoreAllMocks();
});

describe("getStorage — env-order sin preferencia", () => {
  it("R2 si está configurado", async () => {
    process.env.R2_ACCOUNT_ID = "a";
    expect(kind(await getStorage())).toBe("r2");
  });
  it("Blob si no hay R2 pero hay token", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    expect(kind(await getStorage())).toBe("blob");
  });
  it("fs si no hay nada", async () => {
    expect(kind(await getStorage())).toBe("fs");
  });
});

describe("getStorage — con preferencia", () => {
  it("la preferencia gana si está disponible", async () => {
    process.env.R2_ACCOUNT_ID = "a";
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    state.pref = "blob";
    expect(kind(await getStorage())).toBe("blob");
  });
  it("preferencia no disponible → fallback env-order[0]", async () => {
    process.env.R2_ACCOUNT_ID = "a"; // blob NO configurado
    state.pref = "blob";
    expect(kind(await getStorage())).toBe("r2");
  });
});

describe("getStorageProviderState", () => {
  it("source 'preference' cuando la pref se aplica", async () => {
    process.env.R2_ACCOUNT_ID = "a";
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    state.pref = "blob";
    expect(await getStorageProviderState()).toEqual({
      available: ["r2", "blob", "fs"],
      active: "blob",
      source: "preference",
    });
  });
  it("source 'env' cuando no hay pref aplicable", async () => {
    process.env.R2_ACCOUNT_ID = "a";
    expect(await getStorageProviderState()).toEqual({
      available: ["r2", "fs"],
      active: "r2",
      source: "env",
    });
  });
});

describe("getStorage — override por miniapp", () => {
  it("el override gana si está disponible", async () => {
    process.env.R2_ACCOUNT_ID = "a";
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    expect(kind(await getStorage("blob"))).toBe("blob");
  });
  it("override no disponible → cae al default global", async () => {
    process.env.R2_ACCOUNT_ID = "a"; // blob NO configurado
    expect(kind(await getStorage("blob"))).toBe("r2");
  });
});

describe("getMiniappStorageState", () => {
  it("override aplica → effective=override, source=miniapp", async () => {
    process.env.R2_ACCOUNT_ID = "a";
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    expect(await getMiniappStorageState("blob")).toEqual({
      available: ["r2", "blob", "fs"],
      override: "blob",
      defaultProvider: "r2",
      effective: "blob",
      source: "miniapp",
    });
  });
  it("sin override → effective=default global, source=env", async () => {
    process.env.R2_ACCOUNT_ID = "a";
    expect(await getMiniappStorageState(null)).toEqual({
      available: ["r2", "fs"],
      override: null,
      defaultProvider: "r2",
      effective: "r2",
      source: "env",
    });
  });
});
