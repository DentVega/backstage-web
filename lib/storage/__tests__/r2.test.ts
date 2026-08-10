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
    const calls: { url: string; method: string; headers?: Record<string, string> }[] = [];
    const fake: SignedFetch = async (url, init) => {
      calls.push({ url, method: init.method, headers: init.headers });
      return { ok: true, status: 200, text: async () => "" };
    };
    const r = await r2Storage(config, fake).putMany("cards_wallet/0.1.5", [
      { path: "cards_wallet.container.js.bundle", data: new Uint8Array([1, 2]) },
      { path: "vendors.chunk.bundle", data: new Uint8Array([3]) },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(
      "https://acct123.r2.cloudflarestorage.com/chunks/cards_wallet/0.1.5/cards_wallet.container.js.bundle",
    );
    expect(calls[0].method).toBe("PUT");
    // Content-Length must be pinned so R2 doesn't 411 on a chunked upload.
    expect(calls[0].headers?.["content-length"]).toBe("2");
    expect(calls[1].headers?.["content-length"]).toBe("1");
    // publicBaseUrl con barra final → limpiada
    expect(r.baseUrl).toBe("https://pub-abc.r2.dev/cards_wallet/0.1.5");
  });

  it("0 files → StorageError", async () => {
    const fake: SignedFetch = async () => ({ ok: true, status: 200, text: async () => "" });
    await expect(r2Storage(config, fake).putMany("x", [])).rejects.toBeInstanceOf(StorageError);
  });

  it("un PUT !ok → StorageError con el status", async () => {
    const fake: SignedFetch = async () => ({ ok: false, status: 403, text: async () => "" });
    await expect(
      r2Storage(config, fake).putMany("x", [{ path: "a.bundle", data: new Uint8Array([1]) }]),
    ).rejects.toThrow(/403/);
  });
});

describe("r2Storage.deletePrefix", () => {
  const listXml =
    "<ListBucketResult>" +
    "<Contents><Key>a/1.0.0/a.container.js.bundle</Key></Contents>" +
    "<Contents><Key>a/1.0.0/vendors.chunk.bundle</Key></Contents>" +
    "</ListBucketResult>";

  it("lista bajo el prefijo y borra cada key", async () => {
    const calls: { method: string; url: string }[] = [];
    const fake: SignedFetch = async (url, init) => {
      calls.push({ method: init.method, url });
      if (init.method === "GET") return { ok: true, status: 200, text: async () => listXml };
      return { ok: true, status: 200, text: async () => "" };
    };
    await r2Storage(config, fake).deletePrefix("a/1.0.0");
    expect(calls.filter((c) => c.method === "GET")).toHaveLength(1);
    const deletes = calls.filter((c) => c.method === "DELETE");
    expect(deletes).toHaveLength(2);
    expect(deletes[0]!.url).toContain("a/1.0.0/a.container.js.bundle");
    expect(deletes[1]!.url).toContain("a/1.0.0/vendors.chunk.bundle");
  });

  it("si el list no da ok, no borra nada (best-effort)", async () => {
    const methods: string[] = [];
    const fake: SignedFetch = async (_url, init) => {
      methods.push(init.method);
      return { ok: false, status: 500, text: async () => "" };
    };
    await r2Storage(config, fake).deletePrefix("a/1.0.0");
    expect(methods.filter((m) => m === "DELETE")).toHaveLength(0);
  });
});
