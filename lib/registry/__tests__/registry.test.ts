import { describe, expect, it } from "vitest";
import {
  InvalidManifestError,
  MiniappExistsError,
  MiniappNotFoundError,
  NoCompatibleVersionError,
  VersionExistsError,
  type Registry,
} from "@/lib/registry/types";
import {
  getMiniappDetail,
  listCatalog,
  publishVersion,
  registerMiniapp,
  resolveMiniapp,
  selectLatest,
} from "@/lib/registry/registry";

const manifest = (id: string, version: string) => ({
  id,
  version,
  entry: "./Entry",
  shared: [{ name: "react-native", requiredRange: "^0.76.0", singleton: true }],
  capabilities: ["accounts:read"],
});

const now = "2026-07-09T10:00:00.000Z";

function seeded(): Registry {
  let reg: Registry = registerMiniapp({}, {
    id: "account_dashboard",
    name: "Account Dashboard",
    owner: "payments",
  }, now);
  reg = publishVersion(
    reg,
    "account_dashboard",
    { version: "0.1.0", url: "http://h/v010", manifest: manifest("account_dashboard", "0.1.0") },
    now,
  );
  return reg;
}

describe("registerMiniapp", () => {
  it("creates an empty record", () => {
    const reg = registerMiniapp({}, { id: "acc", name: "A", owner: "o" }, now);
    expect(reg.acc?.versions).toHaveLength(0);
  });
  it("stamps createdAt with the provided time", () => {
    const reg = registerMiniapp({}, { id: "acc", name: "A", owner: "o" }, now);
    expect(reg.acc?.createdAt).toBe(now);
  });
  it("stores repoUrl when provided", () => {
    const reg = registerMiniapp(
      {},
      { id: "acc", name: "A", owner: "o", repoUrl: "https://github.com/org/miniapp-acc" },
      now,
    );
    expect(reg.acc?.repoUrl).toBe("https://github.com/org/miniapp-acc");
  });
  it("omits repoUrl when not provided", () => {
    const reg = registerMiniapp({}, { id: "acc", name: "A", owner: "o" }, now);
    expect(reg.acc?.repoUrl).toBeUndefined();
  });
  it("rejects a duplicate id", () => {
    const reg = registerMiniapp({}, { id: "acc", name: "A", owner: "o" }, now);
    expect(() => registerMiniapp(reg, { id: "acc", name: "A", owner: "o" }, now)).toThrow(
      MiniappExistsError,
    );
  });
  it("rejects a malformed id", () => {
    expect(() => registerMiniapp({}, { id: "Bad Id", name: "A", owner: "o" }, now)).toThrow(
      InvalidManifestError,
    );
  });
});

describe("publishVersion", () => {
  it("publishes a valid version", () => {
    const reg = seeded();
    expect(reg.account_dashboard?.versions[0]?.version).toBe("0.1.0");
    expect(reg.account_dashboard?.versions[0]?.publishedAt).toBe(now);
  });
  it("rejects publishing to an unregistered miniapp", () => {
    expect(() =>
      publishVersion({}, "ghost", { version: "1.0.0", url: "u", manifest: manifest("ghost", "1.0.0") }, now),
    ).toThrow(MiniappNotFoundError);
  });
  it("rejects a manifest that fails the contract shape", () => {
    const reg = registerMiniapp({}, { id: "acc", name: "A", owner: "o" }, now);
    expect(() =>
      publishVersion(reg, "acc", { version: "1.0.0", url: "u", manifest: { nope: true } }, now),
    ).toThrow(InvalidManifestError);
  });
  it("rejects a manifest whose id/version disagree with the request", () => {
    const reg = registerMiniapp({}, { id: "acc", name: "A", owner: "o" }, now);
    expect(() =>
      publishVersion(reg, "acc", { version: "2.0.0", url: "u", manifest: manifest("acc", "1.0.0") }, now),
    ).toThrow(InvalidManifestError);
  });
  it("rejects a duplicate version", () => {
    const reg = seeded();
    expect(() =>
      publishVersion(reg, "account_dashboard", {
        version: "0.1.0",
        url: "u",
        manifest: manifest("account_dashboard", "0.1.0"),
      }, now),
    ).toThrow(VersionExistsError);
  });
});

describe("selectLatest / resolveMiniapp", () => {
  function multi(): Registry {
    let reg = registerMiniapp({}, { id: "acc", name: "A", owner: "o" }, now);
    for (const v of ["0.1.0", "0.2.0", "1.0.0"]) {
      reg = publishVersion(reg, "acc", { version: v, url: `u/${v}`, manifest: manifest("acc", v) }, now);
    }
    return reg;
  }

  it("selectLatest picks the highest semver", () => {
    const reg = multi();
    expect(selectLatest(reg.acc?.versions ?? [])?.version).toBe("1.0.0");
  });
  it("resolves the latest by default", () => {
    expect(resolveMiniapp(multi(), "acc").version).toBe("1.0.0");
  });
  it("resolves an exact version", () => {
    expect(resolveMiniapp(multi(), "acc", { version: "0.2.0" }).version).toBe("0.2.0");
  });
  it("resolves the latest within a range", () => {
    expect(resolveMiniapp(multi(), "acc", { range: "^0.1.0" }).version).toBe("0.2.0");
  });
  it("returns a full ResolveResponse", () => {
    const res = resolveMiniapp(seeded(), "account_dashboard");
    expect(res).toMatchObject({ id: "account_dashboard", version: "0.1.0", url: "http://h/v010" });
    expect(res.manifest.entry).toBe("./Entry");
  });
  it("throws NotFound for an unknown id", () => {
    expect(() => resolveMiniapp({}, "ghost")).toThrow(MiniappNotFoundError);
  });
  it("throws when no version satisfies the range", () => {
    expect(() => resolveMiniapp(multi(), "acc", { range: "^9.0.0" })).toThrow(
      NoCompatibleVersionError,
    );
  });
});

describe("listCatalog", () => {
  it("projects records with their latest version", () => {
    const entries = listCatalog(seeded());
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "account_dashboard",
      latestVersion: "0.1.0",
      versionCount: 1,
    });
  });
  it("carries createdAt and repoUrl when present", () => {
    let reg = registerMiniapp(
      {},
      { id: "acc", name: "A", owner: "o", repoUrl: "https://github.com/org/miniapp-acc" },
      now,
    );
    reg = publishVersion(reg, "acc", { version: "0.1.0", url: "u", manifest: manifest("acc", "0.1.0") }, now);
    expect(listCatalog(reg)[0]).toMatchObject({
      createdAt: now,
      repoUrl: "https://github.com/org/miniapp-acc",
    });
  });
});

describe("getMiniappDetail", () => {
  it("projects the full detail with latest capabilities and versions newest-first", () => {
    let reg = registerMiniapp(
      {},
      { id: "acc", name: "A", owner: "o", repoUrl: "https://github.com/org/miniapp-acc" },
      now,
    );
    for (const v of ["0.1.0", "1.0.0"]) {
      reg = publishVersion(reg, "acc", { version: v, url: `u/${v}`, manifest: manifest("acc", v) }, now);
    }
    const detail = getMiniappDetail(reg, "acc");
    expect(detail).toMatchObject({
      id: "acc",
      owner: "o",
      createdAt: now,
      repoUrl: "https://github.com/org/miniapp-acc",
      latestVersion: "1.0.0",
      versionCount: 2,
    });
    expect(detail.versions.map((v) => v.version)).toEqual(["1.0.0", "0.1.0"]);
    expect(detail.capabilities).toEqual(["accounts:read"]);
    expect(detail.versions[0].capabilities).toEqual(["accounts:read"]);
  });
  it("returns empty versions/capabilities for a registered-but-unpublished miniapp", () => {
    const reg = registerMiniapp({}, { id: "acc", name: "A", owner: "o" }, now);
    const detail = getMiniappDetail(reg, "acc");
    expect(detail.latestVersion).toBeNull();
    expect(detail.versions).toHaveLength(0);
    expect(detail.capabilities).toEqual([]);
  });
  it("throws MiniappNotFoundError for an unknown id", () => {
    expect(() => getMiniappDetail({}, "ghost")).toThrow(MiniappNotFoundError);
  });
});
