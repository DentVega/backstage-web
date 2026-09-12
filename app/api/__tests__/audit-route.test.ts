import { vi, describe, it, expect, beforeEach } from "vitest";

const store = { record: vi.fn(), readChain: vi.fn(), readAll: vi.fn(), verify: vi.fn() };
vi.mock("@/lib/audit/log", () => ({
  getAuditStore: () => store,
  GLOBAL_CHAIN: "_global",
}));
const authMock = vi.fn();
vi.mock("@/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/config", async (orig) => ({
  ...(await orig<typeof import("@/lib/config")>()),
  auditAdminLogins: () => ["brian"],
}));
const getApp = vi.fn();
vi.mock("@/lib/registry/store", () => ({ getStore: () => ({ getApp }) }));

import { GET } from "@/app/api/audit/route";

beforeEach(() => {
  store.readAll.mockReset().mockResolvedValue([{ seq: 1, action: "publish" }]);
  authMock.mockReset();
  getApp.mockReset();
});

describe("GET /api/audit", () => {
  it("feed global exige admin (401 sin sesión admin)", async () => {
    authMock.mockResolvedValue({ githubLogin: "rando" });
    const res = await GET(new Request("http://x/api/audit"));
    expect(res.status).toBe(401);
  });

  it("admin ve el feed global", async () => {
    authMock.mockResolvedValue({ githubLogin: "brian" });
    const res = await GET(new Request("http://x/api/audit"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ events: [{ seq: 1, action: "publish" }] });
  });

  it("por-miniapp: maintainer no-admin ve su cadena", async () => {
    authMock.mockResolvedValue({ githubLogin: "rando" });
    getApp.mockResolvedValue({ maintainers: ["rando"] });
    const res = await GET(new Request("http://x/api/audit?miniapp=hellow"));
    expect(res.status).toBe(200);
    expect(store.readAll).toHaveBeenCalledWith(expect.objectContaining({ miniapp: "hellow" }));
  });

  it("por-miniapp: un tercero no-maintainer no puede (401)", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    getApp.mockResolvedValue({ maintainers: ["rando"] });
    const res = await GET(new Request("http://x/api/audit?miniapp=hellow"));
    expect(res.status).toBe(401);
  });
});
