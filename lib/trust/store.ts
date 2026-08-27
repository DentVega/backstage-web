/** Store del trust bundle (ADR-014 style): Upstash KV en prod, JSON-fs en dev.
 *  Bajo su propia key `trust-bundle` (separado del registry). */
import { promises as fs } from "node:fs";
import path from "node:path";
import { type KvClient, upstashClient } from "@/lib/registry/kv";
import type { SignedTrustBundle } from "./types";

const BUNDLE_KEY = "trust-bundle";
const DATA_FILE = path.join(process.cwd(), "data", "trust-bundle.json");

export interface TrustBundleStore {
  load(): Promise<SignedTrustBundle | null>;
  save(bundle: SignedTrustBundle): Promise<void>;
}

export function kvTrustBundleStore(client: KvClient): TrustBundleStore {
  return {
    async load() {
      const raw = await client.get(BUNDLE_KEY);
      return raw ? (JSON.parse(raw) as SignedTrustBundle) : null;
    },
    async save(bundle) {
      await client.set(BUNDLE_KEY, JSON.stringify(bundle));
    },
  };
}

export const jsonTrustBundleStore: TrustBundleStore = {
  async load() {
    try {
      return JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as SignedTrustBundle;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  },
  async save(bundle) {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  },
};

export function getTrustBundleStore(): TrustBundleStore {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return kvTrustBundleStore(upstashClient());
  }
  return jsonTrustBundleStore;
}
