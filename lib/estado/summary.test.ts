import { describe, it, expect } from "vitest";
import { buildEstadoSummary, type StorageState } from "./summary";
import type { CatalogEntry, Registry } from "@/lib/registry/types";
import type { HostContract } from "@/lib/host-contract/types";

const storage: StorageState = {
  active: "r2",
  available: ["r2", "blob", "fs"],
  source: "env",
};

/** Reloj fijo para determinismo. */
const NOW = Date.parse("2026-08-13T00:00:00.000Z");

/** Input con strings planos; los tipos branded (MiniappId/SemVer) se castean al construir. */
interface EntryInput {
  id: string;
  name?: string;
  owner?: string;
  latestVersion?: string | null;
  servedVersion?: string | null;
  versionCount?: number;
  createdAt?: string;
  repoUrl?: string;
}

function entry(p: EntryInput): CatalogEntry {
  return {
    id: p.id as CatalogEntry["id"],
    name: p.name ?? p.id,
    owner: p.owner ?? "team",
    latestVersion: (p.latestVersion ?? null) as CatalogEntry["latestVersion"],
    servedVersion: (p.servedVersion ?? null) as CatalogEntry["servedVersion"],
    versionCount: p.versionCount ?? 0,
    createdAt: p.createdAt,
    repoUrl: p.repoUrl,
  };
}

/** Registro mínimo: solo lo que buildEstadoSummary lee del record crudo (iosUrl, publishedAt). */
function reg(byId: Record<string, { iosUrl?: string; publishedAt?: string }[]>): Registry {
  const r: Record<string, unknown> = {};
  for (const [id, versions] of Object.entries(byId)) {
    r[id] = { id, name: id, owner: "team", versions };
  }
  return r as Registry;
}

describe("buildEstadoSummary", () => {
  it("registro vacío → totales en cero, sin flota, contrato no publicado, gate warn", () => {
    const s = buildEstadoSummary([], {}, null, false, storage, NOW);
    expect(s.totals).toEqual({ miniapps: 0, versions: 0, iosAndAndroid: 0, publishedLast30d: 0 });
    expect(s.fleet).toEqual([]);
    expect(s.contract.published).toBe(false);
    expect(s.gate).toBe("warn");
    expect(s.storage).toBe(storage);
  });

  it("deriva plataformas: iOS+Android cuando alguna versión trae iosUrl", () => {
    const entries = [entry({ id: "hw", latestVersion: "0.1.19", servedVersion: "0.1.19", versionCount: 41 })];
    const s = buildEstadoSummary(
      entries,
      reg({ hw: [{}, { iosUrl: "https://cdn/hw/0.1.19/ios/hw.container.js.bundle" }] }),
      null,
      false,
      storage,
      NOW,
    );
    expect(s.fleet[0].platforms).toEqual(["android", "ios"]);
    expect(s.totals.iosAndAndroid).toBe(1);
    expect(s.totals.versions).toBe(41);
  });

  it("android-only cuando ninguna versión trae iosUrl", () => {
    const entries = [entry({ id: "aw", versionCount: 3, latestVersion: "1.0.0", servedVersion: "1.0.0" })];
    const s = buildEstadoSummary(entries, reg({ aw: [{}, {}, {}] }), null, false, storage, NOW);
    expect(s.fleet[0].platforms).toEqual(["android"]);
    expect(s.totals.iosAndAndroid).toBe(0);
  });

  it("sin versiones → platforms vacío y sin fecha de publicación", () => {
    const entries = [entry({ id: "empty", versionCount: 0 })];
    const s = buildEstadoSummary(entries, reg({ empty: [] }), null, false, storage, NOW);
    expect(s.fleet[0].platforms).toEqual([]);
    expect(s.fleet[0].lastPublishedAt).toBeNull();
    expect(s.fleet[0].daysSincePublish).toBeNull();
    expect(s.totals.publishedLast30d).toBe(0);
  });

  it("marca rollback cuando served ≠ latest", () => {
    const entries = [
      entry({ id: "acc", latestVersion: "0.8.0", servedVersion: "0.7.3", versionCount: 10 }),
      entry({ id: "hw", latestVersion: "0.1.19", servedVersion: "0.1.19", versionCount: 41 }),
    ];
    const s = buildEstadoSummary(entries, reg({ acc: [{}], hw: [{}] }), null, false, storage, NOW);
    expect(s.fleet[0].isRolledBack).toBe(true);
    expect(s.fleet[1].isRolledBack).toBe(false);
  });

  it("actividad: última publicación (la más reciente) y conteo de 30 días", () => {
    const entries = [
      entry({ id: "hw", versionCount: 2, latestVersion: "0.1.2", servedVersion: "0.1.2" }),
      entry({ id: "old", versionCount: 1, latestVersion: "1.0.0", servedVersion: "1.0.0" }),
    ];
    const s = buildEstadoSummary(
      entries,
      reg({
        hw: [
          { publishedAt: "2026-08-01T00:00:00.000Z" }, // 12 días atrás
          { publishedAt: "2026-08-11T00:00:00.000Z" }, // 2 días atrás (la más reciente)
        ],
        old: [{ publishedAt: "2026-05-01T00:00:00.000Z" }], // > 30 días
      }),
      null,
      false,
      storage,
      NOW,
    );
    expect(s.fleet[0].lastPublishedAt).toBe("2026-08-11T00:00:00.000Z");
    expect(s.fleet[0].daysSincePublish).toBe(2);
    expect(s.fleet[1].daysSincePublish).toBeGreaterThan(30);
    expect(s.totals.publishedLast30d).toBe(2); // las 2 de hw; old queda fuera
  });

  it("resume el Host Contract cuando está publicado", () => {
    const contract = {
      contractVersion: "0.1.0",
      reactNative: "0.74.5",
      shared: { react: "18.3.1", "react-native": "0.74.5" },
      nativeModules: ["expo-secure-store", "react-native-mmkv"],
    } as HostContract;
    const s = buildEstadoSummary([], {}, contract, false, storage, NOW);
    expect(s.contract.published).toBe(true);
    if (s.contract.published) {
      expect(s.contract.contractVersion).toBe("0.1.0");
      expect(s.contract.reactNative).toBe("0.74.5");
      expect(s.contract.shared).toContainEqual(["react", "18.3.1"]);
      expect(s.contract.nativeModules).toEqual(["expo-secure-store", "react-native-mmkv"]);
    }
  });

  it("gate enforce cuando gateEnforce=true", () => {
    const s = buildEstadoSummary([], {}, null, true, storage, NOW);
    expect(s.gate).toBe("enforce");
  });
});
