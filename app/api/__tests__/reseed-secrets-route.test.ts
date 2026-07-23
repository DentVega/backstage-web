import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Registry } from "@/lib/registry/types";

const state = vi.hoisted(() => ({
  reg: {} as Registry,
  setSecretCalls: [] as { owner: string; repo: string; name: string }[],
  failRepo: null as string | null,
}));

vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({ load: async () => state.reg, save: async () => {} }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/git/github", () => ({
  githubProvider: () => ({
    createFromTemplate: async () => ({ repoUrl: "x" }),
    dispatchWorkflow: async () => {},
    enableActionsPullRequests: async () => {},
    setSecret: async (i: { owner: string; repo: string; name: string }) => {
      state.setSecretCalls.push(i);
      if (state.failRepo && i.repo === state.failRepo) throw new Error("seal failed");
    },
  }),
}));

import { POST } from "@/app/api/admin/reseed-secrets/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "DentVega";

function post(): Request {
  return new Request("http://x/api/admin/reseed-secrets", { method: "POST" });
}

beforeEach(() => {
  state.reg = {
    a: { id: "a" as never, name: "A", owner: "acme", versions: [] },
    b: { id: "b" as never, name: "B", owner: "acme", versions: [] },
  };
  state.setSecretCalls = [];
  state.failRepo = null;
  process.env.GITHUB_TOKEN = "test-token";
  process.env.BACKSTAGE_URL = "https://backstage.example";
  process.env.PUBLISH_TOKEN = "new-strong";
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  authMock.mockResolvedValue({ githubLogin: ADMIN });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("POST /api/admin/reseed-secrets — authorization", () => {
  it("403 sin sesión allowlisted (no toca ningún repo)", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    const res = await POST(post());
    expect(res.status).toBe(403);
    expect(state.setSecretCalls).toHaveLength(0);
  });

  it("403 sin sesión", async () => {
    authMock.mockResolvedValue(null);
    expect((await POST(post())).status).toBe(403);
  });
});

describe("POST /api/admin/reseed-secrets", () => {
  it("resiembra PUBLISH_TOKEN + BACKSTAGE_URL en todos los repos del registry", async () => {
    const res = await POST(post());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reseeded: string[]; failed: unknown[] };
    expect(body.reseeded.sort()).toEqual(["a", "b"]);
    expect(body.failed).toEqual([]);
    // 2 repos × 2 secrets
    expect(state.setSecretCalls.filter((c) => c.name === "PUBLISH_TOKEN")).toHaveLength(2);
    expect(state.setSecretCalls.some((c) => c.repo === "miniapp-a")).toBe(true);
  });

  it("un repo que falla va a failed; el resto a reseeded", async () => {
    state.failRepo = "miniapp-b";
    const res = await POST(post());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reseeded: string[]; failed: { id: string }[] };
    expect(body.reseeded).toEqual(["a"]);
    expect(body.failed.map((f) => f.id)).toEqual(["b"]);
  });
});
