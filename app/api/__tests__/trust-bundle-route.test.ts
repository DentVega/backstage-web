import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeypair, signMessage } from "@/lib/crypto/ed25519";
import { canonicalBundleMessage } from "@/lib/trust/message";
import type { SignedTrustBundle } from "@/lib/trust/types";

const state = vi.hoisted(() => ({ bundle: null as SignedTrustBundle | null }));
vi.mock("@/lib/trust/store", () => ({
  getTrustBundleStore: () => ({
    load: async () => state.bundle,
    save: async (b: SignedTrustBundle) => {
      state.bundle = b;
    },
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/trust-bundle/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "DentVega";
const root = generateKeypair();
const signed = (): SignedTrustBundle => {
  const body = { version: 1, updatedAt: "2026-08-26T00:00:00.000Z", keys: { cards_wallet: "PK" } };
  return { bundle: body, signature: signMessage(canonicalBundleMessage(body), root.privateKey) };
};
const putReq = (b: unknown) =>
  new Request("http://x/api/trust-bundle", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(b),
  });

beforeEach(() => {
  state.bundle = null;
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  authMock.mockResolvedValue({ githubLogin: ADMIN });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
  delete process.env.ROOT_PUBLIC_KEY;
});

describe("GET /api/trust-bundle", () => {
  it("404 cuando no hay bundle", async () => {
    expect((await GET()).status).toBe(404);
  });
  it("200 y devuelve el bundle guardado", async () => {
    state.bundle = signed();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(signed());
  });
});

describe("PUT /api/trust-bundle", () => {
  it("200 y guarda (admin)", async () => {
    const res = await PUT(putReq(signed()));
    expect(res.status).toBe(200);
    expect(state.bundle).toEqual(signed());
  });
  it("401 sin sesión admin ni token", async () => {
    authMock.mockResolvedValue({ githubLogin: "randolino" });
    delete process.env.PUBLISH_TOKEN;
    expect((await PUT(putReq(signed()))).status).toBe(401);
    expect(state.bundle).toBeNull();
  });
  it("200 con Bearer PUBLISH_TOKEN (CLI headless, sin sesión)", async () => {
    authMock.mockResolvedValue(null);
    process.env.PUBLISH_TOKEN = "secret-token";
    const req = new Request("http://x/api/trust-bundle", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: "Bearer secret-token" },
      body: JSON.stringify(signed()),
    });
    const res = await PUT(req);
    expect(res.status).toBe(200);
    expect(state.bundle).toEqual(signed());
    delete process.env.PUBLISH_TOKEN;
  });
  it("400 si el body no tiene la forma de SignedTrustBundle", async () => {
    expect((await PUT(putReq({ nope: 1 }))).status).toBe(400);
  });
  it("400 con ROOT_PUBLIC_KEY seteada y firma inválida", async () => {
    process.env.ROOT_PUBLIC_KEY = root.publicKey;
    const bad = { ...signed(), signature: "firma-mala" };
    const res = await PUT(putReq(bad));
    expect(res.status).toBe(400);
    expect(state.bundle).toBeNull();
  });
  it("200 con ROOT_PUBLIC_KEY seteada y firma válida", async () => {
    process.env.ROOT_PUBLIC_KEY = root.publicKey;
    expect((await PUT(putReq(signed()))).status).toBe(200);
  });
});
