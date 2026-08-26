/** Genera un par Ed25519 (raw base64url). Uso: `node scripts/keygen.mjs [--label root]`.
 *  Imprime { publicKey, privateKey }. El privateKey va a un secret/archivo local — NUNCA se commitea. */
import { generateKeyPairSync } from "node:crypto";

export function generateKeypair() {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ format: "jwk" });
  const priv = privateKey.export({ format: "jwk" });
  return { publicKey: pub.x, privateKey: priv.d };
}

// CLI: solo cuando se ejecuta directo (no al importarse desde el test).
if (import.meta.url === `file://${process.argv[1]}`) {
  const label = process.argv.includes("--label")
    ? process.argv[process.argv.indexOf("--label") + 1]
    : "key";
  const kp = generateKeypair();
  console.log(JSON.stringify({ label, ...kp }, null, 2));
  console.error(`\n⚠️  Guardá privateKey en un secret/archivo local. NO lo commitees.`);
}
