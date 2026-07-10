import type { JWT } from "next-auth/jwt";
import type { Session } from "next-auth";
import type { Account } from "next-auth";

/** Store the GitHub access token on the JWT at first login (server-side only). */
export function jwtCallback(params: { token: JWT; account?: Account | null }): JWT {
  const { token, account } = params;
  if (account?.access_token) {
    token.githubAccessToken = account.access_token;
  }
  return token;
}

/** Expose the token on the session (server-side; never sent to the browser UI). */
export function sessionCallback(params: { session: Session; token: JWT }): Session {
  const { session, token } = params;
  session.githubAccessToken =
    typeof token.githubAccessToken === "string" ? token.githubAccessToken : undefined;
  return session;
}
