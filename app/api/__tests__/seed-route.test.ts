import { beforeEach, describe, expect, it, vi } from "vitest";
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

import { POST } from "@/app/api/seed/route";

function req(token?: string): Request {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("http://x/api/seed", { method: "POST", headers });
}

beforeEach(() => {
  state.reg = {};
  process.env.PUBLISH_TOKEN = "secret";
});

describe("POST /api/seed", () => {
  it("seeds the catalog with a valid token", async () => {
    const res = await POST(req("secret"));
    expect(res.status).toBe(200);
    expect(state.reg.account_dashboard).toBeDefined();
  });

  it("rejects without a token (401)", async () => {
    expect((await POST(req())).status).toBe(401);
    expect(state.reg.account_dashboard).toBeUndefined();
  });
});
