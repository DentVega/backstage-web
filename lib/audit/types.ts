/** Tipos del audit log (spec 2026-09-12). */

export interface AuditActor {
  type: "user" | "ci";
  /** github login, o "ci" si el CI no reportó actor. */
  login: string;
  /** Solo CI: GITHUB_SHA del commit publicado. */
  commit?: string;
  /** Solo CI: "owner/repo" que publicó. */
  repo?: string;
}

export type AuditAction =
  | "publish"
  | "register"
  | "pin"
  | "patch"
  | "delete-miniapp"
  | "delete-version"
  | "set-maintainers"
  | "set-storage-provider"
  | "set-public-key"
  | "scaffold"
  | "seed";

export interface AuditEvent {
  /** 1-based, por cadena. */
  seq: number;
  /** Date.now() al momento del append. */
  ts: number;
  actor: AuditActor;
  action: AuditAction;
  /** miniapp id, o "_global". */
  chain: string;
  miniappId?: string;
  details: Record<string, unknown>;
  /** hash del evento anterior en la cadena ("" para el primero). */
  prevHash: string;
  /** sha256_base64url(prevHash + canonicalize(evento sin `hash`)). */
  hash: string;
}

export interface RecordAuditInput {
  actor: AuditActor;
  action: AuditAction;
  /** miniapp id, o "_global". */
  chain: string;
  miniappId?: string;
  details?: Record<string, unknown>;
}
