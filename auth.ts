import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import { isProtectedPath } from "@/lib/auth-paths";
import { jwtCallback, sessionCallback } from "@/lib/auth-callbacks";

export const { handlers, auth, signIn, signOut } = NextAuth({
  // Required for non-Vercel/self-hosted (localhost) — Vercel auto-detects the host.
  trustHost: true,
  providers: [
    GitHub({ authorization: { params: { scope: "read:user" } } }),
  ],
  pages: { signIn: "/signin" },
  callbacks: {
    jwt: jwtCallback,
    session: sessionCallback,
    authorized({ auth, request }) {
      return isProtectedPath(request.nextUrl.pathname) ? Boolean(auth) : true;
    },
  },
});
