import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Registry } from "@/lib/registry/types";

const state = vi.hoisted(() => ({ reg: {} as Registry }));
const dispatchSpy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({ load: async () => state.reg, save: async () => {} }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/git/github", () => ({
  githubProvider: () => ({ createFromTemplate: vi.fn(), dispatchWorkflow: dispatchSpy }),
}));

import { POST } from "@/app/api/miniapps/[id]/sync-template/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "dentvega";

function req(): Request {
  return new Request("http://x/api/miniapps/acc/sync-template", { method: "POST" });
}
const params = { params: Promise.resolve({ id: "acc" }) };

beforeEach(() => {
  process.env.GITHUB_TOKEN = "test-token";
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  authMock.mockResolvedValue({ githubLogin: ADMIN });
  dispatchSpy.mockReset().mockResolvedValue(undefined);
  state.reg = {
    acc: {
      id: "acc" as never,
      name: "Acc",
      owner: "DentVega",
      versions: [],
      repoUrl: "https://github.com/DentVega/miniapp-acc",
    },
  } as unknown as Registry;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("POST /api/miniapps/:id/sync-template", () => {
  it("dispatches template-sync.yml for an allowlisted user (202)", async () => {
    const res = await POST(req(), params);
    expect(res.status).toBe(202);
    expect(dispatchSpy).toHaveBeenCalledWith({
      owner: "DentVega",
      repo: "miniapp-acc",
      workflow: "template-sync.yml",
      ref: "main",
    });
  });

  it("rejects a login not on the allowlist (403, no dispatch)", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    expect((await POST(req(), params)).status).toBe(403);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown miniapp", async () => {
    state.reg = {} as Registry;
    expect((await POST(req(), params)).status).toBe(404);
  });

  it("returns 400 when the miniapp has no repo URL", async () => {
    (state.reg.acc as { repoUrl?: string }).repoUrl = "not a url";
    expect((await POST(req(), params)).status).toBe(400);
  });
});
