import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  reg: {} as Record<
    string,
    { id: string; name: string; owner: string; versions: []; storageProvider?: string }
  >,
}));

vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({
    load: async () => state.reg,
    save: async (r: typeof state.reg) => {
      state.reg = r;
    },
  }),
}));
vi.mock("@/lib/storage", () => ({
  getMiniappStorageState: async (override: string | null) => ({
    available: ["r2", "blob", "fs"],
    override,
    defaultProvider: "r2",
    effective: override ?? "r2",
    source: override ? "miniapp" : "env",
  }),
}));
vi.mock("@/lib/storage/provider", () => ({
  availableProviders: () => ["r2", "blob", "fs"],
  isStorageProvider: (v: unknown) => v === "r2" || v === "blob" || v === "fs",
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { PUT } from "@/app/api/miniapps/[id]/storage-provider/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "DentVega";

function putReq(body: unknown): Request {
  return new Request("http://x/api/miniapps/cards_wallet/storage-provider", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.reg = { cards_wallet: { id: "cards_wallet", name: "Cards", owner: "o", versions: [] } };
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  authMock.mockResolvedValue({ githubLogin: ADMIN });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("PUT /api/miniapps/:id/storage-provider", () => {
  it("200 y setea el override (admin)", async () => {
    const res = await PUT(putReq({ provider: "blob" }), params("cards_wallet"));
    expect(res.status).toBe(200);
    expect(state.reg.cards_wallet.storageProvider).toBe("blob");
  });
  it("200 y limpia con provider null", async () => {
    await PUT(putReq({ provider: "blob" }), params("cards_wallet"));
    const res = await PUT(putReq({ provider: null }), params("cards_wallet"));
    expect(res.status).toBe(200);
    expect(state.reg.cards_wallet.storageProvider).toBeUndefined();
  });
  it("400 provider no disponible (no persiste)", async () => {
    const res = await PUT(putReq({ provider: "s3" }), params("cards_wallet"));
    expect(res.status).toBe(400);
    expect(state.reg.cards_wallet.storageProvider).toBeUndefined();
  });
  it("403 sin admin", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    const res = await PUT(putReq({ provider: "blob" }), params("cards_wallet"));
    expect(res.status).toBe(403);
    expect(state.reg.cards_wallet.storageProvider).toBeUndefined();
  });
  it("404 miniapp inexistente", async () => {
    const res = await PUT(putReq({ provider: "blob" }), params("ghost"));
    expect(res.status).toBe(404);
  });
});
