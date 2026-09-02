import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Registry } from "@/lib/registry/types";

const state = vi.hoisted(() => ({ reg: {} as Registry }));
const gitState = vi.hoisted(() => ({
  result: { deleted: true } as { deleted: boolean },
  error: null as Error | null,
  calls: [] as { owner: string; repo: string }[],
}));
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
    save: async (r: Registry) => {
      state.reg = r;
    },
  }),
}));
vi.mock("@/lib/git/github", () => ({
  githubProvider: () => ({
    deleteRepo: async (input: { owner: string; repo: string }) => {
      gitState.calls.push(input);
      if (gitState.error) throw gitState.error;
      return gitState.result;
    },
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { DELETE } from "@/app/api/miniapps/[id]/route";
import { auth } from "@/auth";
import { GitProviderError } from "@/lib/git/types";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "DentVega";

function req(): Request {
  return new Request("http://x/api/miniapps/test_prod", { method: "DELETE" });
}
function reqRepo(id: string): Request {
  return new Request(`http://x/api/miniapps/${id}?repo=true`, { method: "DELETE" });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.reg = {
    test_prod: {
      id: "test_prod" as never,
      name: "Test",
      owner: "o",
      versions: [],
      repoUrl: "https://github.com/DentVega/miniapp-test_prod",
    },
    cards_wallet: { id: "cards_wallet" as never, name: "Cards", owner: "o", versions: [] },
  } as never;
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  process.env.GITHUB_TOKEN = "tok";
  gitState.result = { deleted: true };
  gitState.error = null;
  gitState.calls = [];
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

  it("?repo=true: borra el repo (owner/repo del repoUrl) + la entrada", async () => {
    const res = await DELETE(reqRepo("test_prod"), params("test_prod"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: true, repoDeleted: true });
    expect(gitState.calls[0]).toEqual({ owner: "DentVega", repo: "miniapp-test_prod" });
    expect(state.reg.test_prod).toBeUndefined();
  });

  it("?repo=true con repo ya borrado (deleted:false) → 200 y borra el registry igual", async () => {
    gitState.result = { deleted: false };
    const res = await DELETE(reqRepo("test_prod"), params("test_prod"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ repoDeleted: false });
    expect(state.reg.test_prod).toBeUndefined();
  });

  it("?repo=true y el borrado del repo falla → 403 y NO borra el registry", async () => {
    gitState.error = new GitProviderError("delete_repo");
    const res = await DELETE(reqRepo("test_prod"), params("test_prod"));
    expect(res.status).toBe(403);
    expect(state.reg.test_prod).toBeDefined(); // intacto
  });

  it("?repo=true sin repoUrl en el record → 400, registry intacto", async () => {
    const res = await DELETE(reqRepo("cards_wallet"), params("cards_wallet"));
    expect(res.status).toBe(400);
    expect(state.reg.cards_wallet).toBeDefined();
  });
});
