/** Ed25519 primitives over RAW base64url keys (32-byte seed/point) so the host's
 *  @noble/ed25519 verifier interops. node:crypto handles DER under the hood. */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";

// Fixed ASN.1 headers for Ed25519. Prefix + 32 raw bytes = a valid DER key.
const PKCS8_SEED_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex"); // private
const SPKI_POINT_PREFIX = Buffer.from("302a300506032b6570032100", "hex"); // public

export interface Keypair {
  /** raw 32-byte public point, base64url */
  publicKey: string;
  /** raw 32-byte private seed, base64url */
  privateKey: string;
}

function privateKeyObject(seedB64url: string) {
  const seed = Buffer.from(seedB64url, "base64url");
  const der = Buffer.concat([PKCS8_SEED_PREFIX, seed]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

function publicKeyObject(pointB64url: string) {
  const point = Buffer.from(pointB64url, "base64url");
  const der = Buffer.concat([SPKI_POINT_PREFIX, point]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

export function generateKeypair(): Keypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "jwk" }) as { x: string };
  const priv = privateKey.export({ format: "jwk" }) as { d: string };
  // JWK `x`/`d` are already base64url of the raw 32-byte values.
  return { publicKey: pub.x, privateKey: priv.d };
}

export function signMessage(message: string, privateKeyB64url: string): string {
  const sig = sign(null, Buffer.from(message, "utf8"), privateKeyObject(privateKeyB64url));
  return sig.toString("base64url");
}

export function verifyMessage(
  message: string,
  signatureB64url: string,
  publicKeyB64url: string,
): boolean {
  try {
    return verify(
      null,
      Buffer.from(message, "utf8"),
      publicKeyObject(publicKeyB64url),
      Buffer.from(signatureB64url, "base64url"),
    );
  } catch {
    return false; // claves/firma malformadas → no autenticado, nunca tira
  }
}
