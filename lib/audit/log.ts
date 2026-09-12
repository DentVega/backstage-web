/** Store del audit log: hash-chain append-only por cadena sobre KV. */
import { type KvClient, inMemoryKvClient, upstashClient } from "../registry/kv";
import { computeHash, verifyChain } from "./chain";
import type { AuditEvent, RecordAuditInput } from "./types";

export const CHAINS_KEY = "audit:chains";
export const GLOBAL_CHAIN = "_global";
export const chainListKey = (chain: string): string => `audit:chain:${chain}`;
export const chainHeadKey = (chain: string): string => `audit:head:${chain}`;

const MAX_RETRIES = 15;
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const backoffMs = (attempt: number): number => 10 * (attempt + 1) + Math.random() * 15;

export interface AuditFilters {
  miniapp?: string;
  actor?: string;
  action?: string;
  limit?: number;
}

export function auditStore(client: KvClient) {
  return {
    async record(input: RecordAuditInput): Promise<AuditEvent> {
      const listKey = chainListKey(input.chain);
      const headKey = chainHeadKey(input.chain);
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const head = await client.get(headKey); // prevHash o null
        const newest = await client.lrange(listKey, 0, 0);
        const prevSeq = newest.length ? (JSON.parse(newest[0]) as AuditEvent).seq : 0;
        // Sin claves `undefined`: JSON.stringify las omite al guardar, así que si el hash se
        // computara sobre un objeto con `miniappId: undefined` no coincidiría tras el round-trip.
        const partial: Omit<AuditEvent, "hash"> = {
          seq: prevSeq + 1,
          ts: Date.now(),
          actor: input.actor,
          action: input.action,
          chain: input.chain,
          details: input.details ?? {},
          prevHash: head ?? "",
          ...(input.miniappId !== undefined ? { miniappId: input.miniappId } : {}),
        };
        const hash = computeHash(partial.prevHash, partial);
        const full: AuditEvent = { ...partial, hash };
        if (await client.casAppend(headKey, listKey, head, hash, JSON.stringify(full))) {
          if (prevSeq === 0) await client.sadd(CHAINS_KEY, input.chain);
          return full;
        }
        await sleep(backoffMs(attempt));
      }
      throw new Error(
        `audit: no se pudo appendear a la cadena ${input.chain} tras ${MAX_RETRIES} intentos`,
      );
    },

    async readChain(chain: string): Promise<AuditEvent[]> {
      const raws = await client.lrange(chainListKey(chain), 0, -1);
      return raws.map((r) => JSON.parse(r) as AuditEvent);
    },

    async readAll(filters: AuditFilters = {}): Promise<AuditEvent[]> {
      const chains = filters.miniapp ? [filters.miniapp] : await client.smembers(CHAINS_KEY);
      const nested = await Promise.all(chains.map((c) => this.readChain(c)));
      let events = nested.flat().sort((a, b) => b.ts - a.ts || b.seq - a.seq);
      if (filters.actor) events = events.filter((e) => e.actor.login === filters.actor);
      if (filters.action) events = events.filter((e) => e.action === filters.action);
      if (filters.limit && filters.limit > 0) events = events.slice(0, filters.limit);
      return events;
    },

    async verify(): Promise<{
      ok: boolean;
      chains: { chain: string; ok: boolean; brokenAt?: number }[];
    }> {
      const chains = await client.smembers(CHAINS_KEY);
      const results = await Promise.all(
        chains.map(async (chain) => {
          const oldestFirst = (await this.readChain(chain)).reverse();
          return { chain, ...verifyChain(oldestFirst) };
        }),
      );
      return { ok: results.every((r) => r.ok), chains: results };
    },
  };
}

// Dev usa un in-memory singleton a nivel de módulo (efímero: se pierde al reiniciar el proceso).
// Prod usa Upstash. El registry en dev es fs (jsonStore); el audit en dev es intencionalmente efímero.
let devClient: KvClient | undefined;
function auditKvClient(): KvClient {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) return upstashClient();
  devClient ??= inMemoryKvClient();
  return devClient;
}

export function getAuditStore(): ReturnType<typeof auditStore> {
  return auditStore(auditKvClient());
}

/**
 * Registra un evento sin tumbar la operación de negocio: fire-and-forward. Un fallo del audit
 * se loguea pero no se propaga (el audit es secundario a la acción ya cometida).
 */
export async function recordAudit(input: RecordAuditInput): Promise<void> {
  try {
    await getAuditStore().record(input);
  } catch (err) {
    console.error("audit: recordAudit falló", input.action, input.chain, err);
  }
}
