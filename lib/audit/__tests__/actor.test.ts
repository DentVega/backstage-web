import { describe, it, expect } from "vitest";
import { resolveActor } from "../actor";

describe("resolveActor", () => {
  it("UI session → user actor", () => {
    expect(resolveActor("brian")).toEqual({ type: "user", login: "brian" });
  });

  it("CI with actor → ci actor con commit/repo", () => {
    expect(resolveActor(null, { actor: "octocat", commit: "abc123", repo: "org/hellow" })).toEqual({
      type: "ci",
      login: "octocat",
      commit: "abc123",
      repo: "org/hellow",
    });
  });

  it("CI sin actor → fallback login 'ci'", () => {
    expect(resolveActor(null, {})).toEqual({ type: "ci", login: "ci" });
    expect(resolveActor(undefined)).toEqual({ type: "ci", login: "ci" });
  });
});
