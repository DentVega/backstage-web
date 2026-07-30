import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HostContract } from "@/lib/host-contract/types";

const state = vi.hoisted(() => ({ contract: null as HostContract | null }));
vi.mock("@/lib/host-contract/store", () => ({
  getHostContractStore: () => ({
    load: async () => state.contract,
    save: async (c: HostContract) => { state.contract = c; },
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/host-contract/route";

const VALID: HostContract = {
  contractVersion: "1.0.0",
  reactNative: "0.76.6",
  shared: { react: "18.3.1", "react-native": "0.76.6" },
  nativeModules: [],
};

function putReq(body: unknown, auth?: string): Request {
  return new Request("http://x/api/host-contract", {
    method: "PUT",
    headers: { "content-type": "application/json", ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.contract = null;
  process.env.HOST_CONTRACT_TOKEN = "contract-secret";
});
afterEach(() => { delete process.env.HOST_CONTRACT_TOKEN; vi.restoreAllMocks(); });

describe("GET /api/host-contract", () => {
  it("404 cuando no hay contract", async () => {
    expect((await GET()).status).toBe(404);
  });
  it("200 con el contract guardado", async () => {
    state.contract = VALID;
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(VALID);
  });
});

describe("PUT /api/host-contract", () => {
  it("401 sin token", async () => {
    expect((await PUT(putReq(VALID))).status).toBe(401);
  });
  it("401 con token equivocado", async () => {
    expect((await PUT(putReq(VALID, "Bearer nope"))).status).toBe(401);
  });
  it("400 con body inválido", async () => {
    const res = await PUT(putReq({ contractVersion: "1.0.0" }, "Bearer contract-secret"));
    expect(res.status).toBe(400);
    expect(state.contract).toBeNull();
  });
  it("200 y persiste con token + body válido", async () => {
    const res = await PUT(putReq(VALID, "Bearer contract-secret"));
    expect(res.status).toBe(200);
    expect(state.contract).toEqual(VALID);
  });
});
