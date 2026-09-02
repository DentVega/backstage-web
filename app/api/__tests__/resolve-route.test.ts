import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ reg: {} as Record<string, unknown> }));
vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({
    load: async () => state.reg,
    getApp: async (id: string) => (state.reg as Record<string, unknown>)[id],
  }),
}));

import { GET } from "@/app/api/resolve/route";

const req = (qs: string) => new Request(`http://x/api/resolve?${qs}`);

beforeEach(() => {
  state.reg = {
    acc: {
      id: "acc",
      name: "Acc",
      owner: "o",
      versions: [
        {
          version: "0.1.0",
          url: "http://h/v010",
          manifest: { id: "acc", version: "0.1.0", entry: "./Entry", shared: [], capabilities: [], integrity: "sha256-AND" },
          publishedAt: "2026-01-01T00:00:00.000Z",
          iosUrl: "http://h/v010/ios",
          iosIntegrity: "sha256-IOS",
        },
      ],
    },
  };
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/resolve — platform", () => {
  it("platform=ios → iosUrl + integrity iOS", async () => {
    const res = await GET(req("id=acc&platform=ios"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.url).toBe("http://h/v010/ios");
    expect(body.manifest.integrity).toBe("sha256-IOS");
  });

  it("sin platform → Android intacto", async () => {
    const res = await GET(req("id=acc"));
    const body = await res.json();
    expect(body.url).toBe("http://h/v010");
    expect(body.manifest.integrity).toBe("sha256-AND");
  });
});
