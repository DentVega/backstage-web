import type { JWT } from "next-auth/jwt";
import type { Session } from "next-auth";
import type { Account, Profile } from "next-auth";

/**
 * Store the GitHub access token + username (login) on the JWT at first login.
 * Server-side only. The login drives the scaffolder authorization (Bolt 06-2).
 */
export function jwtCallback(params: {
  token: JWT;
  account?: Account | null;
  profile?: Profile | null;
}): JWT {
  const { token, account, profile } = params;
  if (account?.access_token) {
    token.githubAccessToken = account.access_token;
  }
  const login = (profile as { login?: unknown } | null | undefined)?.login;
  if (typeof login === "string") {
    token.githubLogin = login;
  }
  return token;
}

/** Expose the token + login on the session (server-side; token never reaches the UI). */
export function sessionCallback(params: { session: Session; token: JWT }): Session {
  const { session, token } = params;
  session.githubAccessToken =
    typeof token.githubAccessToken === "string" ? token.githubAccessToken : undefined;
  session.githubLogin =
    typeof token.githubLogin === "string" ? token.githubLogin : undefined;
  return session;
}
