import { afterEach, describe, expect, it, vi } from "vitest";
import { githubProvider } from "@/lib/git/github";
import { GitProviderError } from "@/lib/git/types";

function mockFetch(status: number) {
  return vi.fn(async () => ({ status, ok: status >= 200 && status < 300, text: async () => "" }));
}

afterEach(() => vi.unstubAllGlobals());

describe("githubProvider.deleteRepo", () => {
  it("204 → { deleted: true } y llama DELETE al repo correcto", async () => {
    const f = mockFetch(204);
    vi.stubGlobal("fetch", f);
    const res = await githubProvider("tok").deleteRepo({ owner: "DentVega", repo: "miniapp-x" });
    expect(res).toEqual({ deleted: true });
    expect(f).toHaveBeenCalledWith(
      "https://api.github.com/repos/DentVega/miniapp-x",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
  it("404 → { deleted: false } (idempotente, no lanza)", async () => {
    vi.stubGlobal("fetch", mockFetch(404));
    expect(await githubProvider("tok").deleteRepo({ owner: "o", repo: "r" })).toEqual({ deleted: false });
  });
  it("403 → GitProviderError mencionando delete_repo", async () => {
    vi.stubGlobal("fetch", mockFetch(403));
    await expect(githubProvider("tok").deleteRepo({ owner: "o", repo: "r" })).rejects.toThrow(/delete_repo/);
  });
  it("500 → GitProviderError", async () => {
    vi.stubGlobal("fetch", mockFetch(500));
    await expect(githubProvider("tok").deleteRepo({ owner: "o", repo: "r" })).rejects.toBeInstanceOf(GitProviderError);
  });
});
