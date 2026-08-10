import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  reg: {} as Record<string, unknown>,
  collaborators: [] as string[],
}));

vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({ load: async () => state.reg }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/git/collaborators", () => ({
  repoCollaboratorLogins: async () => state.collaborators,
}));

import { GET } from "@/app/api/miniapps/[id]/collaborators/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://x/api/miniapps/acc/collaborators");

beforeEach(() => {
  state.reg = {
    acc: { id: "acc", name: "Acc", owner: "o", repoUrl: "https://github.com/o/acc", versions: [] },
  };
  state.collaborators = ["dentvega", "alice"];
  process.env.SCAFFOLD_ALLOWED_LOGINS = "DentVega";
  authMock.mockResolvedValue({ githubLogin: "DentVega" });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("GET /api/miniapps/:id/collaborators", () => {
  it("un admin obtiene los collaborators del repo", async () => {
    const res = await GET(req(), params("acc"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ collaborators: ["dentvega", "alice"] });
  });

  it("un maintainer actual también puede", async () => {
    (state.reg.acc as { maintainers?: string[] }).maintainers = ["alice"];
    authMock.mockResolvedValue({ githubLogin: "alice" });
    expect((await GET(req(), params("acc"))).status).toBe(200);
  });

  it("un tercero no puede (403)", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    expect((await GET(req(), params("acc"))).status).toBe(403);
  });

  it("404 miniapp inexistente", async () => {
    expect((await GET(req(), params("ghost"))).status).toBe(404);
  });
});
