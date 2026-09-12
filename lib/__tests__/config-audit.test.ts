import { describe, it, expect, afterEach } from "vitest";
import { auditAdminLogins } from "../config";

afterEach(() => {
  delete process.env.AUDIT_ADMIN_LOGINS;
});

describe("auditAdminLogins", () => {
  it("parses CSV, trims, drops empties", () => {
    process.env.AUDIT_ADMIN_LOGINS = " brian, ,octocat ";
    expect(auditAdminLogins()).toEqual(["brian", "octocat"]);
  });

  it("empty when unset (fail-closed)", () => {
    expect(auditAdminLogins()).toEqual([]);
  });
});
