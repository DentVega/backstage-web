/** JSON-on-fs registry store (MVP, ADR-006). The only fs touch point. */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { MiniappRecord, Registry } from "./types";
import { kvStore, upstashClient } from "./kv";

const DATA_FILE = path.join(process.cwd(), "data", "registry.json");

export interface RegistryStore {
  /** Un record por id (lee `registry:app:<id>`). */
  getApp(id: string): Promise<MiniappRecord | undefined>;
  /** Todo el registry (índice + mget). Corre la migración lazy. */
  getAll(): Promise<Registry>;
  /**
   * Muta UNA miniapp con CAS+retry. `fn` recibe el record actual (o undefined si no existe) y
   * devuelve el nuevo (o null para borrar). Mantiene `registry:index`. Tira ConflictError si se
   * agotan los reintentos.
   */
  mutateApp(
    id: string,
    fn: (rec: MiniappRecord | undefined) => MiniappRecord | null,
  ): Promise<MiniappRecord | null>;
  /** Alias de lectura de `getAll()` (usado por rutas/páginas read-only). */
  load(): Promise<Registry>;
}

async function readFileReg(): Promise<Registry> {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as Registry;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw err;
  }
}
async function writeFileReg(reg: Registry): Promise<void> {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, `${JSON.stringify(reg, null, 2)}\n`, "utf8");
}

/** Store fs (dev, un proceso): sin concurrencia real, misma interfaz. */
export const jsonStore: RegistryStore = {
  async getAll() {
    return readFileReg();
  },
  async getApp(id) {
    return (await readFileReg())[id];
  },
  async mutateApp(id, fn) {
    const reg = await readFileReg();
    const next = fn(reg[id]);
    if (next === null) {
      const { [id]: _drop, ...rest } = reg;
      await writeFileReg(rest);
      return null;
    }
    await writeFileReg({ ...reg, [id]: next });
    return next;
  },
  async load() {
    return readFileReg();
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
