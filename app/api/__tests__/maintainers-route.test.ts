import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  reg: {} as Record<string, unknown>,
  collaborators: [] as string[],
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
    save: async (r: typeof state.reg) => {
      state.reg = r;
    },
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/git/collaborators", () => ({
  repoCollaboratorLogins: async () => state.collaborators,
}));

import { PUT } from "@/app/api/miniapps/[id]/maintainers/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const reg = () => state.reg as Record<string, { maintainers?: string[] }>;
function put(body: unknown): Request {
  return new Request("http://x/api/miniapps/acc/maintainers", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.reg = {
    acc: { id: "acc", name: "Acc", owner: "o", repoUrl: "https://github.com/o/acc", versions: [] },
  };
  state.collaborators = ["alice", "bob", "carol"];
  process.env.SCAFFOLD_ALLOWED_LOGINS = "DentVega";
  authMock.mockResolvedValue({ githubLogin: "DentVega" });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("PUT /api/miniapps/:id/maintainers", () => {
  it("un platform-admin setea la lista (todos collaborators)", async () => {
    const res = await PUT(put({ maintainers: ["alice", "bob"] }), params("acc"));
    expect(res.status).toBe(200);
    expect(reg().acc.maintainers).toEqual(["alice", "bob"]);
  });

  it("un maintainer actual puede editar (auto-gobierno)", async () => {
    (state.reg.acc as { maintainers?: string[] }).maintainers = ["alice"];
    authMock.mockResolvedValue({ githubLogin: "alice" }); // NO en la allowlist
    const res = await PUT(put({ maintainers: ["alice", "carol"] }), params("acc"));
    expect(res.status).toBe(200);
    expect(reg().acc.maintainers).toEqual(["alice", "carol"]);
  });

  it("rechaza (400) un login que NO es collaborator del repo", async () => {
    const res = await PUT(put({ maintainers: ["alice", "mallory"] }), params("acc"));
    expect(res.status).toBe(400);
    expect(reg().acc.maintainers).toBeUndefined(); // no persiste
  });

  it("400 si la miniapp no tiene repo y la lista es no-vacía", async () => {
    delete (state.reg.acc as { repoUrl?: string }).repoUrl;
    state.collaborators = [];
    const res = await PUT(put({ maintainers: ["alice"] }), params("acc"));
    expect(res.status).toBe(400);
  });

  it("lista vacía siempre pasa (limpia maintainers)", async () => {
    (state.reg.acc as { maintainers?: string[] }).maintainers = ["alice"];
    const res = await PUT(put({ maintainers: [] }), params("acc"));
    expect(res.status).toBe(200);
    expect(reg().acc.maintainers).toBeUndefined(); // lista vacía borra el campo
  });

  it("un tercero no puede (403)", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    expect((await PUT(put({ maintainers: ["x"] }), params("acc"))).status).toBe(403);
  });

  it("404 miniapp inexistente", async () => {
    expect((await PUT(put({ maintainers: ["x"] }), params("ghost"))).status).toBe(404);
  });
});
