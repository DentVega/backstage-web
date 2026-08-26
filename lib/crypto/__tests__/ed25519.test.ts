import { describe, expect, it } from "vitest";
import { generateKeypair, signMessage, verifyMessage } from "@/lib/crypto/ed25519";

describe("ed25519", () => {
  it("genera un par y firma/verifica un mensaje (round-trip)", () => {
    const { publicKey, privateKey } = generateKeypair();
    const sig = signMessage("hola:android:sha256-abc", privateKey);
    expect(verifyMessage("hola:android:sha256-abc", sig, publicKey)).toBe(true);
  });

  it("rechaza un mensaje alterado", () => {
    const { publicKey, privateKey } = generateKeypair();
    const sig = signMessage("hola:android:sha256-abc", privateKey);
    expect(verifyMessage("hola:android:sha256-XXX", sig, publicKey)).toBe(false);
  });

  it("rechaza una pubkey distinta", () => {
    const a = generateKeypair();
    const b = generateKeypair();
    const sig = signMessage("m", a.privateKey);
    expect(verifyMessage("m", sig, b.publicKey)).toBe(false);
  });

  it("claves y firma son base64url (32/32/64 bytes)", () => {
    const { publicKey, privateKey } = generateKeypair();
    const sig = signMessage("m", privateKey);
    expect(Buffer.from(publicKey, "base64url")).toHaveLength(32);
    expect(Buffer.from(privateKey, "base64url")).toHaveLength(32);
    expect(Buffer.from(sig, "base64url")).toHaveLength(64);
  });

  it("verifyMessage devuelve false ante input basura (no tira)", () => {
    const { publicKey } = generateKeypair();
    expect(verifyMessage("m", "no-es-una-firma", publicKey)).toBe(false);
  });
});
