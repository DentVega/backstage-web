import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Importar @/lib/auth carga authorizeUpload → @/auth: mockear para no inicializar NextAuth.
vi.mock("@/auth", () => ({ auth: vi.fn(async () => null) }));

import { requirePublishToken, authorizeUpload, AuthError } from "@/lib/auth";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;

function req(authorization?: string): Request {
  return new Request("http://x/api/upload", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

const OLD = process.env;
beforeEach(() => {
  process.env = { ...OLD };
  delete process.env.PUBLISH_TOKEN;
  delete process.env.PUBLISH_TOKENS_OLD;
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
  authMock.mockResolvedValue(null);
});
afterEach(() => {
  process.env = OLD;
  vi.restoreAllMocks();
});

describe("requirePublishToken — dual token", () => {
  it("acepta el token primario", () => {
    process.env.PUBLISH_TOKEN = "new-strong";
    expect(() => requirePublishToken(req("Bearer new-strong"))).not.toThrow();
  });

  it("acepta un token viejo aún en PUBLISH_TOKENS_OLD (transición)", () => {
    process.env.PUBLISH_TOKEN = "new-strong";
    process.env.PUBLISH_TOKENS_OLD = "old-weak";
    expect(() => requirePublishToken(req("Bearer old-weak"))).not.toThrow();
  });

  it("acepta cualquiera de varios tokens viejos (CSV con espacios/vacíos)", () => {
    process.env.PUBLISH_TOKEN = "new-strong";
    process.env.PUBLISH_TOKENS_OLD = " old-a , , old-b ";
    expect(() => requirePublishToken(req("Bearer old-b"))).not.toThrow();
  });

  it("rechaza un token desconocido", () => {
    process.env.PUBLISH_TOKEN = "new-strong";
    expect(() => requirePublishToken(req("Bearer nope"))).toThrow(AuthError);
  });

  it("rechaza header ausente o mal formado", () => {
    process.env.PUBLISH_TOKEN = "new-strong";
    expect(() => requirePublishToken(req())).toThrow(AuthError);
    expect(() => requirePublishToken(req("new-strong"))).toThrow(AuthError);
  });

  it("lanza 'not configured' si no hay ningún token en env", () => {
    expect(() => requirePublishToken(req("Bearer x"))).toThrow("PUBLISH_TOKEN not configured");
  });
});

describe("authorizeUpload", () => {
  it("pasa con sesión allowlisted (sin token)", async () => {
    process.env.SCAFFOLD_ALLOWED_LOGINS = "DentVega";
    authMock.mockResolvedValue({ githubLogin: "DentVega" });
    await expect(authorizeUpload(req())).resolves.toBeUndefined();
  });

  it("cae al token cuando no hay sesión allowlisted", async () => {
    process.env.PUBLISH_TOKEN = "new-strong";
    authMock.mockResolvedValue(null);
    await expect(authorizeUpload(req("Bearer new-strong"))).resolves.toBeUndefined();
    await expect(authorizeUpload(req("Bearer nope"))).rejects.toBeInstanceOf(AuthError);
  });
});
