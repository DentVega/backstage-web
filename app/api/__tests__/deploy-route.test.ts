import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Registry } from "@/lib/registry/types";

const state = vi.hoisted(() => ({ reg: {} as Registry }));
const dispatchSpy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({
    load: async () => state.reg,
    save: async () => {},
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/git/github", () => ({
  githubProvider: () => ({ createFromTemplate: vi.fn(), dispatchWorkflow: dispatchSpy }),
}));

import { POST, parseRepo } from "@/app/api/miniapps/[id]/deploy/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "dentvega";

function req(): Request {
  return new Request("http://x/api/miniapps/acc/deploy", { method: "POST" });
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

describe("parseRepo", () => {
  it("parses https and .git URLs", () => {
    expect(parseRepo("https://github.com/DentVega/miniapp-acc")).toEqual({
      owner: "DentVega",
      repo: "miniapp-acc",
    });
    expect(parseRepo("https://github.com/DentVega/miniapp-acc.git")).toEqual({
      owner: "DentVega",
      repo: "miniapp-acc",
    });
  });
  it("returns null for missing/invalid URLs", () => {
    expect(parseRepo(undefined)).toBeNull();
    expect(parseRepo("not a url")).toBeNull();
  });
});

describe("POST /api/miniapps/:id/deploy", () => {
  it("dispatches ci.yml for an allowlisted user (202)", async () => {
    const res = await POST(req(), params);
    expect(res.status).toBe(202);
    expect(dispatchSpy).toHaveBeenCalledWith({
      owner: "DentVega",
      repo: "miniapp-acc",
      workflow: "ci.yml",
      ref: "main",
    });
  });

  it("rejects a login not on the allowlist (403, no dispatch)", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    const res = await POST(req(), params);
    expect(res.status).toBe(403);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown miniapp", async () => {
    state.reg = {};
    expect((await POST(req(), params)).status).toBe(404);
  });

  it("returns 400 when the miniapp has no repo URL", async () => {
    (state.reg.acc as { repoUrl?: string }).repoUrl = undefined;
    expect((await POST(req(), params)).status).toBe(400);
  });
});
