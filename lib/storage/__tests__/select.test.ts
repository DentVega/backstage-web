import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pref: null as string | null }));

// Solo se stubean las FÁBRICAS de adapters (para no tocar red ni disco); la detección por env
// y la selección de provider son las reales de la librería.
vi.mock("@dentvega/miniapp-storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  r2Storage: () => ({ __kind: "r2" }),
  s3Storage: () => ({ __kind: "s3" }),
  gcsStorage: () => ({ __kind: "gcs" }),
  azureStorage: () => ({ __kind: "azure" }),
  fsStorage: () => ({ __kind: "fs" }),
}));
vi.mock("@dentvega/miniapp-storage/vercel-blob", () => ({
  blobStorage: () => ({ __kind: "blob" }),
}));
vi.mock("@/lib/storage/preference", () => ({
  getStoragePreferenceStore: () => ({ load: async () => state.pref }),
}));

import { getStorage, getStorageProviderState, getMiniappStorageState } from "@/lib/storage";

const kind = (s: unknown) => (s as { __kind: string }).__kind;

/** R2 exige sus 5 vars; el helper evita repetirlas en cada test. */
function withR2(): void {
  process.env.R2_ACCOUNT_ID = "a";
  process.env.R2_ACCESS_KEY_ID = "b";
  process.env.R2_SECRET_ACCESS_KEY = "c";
  process.env.R2_BUCKET = "d";
  process.env.R2_PUBLIC_BASE_URL = "https://cdn.example.com";
}

const ENV_KEYS = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET",
  "R2_PUBLIC_BASE_URL",
  "BLOB_READ_WRITE_TOKEN",
  "AWS_S3_BUCKET",
  "AWS_REGION",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "GCS_BUCKET",
  "GCS_HMAC_ACCESS_KEY_ID",
  "GCS_HMAC_SECRET",
  "AZURE_STORAGE_ACCOUNT",
  "AZURE_STORAGE_CONTAINER",
  "AZURE_STORAGE_SAS_TOKEN",
];

beforeEach(() => {
  state.pref = null;
  for (const k of ENV_KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
  vi.restoreAllMocks();
});

describe("getStorage — env-order sin preferencia", () => {
  it("R2 si está configurado", async () => {
    withR2();
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

describe("getStorage — providers nuevos", () => {
  it("construye AWS S3 cuando es el activo", async () => {
    process.env.AWS_S3_BUCKET = "b";
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ACCESS_KEY_ID = "ak";
    process.env.AWS_SECRET_ACCESS_KEY = "sk";
    expect(kind(await getStorage())).toBe("s3");
  });
  it("construye GCS cuando es el activo", async () => {
    process.env.GCS_BUCKET = "b";
    process.env.GCS_HMAC_ACCESS_KEY_ID = "GOOG1";
    process.env.GCS_HMAC_SECRET = "s";
    expect(kind(await getStorage())).toBe("gcs");
  });
  it("construye Azure cuando es el activo", async () => {
    process.env.AZURE_STORAGE_ACCOUNT = "acc";
    process.env.AZURE_STORAGE_CONTAINER = "c";
    process.env.AZURE_STORAGE_SAS_TOKEN = "sv=x";
    expect(kind(await getStorage())).toBe("azure");
  });
});

describe("getStorage — con preferencia", () => {
  it("la preferencia gana si está disponible", async () => {
    withR2();
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    state.pref = "blob";
    expect(kind(await getStorage())).toBe("blob");
  });
  it("preferencia no disponible → fallback env-order[0]", async () => {
    withR2(); // blob NO configurado
    state.pref = "blob";
    expect(kind(await getStorage())).toBe("r2");
  });
});

describe("getStorageProviderState", () => {
  it("source 'preference' cuando la pref se aplica", async () => {
    withR2();
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    state.pref = "blob";
    expect(await getStorageProviderState()).toEqual({
      available: ["r2", "blob", "fs"],
      active: "blob",
      source: "preference",
    });
  });
  it("source 'env' cuando no hay pref aplicable", async () => {
    withR2();
    expect(await getStorageProviderState()).toEqual({
      available: ["r2", "fs"],
      active: "r2",
      source: "env",
    });
  });
});

describe("getStorage — override por miniapp", () => {
  it("el override gana si está disponible", async () => {
    withR2();
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    expect(kind(await getStorage("blob"))).toBe("blob");
  });
  it("override no disponible → cae al default global", async () => {
    withR2(); // blob NO configurado
    expect(kind(await getStorage("blob"))).toBe("r2");
  });
});

describe("getMiniappStorageState", () => {
  it("override aplica → effective=override, source=miniapp", async () => {
    withR2();
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
    withR2();
    expect(await getMiniappStorageState(null)).toEqual({
      available: ["r2", "fs"],
      override: null,
      defaultProvider: "r2",
      effective: "r2",
      source: "env",
    });
  });
});
