import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ reg: {} as Record<string, unknown> }));
vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({
    load: async () => state.reg,
    getAll: async () => state.reg,
    getApp: async (id: string) => (state.reg as Record<string, unknown>)[id],
    mutateApp: async (id: string, fn: (r: unknown) => unknown) => {
      const m = state.reg as Record<string, unknown>;
      const next = fn(m[id]);
      if (next === null) delete m[id];
      else m[id] = next;
      return next;
    },
    save: async (r: typeof state.reg) => {
      state.reg = r;
    },
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { PUT } from "@/app/api/miniapps/[id]/public-key/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "DentVega";
const reg = () => state.reg as Record<string, { publicKey?: string; maintainers?: string[] }>;
const putReq = (body: unknown) =>
  new Request("http://x/api/miniapps/cards_wallet/public-key", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.reg = { cards_wallet: { id: "cards_wallet", name: "C", owner: "o", versions: [] } };
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  authMock.mockResolvedValue({ githubLogin: ADMIN });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("PUT /api/miniapps/:id/public-key", () => {
  it("200 y setea la pubkey (admin)", async () => {
    const res = await PUT(putReq({ publicKey: "PK" }), params("cards_wallet"));
    expect(res.status).toBe(200);
    expect(reg().cards_wallet.publicKey).toBe("PK");
  });
  it("200 y limpia con null", async () => {
    await PUT(putReq({ publicKey: "PK" }), params("cards_wallet"));
    const res = await PUT(putReq({ publicKey: null }), params("cards_wallet"));
    expect(res.status).toBe(200);
    expect(reg().cards_wallet.publicKey).toBeUndefined();
  });
  it("403 si no es admin ni maintainer", async () => {
    authMock.mockResolvedValue({ githubLogin: "randolino" });
    const res = await PUT(putReq({ publicKey: "PK" }), params("cards_wallet"));
    expect(res.status).toBe(403);
  });
  it("400 si publicKey no es string ni null", async () => {
    const res = await PUT(putReq({ publicKey: 123 }), params("cards_wallet"));
    expect(res.status).toBe(400);
  });
  it("404 si la miniapp no existe", async () => {
    const res = await PUT(putReq({ publicKey: "PK" }), params("ghost"));
    expect(res.status).toBe(404);
  });
});
