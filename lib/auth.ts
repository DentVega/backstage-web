/** Service-token auth for the publish/upload endpoints (ADR-015). */
import { createHash, timingSafeEqual } from "node:crypto";
import { canScaffold } from "@/lib/scaffold-authz";
import { scaffoldAllowedLogins } from "@/lib/config";

export class AuthError extends Error {
  readonly code = "UNAUTHORIZED";
  constructor(message = "unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Tokens de publicación válidos: el `PUBLISH_TOKEN` primario más cualquier token
 * viejo aún aceptado en `PUBLISH_TOKENS_OLD` (CSV) — habilita rotación cero-downtime.
 */
function validPublishTokens(): string[] {
  const primary = process.env.PUBLISH_TOKEN ?? "";
  const old = (process.env.PUBLISH_TOKENS_OLD ?? "").split(",").map((t) => t.trim());
  return [primary, ...old].filter((t) => t.length > 0);
}

/**
 * Comparación en tiempo constante vía digests sha256 de largo fijo — evita el
 * throw de `timingSafeEqual` con largos distintos y no filtra la longitud del token.
 */
function safeEqual(a: string, b: string): boolean {
  const ah = createHash("sha256").update(a).digest();
  const bh = createHash("sha256").update(b).digest();
  return timingSafeEqual(ah, bh);
}

/** Lanza AuthError salvo que el request traiga un token de publicación válido como Bearer. */
export function requirePublishToken(req: Request): void {
  const valid = validPublishTokens();
  if (valid.length === 0) throw new AuthError("PUBLISH_TOKEN not configured");
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!valid.some((v) => safeEqual(token, v))) throw new AuthError();
}

/**
 * Autoriza un upload/publish: un usuario logueado allowlisted (flujo UI) O un
 * Bearer `PUBLISH_TOKEN` válido (flujo CI). Lanza AuthError si ninguna aplica.
 */
export async function authorizeUpload(req: Request): Promise<void> {
  const { auth } = await import("@/auth");
  const session = await auth();
  if (canScaffold(session?.githubLogin, scaffoldAllowedLogins())) return;
  requirePublishToken(req);
}
