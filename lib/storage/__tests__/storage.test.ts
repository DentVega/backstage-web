import { describe, expect, it, vi } from "vitest";

vi.mock("@vercel/blob", () => ({
  put: vi.fn(async (pathname: string) => ({ url: `https://store.blob/${pathname}` })),
}));

import { put } from "@vercel/blob";
import { blobStorage } from "@/lib/storage/blob";
import { mockStorage } from "@/lib/storage/mock";
import type { StorageFile } from "@/lib/storage/types";

const files: StorageFile[] = [
  { path: "account_dashboard.container.js.bundle", data: new Uint8Array([1]) },
  { path: "vendors-x.chunk.bundle", data: new Uint8Array([2]) },
];

describe("blobStorage", () => {
  it("uploads every file under the prefix and derives the base url", async () => {
    const store = blobStorage("test-token");
    const { baseUrl } = await store.putMany("account_dashboard/0.1.0", files);
    expect(put).toHaveBeenCalledTimes(2);
    expect(baseUrl).toBe("https://store.blob/account_dashboard/0.1.0");
  });
});

describe("mockStorage", () => {
  it("records the uploaded files", async () => {
    const sink: { prefix: string; files: StorageFile[] }[] = [];
    const { baseUrl } = await mockStorage(sink).putMany("id/1.0.0", files);
    expect(baseUrl).toBe("https://mock.blob/id/1.0.0");
    expect(sink[0].files).toHaveLength(2);
  });
});
