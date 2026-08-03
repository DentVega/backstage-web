import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Registry } from "@/lib/registry/types";

const state = vi.hoisted(() => ({ reg: {} as Registry }));
vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({
    load: async () => state.reg,
    save: async (r: Registry) => {
      state.reg = r;
    },
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { PATCH } from "@/app/api/miniapps/[id]/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "DentVega";
const REAL_URL = "https://github.com/DentVega/miniapp-account-dashboard";

function patchReq(body: unknown): Request {
  return new Request("http://x/api/miniapps/account_dashboard", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.reg = {
    account_dashboard: { id: "account_dashboard" as never, name: "Account", owner: "payments-team", versions: [] },
  } as never;
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  authMock.mockResolvedValue({ githubLogin: ADMIN });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("PATCH /api/miniapps/:id", () => {
  it("200 y actualiza repoUrl + owner (admin)", async () => {
    const res = await PATCH(patchReq({ repoUrl: REAL_URL, owner: "DentVega" }), params("account_dashboard"));
    expect(res.status).toBe(200);
    expect(state.reg.account_dashboard.repoUrl).toBe(REAL_URL);
    expect(state.reg.account_dashboard.owner).toBe("DentVega");
  });
  it("400 repoUrl inválido (no persiste)", async () => {
    const res = await PATCH(patchReq({ repoUrl: "not-a-url" }), params("account_dashboard"));
    expect(res.status).toBe(400);
    expect(state.reg.account_dashboard.repoUrl).toBeUndefined();
  });
  it("400 body sin campos para actualizar", async () => {
    const res = await PATCH(patchReq({}), params("account_dashboard"));
    expect(res.status).toBe(400);
  });
  it("403 sin admin", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    const res = await PATCH(patchReq({ owner: "x" }), params("account_dashboard"));
    expect(res.status).toBe(403);
  });
  it("404 si el id no existe", async () => {
    const res = await PATCH(patchReq({ owner: "x" }), params("ghost"));
    expect(res.status).toBe(404);
  });
});
