import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeypair } from "./keygen.mjs";
import { buildSignedBundle } from "./sign-trust-bundle.mjs";
import { verify, createPublicKey } from "node:crypto";

const SPKI_POINT_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
function publicKeyObject(pointB64url) {
  const der = Buffer.concat([SPKI_POINT_PREFIX, Buffer.from(pointB64url, "base64url")]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

test("buildSignedBundle produce una firma que verifica y es determinística", () => {
  const { publicKey, privateKey } = generateKeypair();
  const args = {
    keys: { b: "kb", a: "ka" },
    version: 3,
    updatedAt: "2026-08-26T00:00:00.000Z",
    privateKey,
  };
  const signed = buildSignedBundle(args);

  // El cuerpo tiene keys ordenadas y version/updatedAt correctos.
  assert.deepEqual(Object.keys(signed.bundle.keys), ["a", "b"]);
  assert.equal(signed.bundle.version, 3);

  // La firma verifica el mensaje canónico con la pubkey.
  const canonical = JSON.stringify({
    version: 3,
    updatedAt: "2026-08-26T00:00:00.000Z",
    keys: { a: "ka", b: "kb" },
  });
  const ok = verify(
    null,
    Buffer.from(canonical, "utf8"),
    publicKeyObject(publicKey),
    Buffer.from(signed.signature, "base64url"),
  );
  assert.equal(ok, true);

  // Determinismo: mismo input → misma firma (Ed25519 es determinística).
  const again = buildSignedBundle(args);
  assert.equal(again.signature, signed.signature);
});
