import { promises as fs } from "node:fs";
import path from "node:path";
import type { KvClient } from "@/lib/registry/kv";
import { upstashClient } from "@/lib/registry/kv";
import { isStorageProvider, type StorageProvider } from "./provider";

const DATA_FILE = path.join(process.cwd(), "data", "storage-provider.json");
const KEY = "storage-provider";

export interface StoragePreferenceStore {
  load(): Promise<StorageProvider | null>;
  save(p: StorageProvider): Promise<void>;
}

/** Dev store: JSON on fs. `{ "provider": "r2" }`. null si no existe o inválido. */
export const jsonStoragePreferenceStore: StoragePreferenceStore = {
  async load(): Promise<StorageProvider | null> {
    try {
      const parsed = JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as { provider?: unknown };
      return isStorageProvider(parsed.provider) ? parsed.provider : null;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  },
  async save(p: StorageProvider): Promise<void> {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, `${JSON.stringify({ provider: p }, null, 2)}\n`, "utf8");
  },
};

/** KV store: raw string under `storage-provider`. Validated on read. */
export function kvStoragePreferenceStore(client: KvClient): StoragePreferenceStore {
  return {
    async load(): Promise<StorageProvider | null> {
      const raw = await client.get(KEY);
      return isStorageProvider(raw) ? raw : null;
    },
    async save(p: StorageProvider): Promise<void> {
      await client.set(KEY, p);
    },
  };
}

/** Env-selected: Upstash KV en prod, JSON fs en dev (espeja getStore). */
export function getStoragePreferenceStore(): StoragePreferenceStore {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return kvStoragePreferenceStore(upstashClient());
  }
  return jsonStoragePreferenceStore;
}
