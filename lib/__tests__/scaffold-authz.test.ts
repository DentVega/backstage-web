import { afterEach, describe, expect, it } from "vitest";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { scaffoldAllowedLogins } from "@/lib/config";
import { statusForError } from "@/lib/http";

describe("canScaffold", () => {
  const allow = ["DentVega", "octocat"];

  it("allows a login on the allowlist", () => {
    expect(canScaffold("DentVega", allow)).toBe(true);
  });
  it("is case-insensitive and trims", () => {
    expect(canScaffold("  dentvega ", allow)).toBe(true);
    expect(canScaffold("OCTOCAT", allow)).toBe(true);
  });
  it("denies a login not on the allowlist", () => {
    expect(canScaffold("mallory", allow)).toBe(false);
  });
  it("fails closed on an empty allowlist", () => {
    expect(canScaffold("DentVega", [])).toBe(false);
  });
  it("denies a missing/blank login", () => {
    expect(canScaffold(null, allow)).toBe(false);
    expect(canScaffold(undefined, allow)).toBe(false);
    expect(canScaffold("   ", allow)).toBe(false);
  });
});

describe("scaffoldAllowedLogins (env parsing)", () => {
  afterEach(() => {
    delete process.env.SCAFFOLD_ALLOWED_LOGINS;
  });
  it("is empty when unset (fail-closed)", () => {
    expect(scaffoldAllowedLogins()).toEqual([]);
  });
  it("parses a CSV, trimming and dropping blanks", () => {
    process.env.SCAFFOLD_ALLOWED_LOGINS = " DentVega, octocat ,, ";
    expect(scaffoldAllowedLogins()).toEqual(["DentVega", "octocat"]);
  });
});

describe("ScaffoldForbiddenError", () => {
  it("maps to HTTP 403", () => {
    expect(statusForError(new ScaffoldForbiddenError())).toBe(403);
  });
});
