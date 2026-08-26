import { describe, expect, it } from "vitest";
import { chunkSignatureMessage, canonicalBundleMessage } from "@/lib/trust/message";

describe("chunkSignatureMessage", () => {
  it("arma id:platform:integrity", () => {
    expect(chunkSignatureMessage("hellow_widget", "ios", "sha256-abc")).toBe(
      "hellow_widget:ios:sha256-abc",
    );
  });
});

describe("canonicalBundleMessage", () => {
  it("ordena las keys determinísticamente (independiente del orden de inserción)", () => {
    const a = canonicalBundleMessage({
      version: 1,
      updatedAt: "2026-08-26T00:00:00.000Z",
      keys: { b: "kb", a: "ka" },
    });
    const b = canonicalBundleMessage({
      version: 1,
      updatedAt: "2026-08-26T00:00:00.000Z",
      keys: { a: "ka", b: "kb" },
    });
    expect(a).toBe(b);
    expect(a).toBe('{"version":1,"updatedAt":"2026-08-26T00:00:00.000Z","keys":{"a":"ka","b":"kb"}}');
  });
});
