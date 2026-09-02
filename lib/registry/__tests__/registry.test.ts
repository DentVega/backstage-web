import { beforeEach, describe, expect, it } from "vitest";
import {
  InvalidManifestError,
  MiniappExistsError,
  MiniappNotFoundError,
  NoCompatibleVersionError,
  VersionExistsError,
  type Registry,
} from "@/lib/registry/types";
import {
  asRecordMutation,
  getMiniappDetail,
  listCatalog,
  publishVersion,
  registerMiniapp,
  removeMiniapp,
  resolveMiniapp,
  selectLatest,
  setMaintainers,
  setMiniappPublicKey,
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
  it("expone publicKey cuando está registrada (para la CLI del trust bundle)", () => {
    let reg = registerMiniapp({}, { id: "acc", name: "A", owner: "o" }, now);
    reg = setMiniappPublicKey(reg, "acc", "PK-b64url");
    expect(listCatalog(reg)[0].publicKey).toBe("PK-b64url");
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

describe("publishVersion — iOS attach", () => {
  it("adjunta iOS a una versión Android existente (misma versión)", () => {
    let reg = seeded(); // account_dashboard@0.1.0 (Android)
    reg = publishVersion(
      reg,
      "account_dashboard",
      {
        version: "0.1.0",
        url: "http://h/v010/ios",
        manifest: manifest("account_dashboard", "0.1.0"),
        platform: "ios",
        integrity: "sha256-IOS",
      },
      now,
    );
    const v = reg.account_dashboard!.versions.find((x) => x.version === "0.1.0")!;
    expect(v.url).toBe("http://h/v010"); // Android intacto
    expect(v.iosUrl).toBe("http://h/v010/ios"); // iOS adjuntado
    expect(v.iosIntegrity).toBe("sha256-IOS");
    expect(reg.account_dashboard!.versions).toHaveLength(1); // no crea versión nueva
  });

  it("iOS en una versión inexistente → InvalidManifestError", () => {
    const reg = seeded();
    expect(() =>
      publishVersion(
        reg,
        "account_dashboard",
        { version: "9.9.9", url: "http://h/x/ios", manifest: manifest("account_dashboard", "9.9.9"), platform: "ios", integrity: "sha256-X" },
        now,
      ),
    ).toThrow(InvalidManifestError);
  });

  it("iOS dos veces en la misma versión → VersionExistsError", () => {
    let reg = seeded();
    reg = publishVersion(reg, "account_dashboard", { version: "0.1.0", url: "http://h/v010/ios", manifest: manifest("account_dashboard", "0.1.0"), platform: "ios", integrity: "sha256-IOS" }, now);
    expect(() =>
      publishVersion(reg, "account_dashboard", { version: "0.1.0", url: "http://h/v010/ios2", manifest: manifest("account_dashboard", "0.1.0"), platform: "ios", integrity: "sha256-IOS2" }, now),
    ).toThrow(VersionExistsError);
  });

  it("Android (default) sigue creando versión y con VERSION_EXISTS", () => {
    let reg = seeded();
    reg = publishVersion(reg, "account_dashboard", { version: "0.2.0", url: "http://h/v020", manifest: manifest("account_dashboard", "0.2.0") }, now);
    expect(reg.account_dashboard!.versions).toHaveLength(2);
    expect(() =>
      publishVersion(reg, "account_dashboard", { version: "0.2.0", url: "http://h/v020b", manifest: manifest("account_dashboard", "0.2.0") }, now),
    ).toThrow(VersionExistsError);
  });
});

describe("resolveMiniapp — platform", () => {
  function withIos(): Registry {
    let reg = seeded(); // account_dashboard@0.1.0 android
    reg = publishVersion(reg, "account_dashboard", { version: "0.1.0", url: "http://h/v010/ios", manifest: manifest("account_dashboard", "0.1.0"), platform: "ios", integrity: "sha256-IOS" }, now);
    return reg;
  }

  it("platform ios → devuelve iosUrl + integrity iOS pisada", () => {
    const r = resolveMiniapp(withIos(), "account_dashboard", { platform: "ios" });
    expect(r.url).toBe("http://h/v010/ios");
    expect(r.manifest.integrity).toBe("sha256-IOS");
  });

  it("sin platform (android) → intacto (url + manifest Android)", () => {
    const r = resolveMiniapp(withIos(), "account_dashboard", {});
    expect(r.url).toBe("http://h/v010");
    expect(r.manifest.integrity).toBeUndefined(); // el manifest del fixture no trae integrity
  });

  it("platform ios cuando la versión no tiene iOS → NoCompatibleVersionError", () => {
    expect(() => resolveMiniapp(seeded(), "account_dashboard", { platform: "ios" })).toThrow(
      NoCompatibleVersionError,
    );
  });
});

describe("publishVersion — firma", () => {
  const withApp = () =>
    registerMiniapp({}, { id: "cards_wallet", name: "C", owner: "o" }, now);

  it("Android guarda signature en la versión", () => {
    const reg = publishVersion(
      withApp(),
      "cards_wallet",
      {
        version: "0.1.0",
        url: "u",
        manifest: manifest("cards_wallet", "0.1.0"),
        platform: "android",
        integrity: "sha256-a",
        signature: "sigA",
      },
      now,
    );
    expect(reg.cards_wallet.versions[0].signature).toBe("sigA");
  });

  it("iOS adjunta iosSignature a la versión Android existente", () => {
    const android = publishVersion(
      withApp(),
      "cards_wallet",
      {
        version: "0.1.0",
        url: "u",
        manifest: manifest("cards_wallet", "0.1.0"),
        platform: "android",
        integrity: "sha256-a",
        signature: "sigA",
      },
      now,
    );
    const withIos = publishVersion(
      android,
      "cards_wallet",
      {
        version: "0.1.0",
        url: "u-ios",
        manifest: manifest("cards_wallet", "0.1.0"),
        platform: "ios",
        integrity: "sha256-i",
        signature: "sigI",
      },
      now,
    );
    const v = withIos.cards_wallet.versions[0];
    expect(v.signature).toBe("sigA");
    expect(v.iosSignature).toBe("sigI");
  });
});

describe("resolveMiniapp — firma en el manifest", () => {
  let reg: Registry;
  beforeEach(() => {
    const base = registerMiniapp({}, { id: "cards_wallet", name: "C", owner: "o" }, now);
    reg = publishVersion(
      base,
      "cards_wallet",
      {
        version: "0.1.0",
        url: "u",
        manifest: manifest("cards_wallet", "0.1.0"),
        platform: "android",
        integrity: "sha256-a",
        signature: "sigA",
      },
      now,
    );
    reg = publishVersion(
      reg,
      "cards_wallet",
      {
        version: "0.1.0",
        url: "u-ios",
        manifest: manifest("cards_wallet", "0.1.0"),
        platform: "ios",
        integrity: "sha256-i",
        signature: "sigI",
      },
      now,
    );
  });

  it("Android devuelve manifest.signature = signature", () => {
    const r = resolveMiniapp(reg, "cards_wallet", {});
    expect((r.manifest as { signature?: string }).signature).toBe("sigA");
  });

  it("iOS devuelve manifest.signature = iosSignature (y su integrity)", () => {
    const r = resolveMiniapp(reg, "cards_wallet", { platform: "ios" });
    expect((r.manifest as { signature?: string }).signature).toBe("sigI");
    expect(r.manifest.integrity).toBe("sha256-i");
  });

  it("sin firma no aparece la key signature", () => {
    const base = registerMiniapp({}, { id: "hellow_widget", name: "S", owner: "o" }, now);
    const noSig = publishVersion(
      base,
      "hellow_widget",
      {
        version: "0.1.0",
        url: "u",
        manifest: manifest("hellow_widget", "0.1.0"),
        platform: "android",
        integrity: "sha256-a",
      },
      now,
    );
    const r = resolveMiniapp(noSig, "hellow_widget", {});
    expect("signature" in (r.manifest as object)).toBe(false);
  });
});

describe("asRecordMutation", () => {
  const withApp = () => registerMiniapp({}, { id: "cards_wallet", name: "C", owner: "o" }, now);
  it("aplica un mutador (reg)=>reg sobre un solo record", () => {
    const rec = withApp().cards_wallet;
    const fn = asRecordMutation("cards_wallet", (reg) =>
      setMaintainers(reg, "cards_wallet", ["DentVega"]),
    );
    expect(fn(rec)!.maintainers).toEqual(["DentVega"]);
  });
  it("devuelve null cuando el mutador borra el record (removeMiniapp)", () => {
    const rec = withApp().cards_wallet;
    const fn = asRecordMutation("cards_wallet", (reg) => removeMiniapp(reg, "cards_wallet"));
    expect(fn(rec)).toBeNull();
  });
  it("registra cuando el record no existe (rec undefined)", () => {
    const fn = asRecordMutation("nueva", (reg) =>
      registerMiniapp(reg, { id: "nueva", name: "N", owner: "o" }, now),
    );
    expect(fn(undefined)!.id).toBe("nueva");
  });
});
