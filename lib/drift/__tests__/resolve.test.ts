import { describe, expect, it } from "vitest";
import { resolveDriftStatuses } from "@/lib/drift/resolve";
import { mockDriftProvider } from "@/lib/drift/mock";

const items = [
  { id: "a", owner: "acme", repoUrl: "https://github.com/acme/miniapp-a" },
  { id: "b", owner: "acme", repoUrl: "https://github.com/acme/miniapp-b" },
  { id: "c", owner: "acme", repoUrl: "https://github.com/acme/miniapp-c" },
];

describe("resolveDriftStatuses", () => {
  it("classifies up_to_date / drift / untracked", async () => {
    const provider = mockDriftProvider({
      head: "HEADSHA",
      baseByRepo: {
        "acme/miniapp-a": "HEADSHA", // == head → up_to_date
        "acme/miniapp-b": "OLDSHA", //  != head → drift
        "acme/miniapp-c": null, //      no marker → untracked
      },
    });
    const out = await resolveDriftStatuses(items, provider);
    expect(out).toEqual({ a: "up_to_date", b: "drift", c: "untracked" });
  });

  it("maps a per-item error to unknown (fail-soft)", async () => {
    const provider = mockDriftProvider({
      head: "HEADSHA",
      baseByRepo: { "acme/miniapp-a": "HEADSHA" },
      throwRepos: ["acme/miniapp-b"],
    });
    const out = await resolveDriftStatuses(items, provider);
    expect(out.a).toBe("up_to_date");
    expect(out.b).toBe("unknown");
    expect(out.c).toBe("untracked"); // null default
  });

  it("returns all unknown when the template HEAD fetch fails", async () => {
    const provider = mockDriftProvider({ throwHead: true });
    const out = await resolveDriftStatuses(items, provider);
    expect(out).toEqual({ a: "unknown", b: "unknown", c: "unknown" });
  });
});
