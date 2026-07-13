// @vitest-environment node
// (jsdom's Blob mangles binary multipart; node env uses undici, binary-safe.)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { zipSync } from "fflate";
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

vi.mock("@/lib/storage", async () => {
  const { mockStorage } = await import("@/lib/storage/mock");
  return { getStorage: () => mockStorage() };
});

vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { POST } from "@/app/api/miniapps/[id]/upload/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;

const manifest = {
  id: "account_dashboard",
  version: "0.2.0",
  entry: "./Entry",
  shared: [{ name: "react-native", requiredRange: "^0.76.0", singleton: true }],
  capabilities: ["accounts:read"],
};

function buildZip(): Uint8Array {
  return zipSync({
    "account_dashboard.container.js.bundle": new Uint8Array([1, 2, 3]),
    "vendors-x.chunk.bundle": new Uint8Array([4, 5]),
  });
}

function uploadReq(opts: {
  token?: string;
  version?: string;
  withFile?: boolean;
  manifest?: boolean;
  capabilities?: string;
}): Request {
  const form = new FormData();
  if (opts.withFile !== false) {
    form.set("file", new Blob([buildZip() as unknown as BlobPart]), "build.zip");
  }
  form.set("version", opts.version ?? "0.2.0");
  if (opts.manifest !== false) {
    form.set("manifest", JSON.stringify({ ...manifest, version: opts.version ?? "0.2.0" }));
  }
  if (opts.capabilities !== undefined) form.set("capabilities", opts.capabilities);
  const headers: Record<string, string> = {};
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  return new Request("http://x/api/miniapps/account_dashboard/upload", {
    method: "POST",
    headers,
    body: form,
  });
}

const params = { params: Promise.resolve({ id: "account_dashboard" }) };

beforeEach(() => {
  process.env.PUBLISH_TOKEN = "secret";
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
  authMock.mockResolvedValue(null); // default: no session → CI/token path
  // The miniapp must be registered before publishing a version.
  state.reg = {
    account_dashboard: {
      id: "account_dashboard" as never,
      name: "Account Dashboard",
      owner: "payments",
      versions: [],
    },
  };
});

describe("POST /api/miniapps/:id/upload", () => {
  it("stores the chunks and publishes the version (201)", async () => {
    const res = await POST(uploadReq({ token: "secret" }), params);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { url: string };
    expect(body.url).toBe(
      "https://mock.blob/account_dashboard/0.2.0/account_dashboard.container.js.bundle",
    );
    expect(state.reg.account_dashboard.versions).toHaveLength(1);
  });

  it("rejects without a valid token (401)", async () => {
    expect((await POST(uploadReq({ token: "wrong" }), params)).status).toBe(401);
    expect((await POST(uploadReq({}), params)).status).toBe(401);
  });

  it("rejects a missing file (400)", async () => {
    const res = await POST(uploadReq({ token: "secret", withFile: false }), params);
    expect(res.status).toBe(400);
  });

  it("rejects a duplicate version (409)", async () => {
    await POST(uploadReq({ token: "secret" }), params);
    const res = await POST(uploadReq({ token: "secret" }), params);
    expect(res.status).toBe(409);
  });

  it("publishes via an allowlisted session, no token, default manifest (UI flow)", async () => {
    process.env.SCAFFOLD_ALLOWED_LOGINS = "dentvega";
    authMock.mockResolvedValue({ githubLogin: "DentVega" }); // case-insensitive match
    const res = await POST(
      uploadReq({ version: "0.3.0", manifest: false, capabilities: "accounts:read" }),
      params,
    );
    expect(res.status).toBe(201);
    const published = state.reg.account_dashboard.versions.find((v) => v.version === "0.3.0");
    expect(published).toBeDefined();
    expect(published?.manifest.entry).toBe("./Entry");
    expect(published?.manifest.capabilities).toContain("accounts:read");
  });

  it("rejects an unauthorized session and no token (401)", async () => {
    process.env.SCAFFOLD_ALLOWED_LOGINS = "someone_else";
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    const res = await POST(uploadReq({ manifest: false }), params);
    expect(res.status).toBe(401);
  });
});
