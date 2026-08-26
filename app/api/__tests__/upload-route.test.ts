// @vitest-environment node
// (jsdom's Blob mangles binary multipart; node env uses undici, binary-safe.)
import { beforeEach, describe, expect, it, vi } from "vitest";
import { zipSync } from "fflate";
import type { Registry } from "@/lib/registry/types";
import type { HostContract } from "@/lib/host-contract/types";
import type { EnsureIssueInput } from "@/lib/git/types";

const state = vi.hoisted(() => ({ reg: {} as Registry, contract: null as HostContract | null }));
const ensureIssueSpy = vi.hoisted(() =>
  vi.fn(async (_input: EnsureIssueInput) => ({ created: true, url: "https://github.com/o/r/issues/1" })),
);

vi.mock("@/lib/git/github", () => ({
  githubProvider: () => ({
    createFromTemplate: vi.fn(),
    dispatchWorkflow: vi.fn(),
    enableActionsPullRequests: vi.fn(),
    setSecret: vi.fn(),
    ensureIssue: ensureIssueSpy,
  }),
}));

vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({
    load: async () => state.reg,
    save: async (r: Registry) => {
      state.reg = r;
    },
  }),
}));

vi.mock("@/lib/host-contract/store", () => ({
  getHostContractStore: () => ({
    load: async () => state.contract,
    save: async () => {},
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
  delete process.env.COMPAT_ENFORCE;
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
  state.contract = null; // no host contract published by default
  ensureIssueSpy.mockClear();
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

  it("platform=ios adjunta el chunk iOS a la versión Android existente (misma versión)", async () => {
    // 1) publicar Android @0.2.0 (crea la versión).
    await POST(uploadReq({ token: "secret" }), params);
    // 2) publicar iOS @0.2.0 (mismo version, platform=ios) → se adjunta.
    const form = new FormData();
    form.set("file", new Blob([buildZip() as unknown as BlobPart]), "build.zip");
    form.set("version", "0.2.0");
    form.set("platform", "ios");
    form.set("manifest", JSON.stringify({ ...manifest, version: "0.2.0" }));
    const req = new Request("http://x/api/miniapps/account_dashboard/upload", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: form,
    });

    const res = await POST(req, params);

    expect(res.status).toBe(201);
    expect((await res.json()).platform).toBe("ios");
    expect(state.reg.account_dashboard.versions).toHaveLength(1); // NO crea versión nueva
    const v = state.reg.account_dashboard.versions.find((x) => x.version === "0.2.0")!;
    expect(v.iosUrl).toBe(
      "https://mock.blob/account_dashboard/0.2.0/ios/account_dashboard.container.js.bundle",
    );
    expect(v.iosIntegrity).toMatch(/^sha256-[0-9a-f]{64}$/);
    // Android intacto (path SIN /ios/, integrity en el manifest canónico).
    expect(v.url).toBe(
      "https://mock.blob/account_dashboard/0.2.0/account_dashboard.container.js.bundle",
    );
    expect(v.manifest.integrity).toMatch(/^sha256-[0-9a-f]{64}$/);
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
    // Integrity computed from the actual container bytes.
    expect(published?.manifest.integrity).toMatch(/^sha256-[0-9a-f]{64}$/);
  });

  it("rejects an unauthorized session and no token (401)", async () => {
    process.env.SCAFFOLD_ALLOWED_LOGINS = "someone_else";
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    const res = await POST(uploadReq({ manifest: false }), params);
    expect(res.status).toBe(401);
  });

  it("modo warn: loguea incompatibilidad pero NO rechaza (201)", async () => {
    state.contract = {
      contractVersion: "1.0.0",
      reactNative: "0.76.6",
      shared: { react: "18.3.1", "react-native": "0.76.6" },
      nativeModules: [],
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const incompatibleManifest = {
      ...manifest,
      shared: [{ name: "react-native", requiredRange: "^0.99.0", singleton: true }],
    };
    const form = new FormData();
    form.set("file", new Blob([buildZip() as unknown as BlobPart]), "build.zip");
    form.set("version", "0.2.0");
    form.set("manifest", JSON.stringify(incompatibleManifest));
    const req = new Request("http://x/api/miniapps/account_dashboard/upload", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: form,
    });

    const res = await POST(req, params);

    expect(res.status).toBe(201);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("enforce: rechaza la incompatibilidad con 422 y NO publica (COMPAT_ENFORCE=1)", async () => {
    process.env.COMPAT_ENFORCE = "1";
    state.contract = {
      contractVersion: "1.0.0",
      reactNative: "0.76.6",
      shared: { react: "18.3.1", "react-native": "0.76.6" },
      nativeModules: [],
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const incompatibleManifest = {
      ...manifest,
      shared: [{ name: "react-native", requiredRange: "^0.99.0", singleton: true }],
    };
    const form = new FormData();
    form.set("file", new Blob([buildZip() as unknown as BlobPart]), "build.zip");
    form.set("version", "0.2.0");
    form.set("manifest", JSON.stringify(incompatibleManifest));
    const req = new Request("http://x/api/miniapps/account_dashboard/upload", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: form,
    });

    const res = await POST(req, params);

    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("COMPAT_INCOMPATIBLE");
    expect(state.reg.account_dashboard.versions).toHaveLength(0); // no se publicó nada
    warn.mockRestore();
  });

  it("enforce: un manifest compatible se publica igual (201)", async () => {
    process.env.COMPAT_ENFORCE = "1";
    state.contract = {
      contractVersion: "1.0.0",
      reactNative: "0.76.6",
      shared: { react: "18.3.1", "react-native": "0.76.6" },
      nativeModules: [],
    };
    // manifest default: react-native ^0.76.0 → satisfecho por host 0.76.6.
    const res = await POST(uploadReq({ token: "secret" }), params);
    expect(res.status).toBe(201);
    expect(state.reg.account_dashboard.versions).toHaveLength(1);
  });

  it("modo warn: loguea un módulo nativo faltante pero NO rechaza (201)", async () => {
    state.contract = {
      contractVersion: "1.0.0",
      reactNative: "0.76.6",
      shared: { react: "18.3.1", "react-native": "0.76.6" },
      nativeModules: ["react-native-screens"],
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nativeManifest = {
      ...manifest,
      shared: [{ name: "react-native", requiredRange: "^0.76.0", singleton: true }],
      nativeModules: ["react-native-svg"], // no está en el host → warn (no rechaza)
    };
    const form = new FormData();
    form.set("file", new Blob([buildZip() as unknown as BlobPart]), "build.zip");
    form.set("version", "0.2.0"); // debe coincidir con nativeManifest.version (publishVersion lo exige)
    form.set("manifest", JSON.stringify(nativeManifest));
    const req = new Request("http://x/api/miniapps/account_dashboard/upload", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: form,
    });

    const res = await POST(req, params);

    expect(res.status).toBe(201);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("react-native-svg (native module not in host)"),
    );
    warn.mockRestore();
  });

  it("modo warn: un nativo faltante dispara un capability request (best-effort) y sigue en 201", async () => {
    process.env.GITHUB_TOKEN = "gh-token";
    state.contract = {
      contractVersion: "1.0.0",
      reactNative: "0.76.6",
      shared: { react: "18.3.1", "react-native": "0.76.6" },
      nativeModules: ["react-native-screens"],
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const nativeManifest = {
      ...manifest,
      shared: [{ name: "react-native", requiredRange: "^0.76.0", singleton: true }],
      nativeModules: ["react-native-svg"], // no está en el host → dispara capability request
    };
    const form = new FormData();
    form.set("file", new Blob([buildZip() as unknown as BlobPart]), "build.zip");
    form.set("version", "0.2.0");
    form.set("manifest", JSON.stringify(nativeManifest));
    const req = new Request("http://x/api/miniapps/account_dashboard/upload", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: form,
    });

    const res = await POST(req, params);

    expect(res.status).toBe(201);
    expect(ensureIssueSpy).toHaveBeenCalledTimes(1);
    const call = ensureIssueSpy.mock.calls[0][0];
    expect(call.title).toContain("react-native-svg");
    expect(call.body).toContain("account_dashboard");
    warn.mockRestore();
    delete process.env.GITHUB_TOKEN;
  });
});

describe("POST /api/miniapps/:id/upload — firma", () => {
  function signedReq(signature: string, version = "0.2.0"): Request {
    const form = new FormData();
    form.set("file", new Blob([buildZip() as unknown as BlobPart]), "build.zip");
    form.set("version", version);
    form.set("manifest", JSON.stringify({ ...manifest, version }));
    form.set("signature", signature);
    return new Request("http://x/api/miniapps/account_dashboard/upload", {
      method: "POST",
      headers: { authorization: "Bearer secret" },
      body: form,
    });
  }

  it("guarda la signature del form en la versión publicada", async () => {
    const res = await POST(signedReq("sig-android-b64url"), params);
    expect(res.status).toBe(201);
    expect(state.reg.account_dashboard.versions[0].signature).toBe("sig-android-b64url");
  });

  it("400 si hay publicKey registrada y la firma no valida (no persiste)", async () => {
    const { generateKeypair } = await import("@/lib/crypto/ed25519");
    (state.reg.account_dashboard as { publicKey?: string }).publicKey =
      generateKeypair().publicKey;
    const res = await POST(signedReq("firma-que-no-corresponde"), params);
    expect(res.status).toBe(400);
    expect(state.reg.account_dashboard.versions).toHaveLength(0);
  });
});
