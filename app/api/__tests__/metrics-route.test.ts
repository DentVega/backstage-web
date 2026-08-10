import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ reg: {} as Record<string, unknown> }));

vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({ load: async () => state.reg, save: async () => {} }),
}));

import { POST, GET } from "@/app/api/metrics/route";

function post(body: unknown): Request {
  return new Request("http://x/api/metrics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  state.reg = { a: { id: "a", name: "A", owner: "o", versions: [] } };
});

describe("POST /api/metrics", () => {
  it("cuenta eventos de ids del registry y se reflejan en GET", async () => {
    const res = await POST(
      post({ events: [{ type: "mount", id: "a" }, { type: "fallback", id: "a", reason: "skew" }] }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { tracked: number }).tracked).toBe(2);
    const snap = (await (await GET()).json()) as { mounts: Record<string, number>; fallbacks: Record<string, number> };
    expect(snap.mounts.a).toBeGreaterThanOrEqual(1);
    expect(snap.fallbacks.skew).toBeGreaterThanOrEqual(1);
  });

  it("ignora eventos con id fuera del registry (anti-poisoning)", async () => {
    const res = await POST(post({ events: [{ type: "mount", id: "ghost" }] }));
    expect(((await res.json()) as { tracked: number }).tracked).toBe(0);
  });

  it("acota el batch a 50", async () => {
    const events = Array.from({ length: 60 }, () => ({ type: "mount", id: "a" }));
    const res = await POST(post({ events }));
    expect(((await res.json()) as { tracked: number }).tracked).toBe(50);
  });

  it("siempre 200, aun con body inválido (best-effort)", async () => {
    expect((await POST(post({ nope: true }))).status).toBe(200);
    const bad = new Request("http://x/api/metrics", { method: "POST", body: "not json" });
    expect((await POST(bad)).status).toBe(200);
  });
});
