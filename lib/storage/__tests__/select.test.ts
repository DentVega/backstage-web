import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage/r2", () => ({
  r2ConfigFromEnv: () => (process.env.R2_ACCOUNT_ID ? { accountId: "a" } : null),
  r2Storage: () => ({ __kind: "r2" }),
}));
vi.mock("@/lib/storage/blob", () => ({ blobStorage: () => ({ __kind: "blob" }) }));
vi.mock("@/lib/storage/fs", () => ({ fsStorage: () => ({ __kind: "fs" }) }));

import { getStorage } from "@/lib/storage";

afterEach(() => {
  delete process.env.R2_ACCOUNT_ID;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  vi.restoreAllMocks();
});

describe("getStorage — precedencia", () => {
  it("R2 si está configurado", () => {
    process.env.R2_ACCOUNT_ID = "a";
    expect((getStorage() as unknown as { __kind: string }).__kind).toBe("r2");
  });
  it("Blob si no hay R2 pero hay token", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    expect((getStorage() as unknown as { __kind: string }).__kind).toBe("blob");
  });
  it("fs si no hay nada", () => {
    expect((getStorage() as unknown as { __kind: string }).__kind).toBe("fs");
  });
});
