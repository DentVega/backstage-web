/** Service-token auth for the publish/upload endpoints (ADR-015). */

export class AuthError extends Error {
  readonly code = "UNAUTHORIZED";
  constructor(message = "unauthorized") {
    super(message);
    this.name = "AuthError";
  }
}

/** Throws AuthError unless the request carries the PUBLISH_TOKEN as a Bearer token. */
export function requirePublishToken(req: Request): void {
  const expected = process.env.PUBLISH_TOKEN;
  if (!expected) throw new AuthError("PUBLISH_TOKEN not configured");
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token !== expected) throw new AuthError();
}
