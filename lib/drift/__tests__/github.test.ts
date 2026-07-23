import { describe, expect, it, beforeEach } from "vitest";
import { githubDriftProvider } from "@/lib/drift/github";

function b64(obj: unknown): string {
  return Buffer.from(JSON.stringify(obj), "utf8").toString("base64");
}

beforeEach(() => {
  process.env.GITHUB_TOKEN = "test-token";
  process.env.MINIAPP_TEMPLATE_REPO = "DentVega/miniapp-template";
});

describe("githubDriftProvider", () => {
  it("getTemplateHead returns the commit sha", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ sha: "HEADSHA" }), { status: 200 })) as unknown as typeof fetch;
    const sha = await githubDriftProvider(fetchImpl).getTemplateHead();
    expect(sha).toBe("HEADSHA");
  });

  it("getBaseSha decodes .template-sync content", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ content: b64({ templateRepo: "x", baseSha: "BASESHA" }) }), {
        status: 200,
      })) as unknown as typeof fetch;
    const base = await githubDriftProvider(fetchImpl).getBaseSha("acme/miniapp-a");
    expect(base).toBe("BASESHA");
  });

  it("getBaseSha returns null on 404 (untracked)", async () => {
    const fetchImpl = (async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    const base = await githubDriftProvider(fetchImpl).getBaseSha("acme/miniapp-a");
    expect(base).toBeNull();
  });

  it("getBaseSha throws on a non-404 error", async () => {
    const fetchImpl = (async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    await expect(githubDriftProvider(fetchImpl).getBaseSha("acme/miniapp-a")).rejects.toThrow();
  });
});
