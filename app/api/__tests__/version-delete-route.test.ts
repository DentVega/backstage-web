import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  reg: {} as Record<string, { id: string; name: string; owner: string; versions: unknown[] }>,
  deletes: [] as string[],
}));

vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({
    load: async () => state.reg,
    getAll: async () => state.reg,
    getApp: async (id: string) => (state.reg as Record<string, unknown>)[id],
    mutateApp: async (id: string, fn: (r: unknown) => unknown) => {
      const m = state.reg as Record<string, unknown>;
      const next = fn(m[id]);
      if (next === null) delete m[id];
      else m[id] = next;
      return next;
    },
    save: async (r: typeof state.reg) => {
      state.reg = r;
    },
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/storage", () => ({
  getStorage: async () => ({
    putMany: async () => ({ baseUrl: "" }),
    deletePrefix: async (p: string) => {
      state.deletes.push(p);
    },
  }),
}));

import { DELETE } from "@/app/api/miniapps/[id]/versions/[version]/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const mkVer = (v: string) => ({
  version: v,
  url: `u/${v}`,
  publishedAt: "2026-08-10T10:00:00.000Z",
  manifest: { id: "cards_wallet", version: v, entry: "./Entry", shared: [], capabilities: [] },
});
const params = (id: string, version: string) => ({ params: Promise.resolve({ id, version }) });
const reg = () => state.reg as Record<string, { versions: { version: string }[] }>;

beforeEach(() => {
  state.reg = {
    cards_wallet: { id: "cards_wallet", name: "Cards", owner: "o", versions: [mkVer("0.1.0"), mkVer("0.2.0"), mkVer("0.3.0")] },
  };
  state.deletes = [];
  process.env.SCAFFOLD_ALLOWED_LOGINS = "DentVega";
  authMock.mockResolvedValue({ githubLogin: "DentVega" });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("DELETE /api/miniapps/:id/versions/:version", () => {
  it("borra una versión no-servida: chunk + registro", async () => {
    const res = await DELETE(new Request("http://x"), params("cards_wallet", "0.1.0"));
    expect(res.status).toBe(200);
    expect(state.deletes).toEqual(["cards_wallet/0.1.0"]);
    expect(reg().cards_wallet.versions.map((v) => v.version)).toEqual(["0.2.0", "0.3.0"]);
  });

  it("400 al intentar borrar la servida (latest) — no toca chunk ni registro", async () => {
    const res = await DELETE(new Request("http://x"), params("cards_wallet", "0.3.0"));
    expect(res.status).toBe(400);
    expect(state.deletes).toEqual([]);
    expect(reg().cards_wallet.versions).toHaveLength(3);
  });

  it("403 sin admin", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    const res = await DELETE(new Request("http://x"), params("cards_wallet", "0.1.0"));
    expect(res.status).toBe(403);
    expect(state.deletes).toEqual([]);
  });

  it("404 miniapp inexistente; 400 versión inexistente", async () => {
    expect((await DELETE(new Request("http://x"), params("ghost", "0.1.0"))).status).toBe(404);
    expect((await DELETE(new Request("http://x"), params("cards_wallet", "9.9.9"))).status).toBe(400);
  });
});
