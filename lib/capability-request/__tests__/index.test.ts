import { describe, expect, it, vi } from "vitest";
import { openCapabilityRequests } from "@/lib/capability-request";
import { mockProvider } from "@/lib/git/mock";

describe("openCapabilityRequests", () => {
  it("abre un pedido por cada lib faltante con el contexto", async () => {
    const provider = mockProvider();
    const spy = vi.spyOn(provider, "ensureIssue");
    const r = await openCapabilityRequests(provider, "DentVega/backstagereactnative",
      ["react-native-svg", "react-native-mmkv"], { miniappId: "acc", version: "1.0.0" });
    expect(r.requested.sort()).toEqual(["react-native-mmkv", "react-native-svg"]);
    expect(r.failed).toEqual([]);
    expect(spy).toHaveBeenCalledTimes(2);
    const call = spy.mock.calls[0][0];
    expect(call.owner).toBe("DentVega");
    expect(call.repo).toBe("backstagereactnative");
    expect(call.title).toContain("react-native-svg");
    expect(call.body).toContain("acc");
  });

  it("una lib que falla va a failed; las demás a requested", async () => {
    const provider = mockProvider();
    vi.spyOn(provider, "ensureIssue").mockImplementation(async (i) => {
      if (i.title.includes("bad")) throw new Error("boom");
      return { created: true, url: "x" };
    });
    const r = await openCapabilityRequests(provider, "o/r", ["ok-lib", "bad-lib"], { miniappId: "acc", version: "1.0.0" });
    expect(r.requested).toEqual(["ok-lib"]);
    expect(r.failed[0].library).toBe("bad-lib");
  });
});
