import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Registry } from "@/lib/registry/types";

const state = vi.hoisted(() => ({ reg: {} as Registry }));
vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({ load: async () => state.reg, save: async () => {} }),
}));

import { GET } from "@/app/api/manifests/route";

beforeEach(() => {
  state.reg = {
    a: {
      id: "a" as never, name: "A", owner: "o",
      versions: [
        { version: "0.1.0", url: "u", manifest: { id: "a", version: "0.1.0", shared: [], nativeModules: [] }, publishedAt: "t" },
        { version: "0.2.0", url: "u", manifest: { id: "a", version: "0.2.0", shared: [], nativeModules: ["react-native-svg"] }, publishedAt: "t" },
      ],
    },
    b: { id: "b" as never, name: "B", owner: "o", versions: [] }, // sin versiones → se omite
  } as never;
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/manifests", () => {
  it("devuelve el manifest de la última versión de cada miniapp con versiones", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = (await res.json()) as { manifests: { id: string; version: string; nativeModules?: string[] }[] };
    expect(body.manifests).toHaveLength(1); // 'b' omitida
    expect(body.manifests[0].version).toBe("0.2.0"); // la última
    expect(body.manifests[0].nativeModules).toEqual(["react-native-svg"]);
  });
});
