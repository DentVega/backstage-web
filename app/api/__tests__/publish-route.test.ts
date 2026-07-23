import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Registry } from "@/lib/registry/types";

const state = vi.hoisted(() => ({ reg: {} as Registry }));
vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({
    load: async () => state.reg,
    save: async (r: Registry) => { state.reg = r; },
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { POST } from "@/app/api/miniapps/[id]/publish/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;

// A structurally valid manifest (per @dentvega/miniapp-contract's isManifest guard) —
// `{}` would fail contract validation (400) regardless of auth, masking the auth matrix
// this suite exists to test.
const manifest = {
  id: "acc",
  version: "1.0.0",
  entry: "./Entry",
  shared: [{ name: "react-native", requiredRange: "^0.76.0", singleton: true }],
  capabilities: ["accounts:read"],
};

function publishReq(headers?: Record<string, string>): Request {
  return new Request("http://x/api/miniapps/acc/publish", {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify({ version: "1.0.0", url: "http://h/acc", manifest }),
  });
}
const params = { params: Promise.resolve({ id: "acc" }) };

beforeEach(() => {
  state.reg = { acc: { id: "acc" as never, name: "A", owner: "o", versions: [] } };
  delete process.env.PUBLISH_TOKEN;
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
  authMock.mockResolvedValue(null);
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.SCAFFOLD_ALLOWED_LOGINS; });

describe("POST /api/miniapps/:id/publish — auth", () => {
  it("401 sin sesión ni token", async () => {
    const res = await POST(publishReq(), params);
    expect(res.status).toBe(401);
  });

  it("pasa con Bearer PUBLISH_TOKEN válido (flujo CI)", async () => {
    process.env.PUBLISH_TOKEN = "new-strong";
    const res = await POST(publishReq({ authorization: "Bearer new-strong" }), params);
    expect(res.status).toBe(201);
  });

  it("pasa con sesión allowlisted (flujo UI)", async () => {
    process.env.SCAFFOLD_ALLOWED_LOGINS = "DentVega";
    authMock.mockResolvedValue({ githubLogin: "DentVega" });
    const res = await POST(publishReq(), params);
    expect(res.status).toBe(201);
  });
});
