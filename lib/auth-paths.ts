/** Which pathnames require an authenticated session (UI only; APIs are excluded). */

const PROTECTED_PREFIXES = ["/catalog", "/miniapp", "/create"];

export function isProtectedPath(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname === "/signin") return false;
  if (pathname.startsWith("/api")) return false; // resolve/upload/scaffold/seed/auth
  if (pathname.startsWith("/_next")) return false;
  return PROTECTED_PREFIXES.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}
