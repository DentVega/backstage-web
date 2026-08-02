import { describe, expect, it } from "vitest";
import { r2Storage, r2ConfigFromEnv, type SignedFetch } from "@/lib/storage/r2";
import { StorageError } from "@/lib/storage/types";

const config = {
  accountId: "acct123",
  accessKeyId: "ak",
  secretAccessKey: "sk",
  bucket: "chunks",
  publicBaseUrl: "https://pub-abc.r2.dev/",
};

describe("r2ConfigFromEnv", () => {
  it("null si falta alguna var", () => {
    const old = process.env;
    process.env = { ...old, R2_ACCOUNT_ID: "x" };
    delete process.env.R2_ACCESS_KEY_ID;
    expect(r2ConfigFromEnv()).toBeNull();
    process.env = old;
  });
  it("devuelve la config con las 5", () => {
    const old = process.env;
    process.env = {
      ...old,
      R2_ACCOUNT_ID: "a",
      R2_ACCESS_KEY_ID: "b",
      R2_SECRET_ACCESS_KEY: "c",
      R2_BUCKET: "d",
      R2_PUBLIC_BASE_URL: "e",
    };
    expect(r2ConfigFromEnv()).toEqual({
      accountId: "a",
      accessKeyId: "b",
      secretAccessKey: "c",
      bucket: "d",
      publicBaseUrl: "e",
    });
    process.env = old;
  });
});

describe("r2Storage.putMany", () => {
  it("PUTea cada file al endpoint S3 y devuelve la URL pública como baseUrl", async () => {
    const calls: { url: string; method: string }[] = [];
    const fake: SignedFetch = async (url, init) => {
      calls.push({ url, method: init.method });
      return { ok: true, status: 200 };
    };
    const r = await r2Storage(config, fake).putMany("cards_wallet/0.1.5", [
      { path: "cards_wallet.container.js.bundle", data: new Uint8Array([1, 2]) },
      { path: "vendors.chunk.bundle", data: new Uint8Array([3]) },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      url: "https://acct123.r2.cloudflarestorage.com/chunks/cards_wallet/0.1.5/cards_wallet.container.js.bundle",
      method: "PUT",
    });
    // publicBaseUrl con barra final → limpiada
    expect(r.baseUrl).toBe("https://pub-abc.r2.dev/cards_wallet/0.1.5");
  });

  it("0 files → StorageError", async () => {
    const fake: SignedFetch = async () => ({ ok: true, status: 200 });
    await expect(r2Storage(config, fake).putMany("x", [])).rejects.toBeInstanceOf(StorageError);
  });

  it("un PUT !ok → StorageError con el status", async () => {
    const fake: SignedFetch = async () => ({ ok: false, status: 403 });
    await expect(
      r2Storage(config, fake).putMany("x", [{ path: "a.bundle", data: new Uint8Array([1]) }]),
    ).rejects.toThrow(/403/);
  });
});
