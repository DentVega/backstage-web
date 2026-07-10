import { describe, expect, it } from "vitest";
import { isProtectedPath } from "@/lib/auth-paths";

describe("isProtectedPath", () => {
  it.each(["/", "/catalog", "/miniapp/account_dashboard", "/create"])(
    "protects UI route %s",
    (p) => expect(isProtectedPath(p)).toBe(true),
  );
  it.each([
    "/signin",
    "/api/resolve",
    "/api/miniapps/x/upload",
    "/api/scaffold",
    "/api/seed",
    "/api/auth/callback/github",
    "/_next/static/x.js",
  ])("excludes %s", (p) => expect(isProtectedPath(p)).toBe(false));
});
