import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ logins: [] as string[] }));

vi.mock("@/lib/config", () => ({ githubToken: () => "t" }));
vi.mock("@/lib/git/github", () => ({
  githubProvider: () => ({
    listCollaborators: async () => state.logins.map((login) => ({ login })),
  }),
}));

import { repoCollaboratorLogins } from "@/lib/git/collaborators";

afterEach(() => vi.restoreAllMocks());

describe("repoCollaboratorLogins", () => {
  it("parsea el repoUrl y devuelve logins en minúscula", async () => {
    state.logins = ["DentVega", "Alice"];
    expect(await repoCollaboratorLogins("https://github.com/o/acc")).toEqual(["dentvega", "alice"]);
  });

  it("[] si no hay repoUrl (no se puede validar acceso)", async () => {
    state.logins = ["DentVega"];
    expect(await repoCollaboratorLogins(undefined)).toEqual([]);
  });

  it("[] si el repoUrl no es parseable", async () => {
    state.logins = ["DentVega"];
    expect(await repoCollaboratorLogins("not-a-repo")).toEqual([]);
  });
});
