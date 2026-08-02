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

import { DELETE } from "@/app/api/miniapps/[id]/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "DentVega";

function req(): Request {
  return new Request("http://x/api/miniapps/test_prod", { method: "DELETE" });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.reg = {
    test_prod: { id: "test_prod" as never, name: "Test", owner: "o", versions: [] },
    cards_wallet: { id: "cards_wallet" as never, name: "Cards", owner: "o", versions: [] },
  } as never;
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  authMock.mockResolvedValue({ githubLogin: ADMIN });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("DELETE /api/miniapps/:id", () => {
  it("403 sin sesión allowlisted (no borra nada)", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    const res = await DELETE(req(), params("test_prod"));
    expect(res.status).toBe(403);
    expect(state.reg.test_prod).toBeDefined();
  });

  it("403 sin sesión", async () => {
    authMock.mockResolvedValue(null);
    expect((await DELETE(req(), params("test_prod"))).status).toBe(403);
  });

  it("200 y borra la entrada (deja las demás)", async () => {
    const res = await DELETE(req(), params("test_prod"));
    expect(res.status).toBe(200);
    expect(state.reg.test_prod).toBeUndefined();
    expect(state.reg.cards_wallet).toBeDefined(); // no toca las otras
  });

  it("404 si el id no existe", async () => {
    const res = await DELETE(req(), params("ghost"));
    expect(res.status).toBe(404);
  });
});
