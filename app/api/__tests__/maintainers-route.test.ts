import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ reg: {} as Record<string, unknown> }));

vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({
    load: async () => state.reg,
    save: async (r: typeof state.reg) => {
      state.reg = r;
    },
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { PUT } from "@/app/api/miniapps/[id]/maintainers/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const reg = () => state.reg as Record<string, { maintainers?: string[] }>;
function put(body: unknown): Request {
  return new Request("http://x/api/miniapps/acc/maintainers", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.reg = { acc: { id: "acc", name: "Acc", owner: "o", versions: [] } };
  process.env.SCAFFOLD_ALLOWED_LOGINS = "DentVega";
  authMock.mockResolvedValue({ githubLogin: "DentVega" });
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("PUT /api/miniapps/:id/maintainers", () => {
  it("un platform-admin setea la lista", async () => {
    const res = await PUT(put({ maintainers: ["alice", "bob"] }), params("acc"));
    expect(res.status).toBe(200);
    expect(reg().acc.maintainers).toEqual(["alice", "bob"]);
  });

  it("un maintainer actual puede editar (auto-gobierno)", async () => {
    (state.reg.acc as { maintainers?: string[] }).maintainers = ["alice"];
    authMock.mockResolvedValue({ githubLogin: "alice" }); // NO en la allowlist
    const res = await PUT(put({ maintainers: ["alice", "carol"] }), params("acc"));
    expect(res.status).toBe(200);
    expect(reg().acc.maintainers).toEqual(["alice", "carol"]);
  });

  it("un tercero no puede (403)", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    expect((await PUT(put({ maintainers: ["x"] }), params("acc"))).status).toBe(403);
  });

  it("404 miniapp inexistente", async () => {
    expect((await PUT(put({ maintainers: ["x"] }), params("ghost"))).status).toBe(404);
  });
});
