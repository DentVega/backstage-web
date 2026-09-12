/** Hash-chain puro del audit log. Sin I/O. */
import { createHash } from "node:crypto";
import type { AuditEvent } from "./types";

function base64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** JSON determinístico: ordena claves recursivamente para que el hash sea estable. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const body = Object.keys(obj)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`)
    .join(",");
  return `{${body}}`;
}

/** hash = sha256_base64url(prevHash + canonicalize(evento sin `hash`)). */
export function computeHash(prevHash: string, evt: Omit<AuditEvent, "hash">): string {
  return base64url(createHash("sha256").update(prevHash + canonicalize(evt)).digest());
}

/**
 * Verifica una cadena ordenada del más viejo al más nuevo: recomputa cada hash y
 * chequea que prevHash apunte al hash anterior. Devuelve el `seq` del primer eslabón roto.
 */
export function verifyChain(eventsOldestFirst: AuditEvent[]): { ok: boolean; brokenAt?: number } {
  let prev = "";
  for (const e of eventsOldestFirst) {
    const { hash, ...rest } = e;
    if (e.prevHash !== prev || computeHash(prev, rest) !== hash) {
      return { ok: false, brokenAt: e.seq };
    }
    prev = hash;
  }
  return { ok: true };
}
