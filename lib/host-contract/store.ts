/** Host Contract store — un solo valor bajo una key (espeja lib/registry). */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { KvClient } from "@/lib/registry/kv";
import { upstashClient } from "@/lib/registry/kv";
import type { HostContract } from "./types";

const DATA_FILE = path.join(process.cwd(), "data", "host-contract.json");
const KEY = "host-contract";

export interface HostContractStore {
  load(): Promise<HostContract | null>;
  save(c: HostContract): Promise<void>;
}

export const jsonHostContractStore: HostContractStore = {
  async load(): Promise<HostContract | null> {
    try {
      return JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as HostContract;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  },
  async save(c: HostContract): Promise<void> {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, `${JSON.stringify(c, null, 2)}\n`, "utf8");
  },
};

export function kvHostContractStore(client: KvClient): HostContractStore {
  return {
    async load(): Promise<HostContract | null> {
      const raw = await client.get(KEY);
      return raw ? (JSON.parse(raw) as HostContract) : null;
    },
    async save(c: HostContract): Promise<void> {
      await client.set(KEY, JSON.stringify(c));
    },
  };
}

/** Env-selected: Upstash KV en prod, JSON fs en dev (espeja getStore). */
export function getHostContractStore(): HostContractStore {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return kvHostContractStore(upstashClient());
  }
  return jsonHostContractStore;
}
