import { describe, expect, it } from "vitest";
import { sha256Integrity } from "@/lib/integrity";

describe("sha256Integrity", () => {
  it("produces sha256-<hex> matching the known vector for 'abc'", () => {
    expect(sha256Integrity(new TextEncoder().encode("abc"))).toBe(
      "sha256-ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("hashes the empty input", () => {
    expect(sha256Integrity(new Uint8Array(0))).toBe(
      "sha256-e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });
});
