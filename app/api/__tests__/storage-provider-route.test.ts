import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ saved: null as string | null }));

vi.mock("@/lib/storage", () => ({
  getStorageProviderState: async () => ({
    available: ["r2", "blob", "fs"],
    active: state.saved ?? "r2",
    source: state.saved ? "preference" : "env",
  }),
}));
vi.mock("@/lib/storage/preference", () => ({
  getStoragePreferenceStore: () => ({
    save: async (p: string) => {
      state.saved = p;
    },
  }),
}));
vi.mock("@/lib/storage/provider", () => ({
  availableProviders: () => ["r2", "blob", "fs"],
  isStorageProvider: (v: unknown) => v === "r2" || v === "blob" || v === "fs",
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/storage-provider/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "DentVega";

function putReq(body: unknown): Request {
  return new Request("http://x/api/storage-provider", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.saved = null;
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  authMock.mockResolvedValue({ githubLogin: ADMIN });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("GET /api/storage-provider", () => {
  it("devuelve available/active/source", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      available: ["r2", "blob", "fs"],
      active: "r2",
      source: "env",
    });
  });
});

describe("PUT /api/storage-provider", () => {
  it("200 y persiste (admin)", async () => {
    const res = await PUT(putReq({ provider: "blob" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ provider: "blob", active: "blob", source: "preference" });
    expect(state.saved).toBe("blob");
  });
  it("403 sin admin (no persiste)", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    const res = await PUT(putReq({ provider: "blob" }));
    expect(res.status).toBe(403);
    expect(state.saved).toBeNull();
  });
  it("400 provider inválido / no disponible", async () => {
    const res = await PUT(putReq({ provider: "s3" }));
    expect(res.status).toBe(400);
    expect(state.saved).toBeNull();
  });
});
