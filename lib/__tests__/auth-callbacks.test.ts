import { describe, expect, it } from "vitest";
import { jwtCallback, sessionCallback } from "@/lib/auth-callbacks";

describe("jwtCallback", () => {
  it("stores the github access token at first login", () => {
    const token = jwtCallback({ token: {}, account: { access_token: "gho_x" } as never });
    expect(token.githubAccessToken).toBe("gho_x");
  });
  it("keeps the token when no account (subsequent calls)", () => {
    const token = jwtCallback({ token: { githubAccessToken: "gho_x" }, account: null });
    expect(token.githubAccessToken).toBe("gho_x");
  });
});

describe("sessionCallback", () => {
  it("exposes the token on the session", () => {
    const session = sessionCallback({
      session: { user: {}, expires: "" } as never,
      token: { githubAccessToken: "gho_x" },
    });
    expect(session.githubAccessToken).toBe("gho_x");
  });
});
