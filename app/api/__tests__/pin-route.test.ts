import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mkVer = (version: string) => ({
  version,
  url: `u/${version}`,
  publishedAt: "2026-08-06T10:00:00.000Z",
  manifest: { id: "cards_wallet", version, entry: "./Entry", shared: [], capabilities: [] },
});

const state = vi.hoisted(() => ({ reg: {} as Record<string, unknown> }));

vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({
    load: async () => state.reg,
    save: async (r: typeof state.reg) => {
      state.reg = r;
    },
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { PUT } from "@/app/api/miniapps/[id]/pin/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "DentVega";
const reg = () => state.reg as Record<string, { pinnedVersion?: string }>;

function putReq(body: unknown): Request {
  return new Request("http://x/api/miniapps/cards_wallet/pin", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.reg = {
    cards_wallet: { id: "cards_wallet", name: "Cards", owner: "o", versions: [mkVer("0.1.0"), mkVer("0.2.0")] },
  };
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  authMock.mockResolvedValue({ githubLogin: ADMIN });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("PUT /api/miniapps/:id/pin", () => {
  it("200 y fija la versión; el detail refleja servedVersion", async () => {
    const res = await PUT(putReq({ version: "0.1.0" }), params("cards_wallet"));
    expect(res.status).toBe(200);
    expect(reg().cards_wallet.pinnedVersion).toBe("0.1.0");
    expect(((await res.json()) as { servedVersion: string }).servedVersion).toBe("0.1.0");
  });
  it("200 y despina con version null", async () => {
    await PUT(putReq({ version: "0.1.0" }), params("cards_wallet"));
    const res = await PUT(putReq({ version: null }), params("cards_wallet"));
    expect(res.status).toBe(200);
    expect(reg().cards_wallet.pinnedVersion).toBeUndefined();
  });
  it("400 versión inexistente (no persiste)", async () => {
    const res = await PUT(putReq({ version: "9.9.9" }), params("cards_wallet"));
    expect(res.status).toBe(400);
    expect(reg().cards_wallet.pinnedVersion).toBeUndefined();
  });
  it("400 version no-string", async () => {
    expect((await PUT(putReq({ version: 123 }), params("cards_wallet"))).status).toBe(400);
  });
  it("403 sin admin (no persiste)", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    const res = await PUT(putReq({ version: "0.1.0" }), params("cards_wallet"));
    expect(res.status).toBe(403);
    expect(reg().cards_wallet.pinnedVersion).toBeUndefined();
  });
  it("404 miniapp inexistente", async () => {
    expect((await PUT(putReq({ version: "0.1.0" }), params("ghost"))).status).toBe(404);
  });
});
