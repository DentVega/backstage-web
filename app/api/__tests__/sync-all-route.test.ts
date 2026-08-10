import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  reg: {} as Record<string, { id: string; name: string; owner: string; versions: []; repoUrl?: string }>,
  dispatched: [] as { owner: string; repo: string }[],
  failRepo: null as string | null,
}));

vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({ load: async () => state.reg, save: async () => {} }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/git/github", () => ({
  githubProvider: () => ({
    dispatchWorkflow: async (i: { owner: string; repo: string }) => {
      if (state.failRepo && i.repo === state.failRepo) throw new Error("dispatch failed");
      state.dispatched.push(i);
    },
  }),
}));

import { POST } from "@/app/api/admin/sync-all/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "DentVega";

beforeEach(() => {
  state.reg = {
    a: { id: "a", name: "A", owner: "o", versions: [], repoUrl: "https://github.com/DentVega/miniapp-a" },
    b: { id: "b", name: "B", owner: "o", versions: [], repoUrl: "https://github.com/DentVega/miniapp-b" },
    c: { id: "c", name: "C", owner: "o", versions: [] }, // sin repoUrl
  };
  state.dispatched = [];
  state.failRepo = null;
  process.env.GITHUB_TOKEN = "t";
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  authMock.mockResolvedValue({ githubLogin: ADMIN });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("POST /api/admin/sync-all", () => {
  it("dispara en todos los repos con repoUrl; sin repoUrl → failed", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dispatched: string[]; failed: { id: string }[] };
    expect(body.dispatched.sort()).toEqual(["a", "b"]);
    expect(body.failed.map((f) => f.id)).toEqual(["c"]);
    expect(state.dispatched.map((d) => d.repo).sort()).toEqual(["miniapp-a", "miniapp-b"]);
  });

  it("un repo que falla va a failed; el resto se dispara", async () => {
    state.failRepo = "miniapp-b";
    const body = (await (await POST()).json()) as { dispatched: string[]; failed: { id: string }[] };
    expect(body.dispatched).toEqual(["a"]);
    expect(body.failed.map((f) => f.id)).toEqual(["b", "c"]);
  });

  it("403 sin admin (no dispara nada)", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    const res = await POST();
    expect(res.status).toBe(403);
    expect(state.dispatched).toHaveLength(0);
  });
});
