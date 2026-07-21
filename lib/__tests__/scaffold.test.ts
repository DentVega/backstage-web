import { describe, expect, it, vi } from "vitest";
import { scaffoldMiniapp } from "@/lib/scaffold";
import { mockProvider } from "@/lib/git/mock";
import { GitProviderError } from "@/lib/git/types";
import {
  InvalidManifestError,
  MiniappExistsError,
  type Registry,
} from "@/lib/registry/types";

const TEMPLATE = "org/miniapp-template";
const NOW = "2026-07-10T12:00:00.000Z";

describe("scaffoldMiniapp", () => {
  it("creates the repo and registers the miniapp", async () => {
    const res = await scaffoldMiniapp(
      {},
      mockProvider(),
      TEMPLATE,
      { id: "payments", name: "Payments", owner: "acme" },
      NOW,
    );
    expect(res.repoUrl).toBe("https://github.com/acme/miniapp-payments");
    expect(res.registry.payments).toMatchObject({ id: "payments", owner: "acme" });
  });

  it("records createdAt and the repoUrl on the registered miniapp", async () => {
    const res = await scaffoldMiniapp(
      {},
      mockProvider(),
      TEMPLATE,
      { id: "payments", name: "Payments", owner: "acme" },
      NOW,
    );
    expect(res.registry.payments).toMatchObject({
      createdAt: NOW,
      repoUrl: "https://github.com/acme/miniapp-payments",
    });
  });

  it("rejects an invalid id (does not touch the provider)", async () => {
    const provider = mockProvider();
    const spy = vi.spyOn(provider, "createFromTemplate");
    await expect(
      scaffoldMiniapp({}, provider, TEMPLATE, { id: "Bad Id", name: "X", owner: "o" }, NOW),
    ).rejects.toBeInstanceOf(InvalidManifestError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("rejects an already-registered id (does not create a repo)", async () => {
    const reg: Registry = {
      payments: { id: "payments" as never, name: "P", owner: "o", versions: [] },
    };
    const provider = mockProvider();
    const spy = vi.spyOn(provider, "createFromTemplate");
    await expect(
      scaffoldMiniapp(reg, provider, TEMPLATE, { id: "payments", name: "P", owner: "o" }, NOW),
    ).rejects.toBeInstanceOf(MiniappExistsError);
    expect(spy).not.toHaveBeenCalled();
  });

  it("propagates a GitProviderError", async () => {
    const provider = {
      createFromTemplate: async () => {
        throw new GitProviderError("boom");
      },
      dispatchWorkflow: async () => {},
      enableActionsPullRequests: async () => {},
    };
    await expect(
      scaffoldMiniapp({}, provider, TEMPLATE, { id: "cards", name: "Cards", owner: "o" }, NOW),
    ).rejects.toBeInstanceOf(GitProviderError);
  });

  it("enables Actions PR creation on the new repo (so template-sync can open PRs)", async () => {
    const provider = mockProvider();
    const spy = vi.spyOn(provider, "enableActionsPullRequests");
    await scaffoldMiniapp(
      {},
      provider,
      TEMPLATE,
      { id: "payments", name: "Payments", owner: "acme" },
      NOW,
    );
    expect(spy).toHaveBeenCalledWith({ owner: "acme", repo: "miniapp-payments" });
  });

  it("still succeeds if enabling Actions PR creation fails (best-effort, no orphan)", async () => {
    const provider = mockProvider();
    vi.spyOn(provider, "enableActionsPullRequests").mockRejectedValue(
      new GitProviderError("no admin"),
    );
    const res = await scaffoldMiniapp(
      {},
      provider,
      TEMPLATE,
      { id: "payments", name: "Payments", owner: "acme" },
      NOW,
    );
    expect(res.registry.payments).toMatchObject({ id: "payments", owner: "acme" });
  });
});
