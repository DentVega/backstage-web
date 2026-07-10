/** JSON-on-fs registry store (MVP, ADR-006). The only fs touch point. */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { Registry } from "./types";
import { kvStore, upstashClient } from "./kv";

const DATA_FILE = path.join(process.cwd(), "data", "registry.json");

export interface RegistryStore {
  load(): Promise<Registry>;
  save(reg: Registry): Promise<void>;
}

export const jsonStore: RegistryStore = {
  async load(): Promise<Registry> {
    try {
      const raw = await fs.readFile(DATA_FILE, "utf8");
      return JSON.parse(raw) as Registry;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
  },

  async save(reg: Registry): Promise<void> {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, `${JSON.stringify(reg, null, 2)}\n`, "utf8");
  },
};

/**
 * Env-selected store (ADR-014): Upstash KV in prod (when creds are present),
 * JSON fs in dev. Route handlers call this instead of importing a fixed store.
 */
export function getStore(): RegistryStore {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return kvStore(upstashClient());
  }
  return jsonStore;
}
