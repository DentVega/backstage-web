/** Arma, firma y (opcionalmente) publica el trust bundle. El root private key se pasa por
 *  --key-file <path> o env ROOT_PRIVATE_KEY (base64url) — vive local, nunca en Vercel.
 *
 *  Uso típico:
 *    node scripts/sign-trust-bundle.mjs \
 *      --base https://backstage... --token $PUBLISH_TOKEN --key-file ./root.key
 *  Lee las pubkeys de `${base}/api/miniapps`, muestra el diff vs el bundle live,
 *  bumpea version, firma, y hace PUT /api/trust-bundle. */
import { readFileSync } from "node:fs";
import { sign, createPrivateKey } from "node:crypto";

const PKCS8_SEED_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
function privateKeyObject(seedB64url) {
  const der = Buffer.concat([PKCS8_SEED_PREFIX, Buffer.from(seedB64url, "base64url")]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

function canonicalBundleMessage(body) {
  const keys = {};
  for (const k of Object.keys(body.keys).sort()) keys[k] = body.keys[k];
  return JSON.stringify({ version: body.version, updatedAt: body.updatedAt, keys });
}

/** Núcleo puro y testeable: arma el body con keys ordenadas y lo firma. */
export function buildSignedBundle({ keys, version, updatedAt, privateKey }) {
  const orderedKeys = {};
  for (const k of Object.keys(keys).sort()) orderedKeys[k] = keys[k];
  const bundle = { version, updatedAt, keys: orderedKeys };
  const signature = sign(
    null,
    Buffer.from(canonicalBundleMessage(bundle), "utf8"),
    privateKeyObject(privateKey),
  ).toString("base64url");
  return { bundle, signature };
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const base = arg("--base") ?? process.env.BACKSTAGE_URL;
  const token = arg("--token") ?? process.env.PUBLISH_TOKEN;
  const keyFile = arg("--key-file");
  const privateKey = keyFile ? readFileSync(keyFile, "utf8").trim() : process.env.ROOT_PRIVATE_KEY;
  if (!base || !privateKey) {
    console.error("Faltan --base y el root private key (--key-file o ROOT_PRIVATE_KEY).");
    process.exit(1);
  }

  // 1) Leer pubkeys actuales del catálogo.
  const miniapps = await (await fetch(`${base}/api/miniapps`)).json();
  const keys = {};
  for (const m of miniapps) if (m.publicKey) keys[m.id] = m.publicKey;

  // 2) Bundle live → bump de version + diff.
  const liveRes = await fetch(`${base}/api/trust-bundle`);
  const live = liveRes.ok ? await liveRes.json() : null;
  const nextVersion = (live?.bundle?.version ?? 0) + 1;
  console.error(`Bundle v${live?.bundle?.version ?? "∅"} → v${nextVersion}`);
  console.error("keys:", JSON.stringify(keys, null, 2));

  // 3) Firmar. `updatedAt` se pasa explícito (Date.now no está en el core testeable).
  const signed = buildSignedBundle({
    keys,
    version: nextVersion,
    updatedAt: new Date().toISOString(),
    privateKey,
  });

  // 4) Publicar.
  const put = await fetch(`${base}/api/trust-bundle`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(signed),
  });
  console.error(put.ok ? `✅ Publicado v${nextVersion}` : `❌ ${put.status}: ${await put.text()}`);
  if (!put.ok) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
