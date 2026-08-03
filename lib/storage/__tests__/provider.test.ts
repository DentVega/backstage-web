import { afterEach, describe, expect, it } from "vitest";
import { availableProviders, isStorageProvider } from "@/lib/storage/provider";

const R2_VARS = {
  R2_ACCOUNT_ID: "a",
  R2_ACCESS_KEY_ID: "b",
  R2_SECRET_ACCESS_KEY: "c",
  R2_BUCKET: "d",
  R2_PUBLIC_BASE_URL: "e",
};

afterEach(() => {
  for (const k of Object.keys(R2_VARS)) delete process.env[k];
  delete process.env.BLOB_READ_WRITE_TOKEN;
});

describe("availableProviders", () => {
  it("solo fs cuando no hay nada configurado", () => {
    expect(availableProviders()).toEqual(["fs"]);
  });
  it("incluye r2 cuando están las 5 vars, en orden r2,fs", () => {
    Object.assign(process.env, R2_VARS);
    expect(availableProviders()).toEqual(["r2", "fs"]);
  });
  it("incluye blob con el token, en orden blob,fs", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    expect(availableProviders()).toEqual(["blob", "fs"]);
  });
  it("orden r2,blob,fs con todo configurado", () => {
    Object.assign(process.env, R2_VARS);
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    expect(availableProviders()).toEqual(["r2", "blob", "fs"]);
  });
});

describe("isStorageProvider", () => {
  it("acepta los tres", () => {
    expect(isStorageProvider("r2")).toBe(true);
    expect(isStorageProvider("blob")).toBe(true);
    expect(isStorageProvider("fs")).toBe(true);
  });
  it("rechaza otros valores", () => {
    expect(isStorageProvider("s3")).toBe(false);
    expect(isStorageProvider(null)).toBe(false);
    expect(isStorageProvider(undefined)).toBe(false);
    expect(isStorageProvider(3)).toBe(false);
  });
});
