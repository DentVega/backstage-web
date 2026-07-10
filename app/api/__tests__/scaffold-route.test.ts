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

import { POST } from "@/app/api/scaffold/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "acme_admin";

function jsonReq(body: unknown): Request {
  return new Request("http://x/api/scaffold", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.reg = {};
  process.env.GITHUB_TOKEN = "test-token";
  process.env.MINIAPP_TEMPLATE_REPO = "org/miniapp-template";
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  authMock.mockResolvedValue({ githubLogin: ADMIN });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("POST /api/scaffold — authorization", () => {
  it("returns 403 for a login not on the allowlist (no repo created)", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const res = await POST(jsonReq({ id: "payments", name: "P", owner: "acme" }));
    expect(res.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(state.reg.payments).toBeUndefined();
  });

  it("returns 403 with no session", async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(jsonReq({ id: "payments", name: "P", owner: "acme" }));
    expect(res.status).toBe(403);
  });

  it("returns 403 when the allowlist is empty (fail-closed)", async () => {
    delete process.env.SCAFFOLD_ALLOWED_LOGINS;
    const res = await POST(jsonReq({ id: "payments", name: "P", owner: "acme" }));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/scaffold", () => {
  it("creates + registers a miniapp (201)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ html_url: "https://github.com/acme/miniapp-payments" }), {
          status: 201,
        }),
      ),
    );
    const res = await POST(jsonReq({ id: "payments", name: "Payments", owner: "acme" }));
    expect(res.status).toBe(201);
    const body = (await res.json()) as { repoUrl: string };
    expect(body.repoUrl).toBe("https://github.com/acme/miniapp-payments");
    expect(state.reg.payments).toBeDefined();
  });

  it("rejects missing fields (400)", async () => {
    const res = await POST(jsonReq({ id: "payments" }));
    expect(res.status).toBe(400);
  });

  it("rejects an invalid id (400)", async () => {
    const res = await POST(jsonReq({ id: "Bad Id", name: "X", owner: "o" }));
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate (409)", async () => {
    state.reg = { payments: { id: "payments" as never, name: "P", owner: "o", versions: [] } };
    const res = await POST(jsonReq({ id: "payments", name: "P", owner: "o" }));
    expect(res.status).toBe(409);
  });

  it("maps a git provider failure to 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 403 })),
    );
    const res = await POST(jsonReq({ id: "cards", name: "Cards", owner: "o" }));
    expect(res.status).toBe(502);
  });
});
