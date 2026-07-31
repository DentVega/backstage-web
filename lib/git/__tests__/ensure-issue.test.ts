import { afterEach, describe, expect, it, vi } from "vitest";
import { githubProvider } from "@/lib/git/github";

afterEach(() => vi.restoreAllMocks());

const INPUT = { owner: "DentVega", repo: "backstagereactnative", title: "cap: x", body: "b", labels: ["capability-request"] };

describe("githubProvider.ensureIssue", () => {
  it("crea el issue cuando no hay uno abierto con ese título", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] }) // list open issues
      .mockResolvedValueOnce({ ok: true, json: async () => ({ html_url: "https://gh/issues/1" }) }); // create
    vi.stubGlobal("fetch", fetchMock);
    const r = await githubProvider("tok").ensureIssue(INPUT);
    expect(r).toEqual({ created: true, url: "https://gh/issues/1" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][1].method).toBe("POST");
  });

  it("NO crea (dedup) si ya hay un issue abierto con ese título", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => [{ title: "cap: x", html_url: "https://gh/issues/9" }],
    });
    vi.stubGlobal("fetch", fetchMock);
    const r = await githubProvider("tok").ensureIssue(INPUT);
    expect(r).toEqual({ created: false, url: "https://gh/issues/9" });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no POST
  });

  it("ignora PRs al deduplicar (issues endpoint también devuelve PRs)", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ title: "cap: x", html_url: "https://gh/pull/3", pull_request: {} }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ html_url: "https://gh/issues/2" }) });
    vi.stubGlobal("fetch", fetchMock);
    const r = await githubProvider("tok").ensureIssue(INPUT);
    expect(r.created).toBe(true); // el PR con mismo título NO cuenta como dedup
  });
});
