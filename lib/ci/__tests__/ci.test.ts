import { describe, expect, it, vi } from "vitest";
import { githubCiProvider } from "@/lib/ci/github";
import { mockCiProvider } from "@/lib/ci/mock";
import { withCache } from "@/lib/ci/cache";
import { repoFullNameFor } from "@/lib/ci/types";
import type { CiStatus } from "@/lib/ci/types";

const TOKEN = "gho_test";
const REPO = "acme/miniapp-payments";

/** Build a fake fetch that returns the given workflow_runs body as 200 OK. */
function okFetch(body: unknown) {
  return vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      new Response(JSON.stringify(body), { status: 200 }),
  );
}

describe("repoFullNameFor", () => {
  it("derives from a github repoUrl", () => {
    expect(
      repoFullNameFor({ owner: "acme", id: "payments", repoUrl: "https://github.com/acme/miniapp-payments" }),
    ).toBe("acme/miniapp-payments");
  });
  it("strips a trailing .git and slash", () => {
    expect(
      repoFullNameFor({ owner: "acme", id: "x", repoUrl: "https://github.com/acme/miniapp-x.git" }),
    ).toBe("acme/miniapp-x");
  });
  it("falls back to owner/miniapp-id without a repoUrl", () => {
    expect(repoFullNameFor({ owner: "acme", id: "cards" })).toBe("acme/miniapp-cards");
  });
});

describe("githubCiProvider mapping", () => {
  const cases: Array<[string, unknown, CiStatus]> = [
    ["success", { workflow_runs: [{ conclusion: "success" }] }, "success"],
    ["failure", { workflow_runs: [{ conclusion: "failure" }] }, "failure"],
    ["cancelled → failure", { workflow_runs: [{ conclusion: "cancelled" }] }, "failure"],
    ["running → in_progress", { workflow_runs: [{ status: "in_progress", conclusion: null }] }, "in_progress"],
    ["no runs → none", { workflow_runs: [] }, "none"],
  ];
  for (const [name, body, expected] of cases) {
    it(`maps ${name}`, async () => {
      const provider = githubCiProvider(okFetch(body));
      expect((await provider.getStatus(REPO, TOKEN)).status).toBe(expected);
    });
  }

  it("uses the newest (first) run", async () => {
    const provider = githubCiProvider(
      okFetch({ workflow_runs: [{ conclusion: "failure" }, { conclusion: "success" }] }),
    );
    expect((await provider.getStatus(REPO, TOKEN)).status).toBe("failure");
  });
});

describe("githubCiProvider resilience → unknown", () => {
  it("HTTP 500 → unknown", async () => {
    const provider = githubCiProvider(vi.fn(async () => new Response("", { status: 500 })));
    expect((await provider.getStatus(REPO, TOKEN)).status).toBe("unknown");
  });
  it("network throw → unknown", async () => {
    const provider = githubCiProvider(vi.fn(async () => { throw new Error("ECONNRESET"); }));
    expect((await provider.getStatus(REPO, TOKEN)).status).toBe("unknown");
  });
  it("malformed body → unknown", async () => {
    const provider = githubCiProvider(okFetch({ nope: true }));
    expect((await provider.getStatus(REPO, TOKEN)).status).toBe("unknown");
  });
  it("missing token → unknown (no fetch)", async () => {
    const fetchSpy = vi.fn();
    const provider = githubCiProvider(fetchSpy as unknown as typeof fetch);
    expect((await provider.getStatus(REPO, "")).status).toBe("unknown");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("sends the bearer token", async () => {
    const spy = okFetch({ workflow_runs: [{ conclusion: "success" }] });
    await githubCiProvider(spy).getStatus(REPO, TOKEN);
    const init = spy.mock.calls[0][1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(spy.mock.calls[0][0]).toContain(`/repos/${REPO}/actions/runs`);
  });
});

describe("withCache", () => {
  it("does not re-hit within the TTL", async () => {
    let t = 1000;
    const inner = mockCiProvider({ [REPO]: "success" });
    const spy = vi.spyOn(inner, "getStatus");
    const cached = withCache(inner, { ttlMs: 60_000, now: () => t });

    expect((await cached.getStatus(REPO, TOKEN)).status).toBe("success");
    t = 30_000; // still within TTL
    expect((await cached.getStatus(REPO, TOKEN)).status).toBe("success");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("re-hits after the TTL expires", async () => {
    let t = 1000;
    const inner = mockCiProvider({ [REPO]: "success" });
    const spy = vi.spyOn(inner, "getStatus");
    const cached = withCache(inner, { ttlMs: 60_000, now: () => t });

    await cached.getStatus(REPO, TOKEN);
    t = 1000 + 60_001; // past TTL
    await cached.getStatus(REPO, TOKEN);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("caches per repo independently", async () => {
    const inner = mockCiProvider({ "a/miniapp-1": "success", "b/miniapp-2": "failure" });
    const spy = vi.spyOn(inner, "getStatus");
    const cached = withCache(inner, { now: () => 0 });

    expect((await cached.getStatus("a/miniapp-1", TOKEN)).status).toBe("success");
    expect((await cached.getStatus("b/miniapp-2", TOKEN)).status).toBe("failure");
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

describe("mockCiProvider", () => {
  it("returns the mapped status or the fallback", async () => {
    const provider = mockCiProvider({ [REPO]: "in_progress" });
    expect((await provider.getStatus(REPO, TOKEN)).status).toBe("in_progress");
    expect((await provider.getStatus("other/repo", TOKEN)).status).toBe("unknown");
  });
});
