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

import { POST as registerPOST } from "@/app/api/miniapps/route";
import { POST as publishPOST } from "@/app/api/miniapps/[id]/publish/route";
import { GET as resolveGET } from "@/app/api/resolve/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;

const manifest = {
  id: "acc",
  version: "1.0.0",
  entry: "./Entry",
  shared: [{ name: "react-native", requiredRange: "^0.76.0", singleton: true }],
  capabilities: ["accounts:read"],
};

function jsonReq(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.reg = {};
  process.env.SCAFFOLD_ALLOWED_LOGINS = "DentVega";
  authMock.mockResolvedValue({ githubLogin: "DentVega" });
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("POST /api/miniapps", () => {
  it("registers a miniapp (201)", async () => {
    const res = await registerPOST(
      jsonReq("http://x/api/miniapps", { id: "acc", name: "A", owner: "o" }),
    );
    expect(res.status).toBe(201);
    expect(state.reg.acc).toBeDefined();
  });

  it("rejects a duplicate (409)", async () => {
    await registerPOST(jsonReq("http://x/api/miniapps", { id: "acc", name: "A", owner: "o" }));
    const res = await registerPOST(
      jsonReq("http://x/api/miniapps", { id: "acc", name: "A", owner: "o" }),
    );
    expect(res.status).toBe(409);
  });

  it("rejects a missing field (400)", async () => {
    const res = await registerPOST(jsonReq("http://x/api/miniapps", { id: "acc" }));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/miniapps/:id/publish", () => {
  it("publishes a valid version (201)", async () => {
    await registerPOST(jsonReq("http://x/api/miniapps", { id: "acc", name: "A", owner: "o" }));
    const res = await publishPOST(
      jsonReq("http://x/api/miniapps/acc/publish", {
        version: "1.0.0",
        url: "http://h/acc",
        manifest,
      }),
      { params: Promise.resolve({ id: "acc" }) },
    );
    expect(res.status).toBe(201);
  });

  it("rejects an invalid manifest (400)", async () => {
    await registerPOST(jsonReq("http://x/api/miniapps", { id: "acc", name: "A", owner: "o" }));
    const res = await publishPOST(
      jsonReq("http://x/api/miniapps/acc/publish", {
        version: "1.0.0",
        url: "http://h/acc",
        manifest: { nope: true },
      }),
      { params: Promise.resolve({ id: "acc" }) },
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/resolve", () => {
  async function seed(): Promise<void> {
    await registerPOST(jsonReq("http://x/api/miniapps", { id: "acc", name: "A", owner: "o" }));
    await publishPOST(
      jsonReq("http://x/api/miniapps/acc/publish", { version: "1.0.0", url: "http://h/acc", manifest }),
      { params: Promise.resolve({ id: "acc" }) },
    );
  }

  it("resolves a published miniapp (200) with the contract shape", async () => {
    await seed();
    const res = await resolveGET(new Request("http://x/api/resolve?id=acc"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; version: string; url: string };
    expect(body).toMatchObject({ id: "acc", version: "1.0.0", url: "http://h/acc" });
  });

  it("404 for an unknown id", async () => {
    const res = await resolveGET(new Request("http://x/api/resolve?id=ghost"));
    expect(res.status).toBe(404);
  });

  it("400 when id is missing", async () => {
    const res = await resolveGET(new Request("http://x/api/resolve"));
    expect(res.status).toBe(400);
  });
});
