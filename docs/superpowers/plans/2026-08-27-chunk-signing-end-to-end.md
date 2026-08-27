# Firma de chunks end-to-end — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Activar la firma de chunks end-to-end — el contrato lleva `signature`, el CI de cada miniapp firma su chunk, y el host **verifica** la firma (modo warn→enforce) contra un trust bundle firmado por el root.

**Architecture:** Tres repos. (A) `miniapp-contract` (en el host) suma `Manifest.signature?`. (B) `miniapp-template` firma en `publish.mjs` con `MINIAPP_SIGN_KEY` y manda el campo `signature`. (C) `host-runtime` verifica con `@noble/curves` contra la pubkey que saca de `GET /api/trust-bundle` (firmado por la `ROOT_PUBLIC_KEY` pineada). Todo aditivo; el host arranca en **warn** (verifica + métrica, monta igual) y se flipea a **enforce** con un flag build-time.

**Tech Stack:** TypeScript, jest (host-runtime), `node:test` (scripts .mjs), `@noble/curves/ed25519` (host, Hermes-safe), `node:crypto` Ed25519 (CI), `fflate` (extraer el container del zip en el CI).

## Global Constraints

- **Repos y paths:** contrato + host = `/Volumes/SSDExterno/prodproyects/backstagereactnative`; template = `/Volumes/SSDExterno/prodproyects/miniapp-template`; backstage-web = `/Volumes/SSDExterno/prodproyects/backstage-web`.
- **Mensaje firmado:** exactamente `` `${id}:${platform}:${integrity}` `` con `integrity = sha256-<hex>` del **`<id>.container.js.bundle` extraído del zip** (idéntico a lo que el server ya hashea). `platform` ∈ `"android" | "ios"`.
- **Claves/firma:** Ed25519 raw en **base64url** (pubkey 32 bytes, seed 32 bytes, firma 64 bytes). Interoperan node:crypto (backend/CI) y `@noble/curves` (host).
- **Aditivo, sin migración:** campos opcionales; sin firma/sin root key ⇒ el host no rompe (integridad sha256 sigue igual).
- **Activación host:** flag build-time `__SIGNATURE_MODE__` ∈ `'warn' | 'enforce'` (default `'warn'`) + `__ROOT_PUBLIC_KEY__` (default `''`). Sin root key ⇒ verificación **off** (skip) sin importar el modo. **NO** remoto (evita downgrade attack).
- **Contract bump:** 0.3.0 → **0.4.0** (campo opcional = minor). El host lo consume por workspace `src` (sin publicar); backstage-web lo consume publicado (owner-gated, Fase D).
- **Comandos:** host-runtime → `pnpm --filter @dentvega/host-runtime test` y `... typecheck`; contract → `pnpm --filter @dentvega/miniapp-contract test`; scripts .mjs → `node --test <archivo>`.

## File Structure

**Contrato (host repo):**
- `packages/miniapp-contract/src/types.ts` (modificar) — `Manifest.signature?`.
- `packages/miniapp-contract/src/guards.ts` (modificar) — validar `signature`.
- `packages/miniapp-contract/package.json` (modificar) — version bump.

**Template:**
- `scripts/publish.mjs` (modificar) — firma el chunk.
- `scripts/sign-chunk.mjs` (nuevo) — core puro y testeable (extraer container → integrity → firmar).
- `scripts/sign-chunk.test.mjs` (nuevo).
- `.github/workflows/publish.yml` (modificar) — secret `MINIAPP_SIGN_KEY`.
- `package.json` (modificar) — dep `fflate`.

**Host (host repo, `packages/host-runtime/src/`):**
- `base64url.ts` (nuevo) — decoder Hermes-safe.
- `signatureMessage.ts` (nuevo) — builder del mensaje.
- `trustBundle.ts` (nuevo) — client + verify de la firma root.
- `signature.ts` (nuevo) — `SignatureVerifier`.
- `loaderState.ts` (modificar) — razones nuevas.
- `useMiniapp.ts` (modificar) — wire warn/enforce.
- `index.ts` (modificar) — re-exports.
- `package.json` (modificar) — dep `@noble/curves`.
- `apps/host/src/globals.d.ts`, `apps/host/rspack.config.mjs`, `apps/host/src/hostProvided.ts`, `apps/host/src/screens/MiniappScreen.tsx` (modificar) — config injection + wiring.

---

## FASE A — Contrato

### Task A1: `Manifest.signature?` + guard + version bump

**Files:**
- Modify: `packages/miniapp-contract/src/types.ts:37-52`
- Modify: `packages/miniapp-contract/src/guards.ts:45`
- Modify: `packages/miniapp-contract/package.json` (version)
- Test: `packages/miniapp-contract/src/__tests__/guards.test.ts`

**Interfaces:**
- Produces: `Manifest.signature?: string` (leído por el host y backstage-web); `isManifest` acepta `signature` string / rechaza no-string.

- [ ] **Step 1: Write the failing test** — agregar a `guards.test.ts`:

```ts
it("acepta signature string y rechaza signature no-string", () => {
  const base = { id: "acc", version: "1.0.0", entry: "./Entry", shared: [], capabilities: [] };
  expect(isManifest({ ...base, signature: "ed-b64url" })).toBe(true);
  expect(isManifest({ ...base, signature: 123 })).toBe(false);
});
```

- [ ] **Step 2: Run it — should fail** (signature no validado / `123` pasa)

Run: `cd /Volumes/SSDExterno/prodproyects/backstagereactnative && pnpm --filter @dentvega/miniapp-contract test`
Expected: FAIL en el caso `signature: 123`.

- [ ] **Step 3: Add the field** — `types.ts`, dentro de `interface Manifest`, después de `integrity?`:

```ts
  /** Firma Ed25519 (base64url) del chunk, sobre `${id}:${platform}:${integrity}`.
   *  El host la verifica contra la pubkey del trust bundle. Opcional/aditivo. */
  readonly signature?: string;
```

- [ ] **Step 4: Validate in the guard** — `guards.ts`, junto a la línea de `integrity` (~45):

```ts
  if (o.signature !== undefined && typeof o.signature !== "string") return false;
```

- [ ] **Step 5: Run tests — should pass**

Run: `pnpm --filter @dentvega/miniapp-contract test`
Expected: PASS.

- [ ] **Step 6: Bump version** — `packages/miniapp-contract/package.json`: `"version": "0.3.0"` → `"version": "0.4.0"`.

- [ ] **Step 7: Typecheck + commit** (host repo)

```bash
cd /Volumes/SSDExterno/prodproyects/backstagereactnative
pnpm --filter @dentvega/miniapp-contract typecheck
git add packages/miniapp-contract/src/types.ts packages/miniapp-contract/src/guards.ts \
        packages/miniapp-contract/src/__tests__/guards.test.ts packages/miniapp-contract/package.json
git commit -m "feat(contract): Manifest.signature? + guard; bump 0.4.0"
```

> **Owner-gated (no en este plan):** publicar `@dentvega/miniapp-contract@0.4.0` a GitHub Packages (`PUBLISHING.md`). El host lo consume por workspace `src` → ve `signature?` sin publicar. backstage-web lo consume publicado (Fase D).

---

## FASE B — Firma en el CI (template)

### Task B1: `sign-chunk.mjs` (core) + integración en `publish.mjs`

**Files:**
- Create: `scripts/sign-chunk.mjs` (miniapp-template)
- Create: `scripts/sign-chunk.test.mjs`
- Modify: `scripts/publish.mjs` (miniapp-template) — `upload()` + firma
- Modify: `package.json` (miniapp-template) — dep `fflate`

**Interfaces:**
- Produces: `signChunk({ zipBytes, id, platform, privateKeyB64url }): { integrity, signature } | null` — extrae `${id}.container.js.bundle` del zip, calcula `sha256-<hex>`, firma `${id}:${platform}:${integrity}`. `null` si no hay clave.

- [ ] **Step 1: Write the failing test** — `scripts/sign-chunk.test.mjs`:

```mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { zipSync } from "fflate";
import { generateKeyPairSync, verify, createPublicKey, createHash } from "node:crypto";
import { signChunk } from "./sign-chunk.mjs";

const SPKI = Buffer.from("302a300506032b6570032100", "hex");
const pubObj = (xB64url) =>
  createPublicKey({ key: Buffer.concat([SPKI, Buffer.from(xB64url, "base64url")]), format: "der", type: "spki" });

test("signChunk firma id:platform:integrity del container extraído del zip", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const priv = privateKey.export({ format: "jwk" }).d;
  const pub = publicKey.export({ format: "jwk" }).x;

  const container = new Uint8Array([10, 20, 30]);
  const zipBytes = zipSync({ "acc.container.js.bundle": container, "vendors.chunk.bundle": new Uint8Array([1]) });

  const out = signChunk({ zipBytes, id: "acc", platform: "android", privateKeyB64url: priv });
  const expectedIntegrity = `sha256-${createHash("sha256").update(Buffer.from(container)).digest("hex")}`;
  assert.equal(out.integrity, expectedIntegrity);

  const msg = `acc:android:${expectedIntegrity}`;
  const ok = verify(null, Buffer.from(msg, "utf8"), pubObj(pub), Buffer.from(out.signature, "base64url"));
  assert.equal(ok, true);
});

test("signChunk devuelve null sin clave", () => {
  const zipBytes = zipSync({ "acc.container.js.bundle": new Uint8Array([1]) });
  assert.equal(signChunk({ zipBytes, id: "acc", platform: "android", privateKeyB64url: "" }), null);
});
```

- [ ] **Step 2: Add `fflate` + run test to fail**

```bash
cd /Volumes/SSDExterno/prodproyects/miniapp-template
pnpm add -D fflate
node --test scripts/sign-chunk.test.mjs
```
Expected: FAIL — `./sign-chunk.mjs` no existe.

- [ ] **Step 3: Implement `scripts/sign-chunk.mjs`**

```mjs
/** Firma el chunk para el publish. Extrae `${id}.container.js.bundle` del zip (los MISMOS
 *  bytes que el server hashea), calcula sha256-<hex>, y firma `${id}:${platform}:${integrity}`
 *  con Ed25519. Devuelve null si no hay clave (degradación segura). */
import { unzipSync } from "fflate";
import { createHash, createPrivateKey, sign } from "node:crypto";

const PKCS8_SEED_PREFIX = Buffer.from("302e020100300506032b657004220420", "hex");
function privateKeyObject(seedB64url) {
  const der = Buffer.concat([PKCS8_SEED_PREFIX, Buffer.from(seedB64url, "base64url")]);
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

export function signChunk({ zipBytes, id, platform, privateKeyB64url }) {
  if (!privateKeyB64url) return null;
  const files = unzipSync(zipBytes instanceof Uint8Array ? zipBytes : new Uint8Array(zipBytes));
  const container = files[`${id}.container.js.bundle`];
  if (!container) throw new Error(`sign-chunk: falta ${id}.container.js.bundle en el zip`);
  const integrity = `sha256-${createHash("sha256").update(Buffer.from(container)).digest("hex")}`;
  const msg = `${id}:${platform}:${integrity}`;
  const signature = sign(null, Buffer.from(msg, "utf8"), privateKeyObject(privateKeyB64url)).toString("base64url");
  return { integrity, signature };
}
```

- [ ] **Step 4: Run test — should pass**

Run: `node --test scripts/sign-chunk.test.mjs`
Expected: PASS (2 tests).

- [ ] **Step 5: Wire into `scripts/publish.mjs`** — importar y firmar dentro de `upload()`.

En el tope del archivo, sumar el import:
```js
import { readFileSync } from "node:fs";  // (ya existe; no duplicar)
import { signChunk } from "./sign-chunk.mjs";
```
Reemplazar el cuerpo de `upload(zipPath, platform)` (líneas ~59-76) para leer los bytes una vez, firmar, y sumar el campo:
```js
async function upload(zipPath, platform) {
  const zipBytes = readFileSync(zipPath);
  const form = new FormData();
  form.set("file", new Blob([zipBytes]), "build.zip");
  form.set("version", String(version));
  form.set("manifest", JSON.stringify({ ...manifest, version }));
  form.set("platform", platform);
  const signed = signChunk({ zipBytes, id, platform, privateKeyB64url: process.env.MINIAPP_SIGN_KEY });
  if (signed) form.set("signature", signed.signature);
  const res = await fetch(`${backstageUrl}/api/miniapps/${id}/upload`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: form,
  });
  const body = await res.text();
  if (!res.ok) {
    console.error(`publish [${platform}] failed: HTTP ${res.status} ${body}`);
    process.exit(1);
  }
  const signedTag = signed ? " [signed]" : "";
  console.log(`published ${id}@${version} [${platform}]${signedTag} (latest was ${latest ?? "none"}): ${body}`);
}
```

- [ ] **Step 6: Typecheck-ish + commit** (template)

```bash
node --check scripts/publish.mjs && node --check scripts/sign-chunk.mjs
git add scripts/sign-chunk.mjs scripts/sign-chunk.test.mjs scripts/publish.mjs package.json pnpm-lock.yaml
git commit -m "feat(publish): firma el chunk con MINIAPP_SIGN_KEY (degrada sin clave)"
```

### Task B2: `publish.yml` — secret `MINIAPP_SIGN_KEY`

**Files:**
- Modify: `.github/workflows/publish.yml` (miniapp-template)

**Interfaces:**
- Consumes: `signChunk` lee `process.env.MINIAPP_SIGN_KEY` (Task B1).
- Produces: el workflow reusable declara y pasa el secret (opcional).

- [ ] **Step 1: Declare the secret** — en `on.workflow_call.secrets` (después de `PUBLISH_TOKEN`):

```yaml
      MINIAPP_SIGN_KEY:
        required: false
```

- [ ] **Step 2: Pass it to the publish step** — en el `env:` del step "Publish to Backstage":

```yaml
          MINIAPP_SIGN_KEY: ${{ secrets.MINIAPP_SIGN_KEY }}
```

- [ ] **Step 3: Commit** (template)

```bash
git add .github/workflows/publish.yml
git commit -m "ci(publish): declara y pasa el secret opcional MINIAPP_SIGN_KEY"
```

> **Owner-gated:** setear el secret `MINIAPP_SIGN_KEY` en cada repo de miniapp. `publish.yml` llega a la flota instant (`@main`); `publish.mjs`+`sign-chunk.mjs` llegan por template-sync (lagged). Sin el secret, `signChunk` devuelve null → publica sin firma (seguro).

---

## FASE C — Verificación en el host (`packages/host-runtime`)

### Task C1: `signatureMessage` + `base64url` helpers

**Files:**
- Create: `packages/host-runtime/src/signatureMessage.ts`
- Create: `packages/host-runtime/src/base64url.ts`
- Test: `packages/host-runtime/src/__tests__/signatureMessage.test.ts`

**Interfaces:**
- Produces: `signatureMessage(id, platform, integrity): string`; `b64urlToBytes(s): Uint8Array` (Hermes-safe, sin Buffer/atob).

- [ ] **Step 1: Write the failing test** — `signatureMessage.test.ts`:

```ts
import { signatureMessage } from "../signatureMessage";
import { b64urlToBytes } from "../base64url";

describe("signatureMessage", () => {
  it("arma id:platform:integrity", () => {
    expect(signatureMessage("acc", "ios", "sha256-abc")).toBe("acc:ios:sha256-abc");
  });
});
describe("b64urlToBytes", () => {
  it("decodifica base64url a bytes (sin padding, url-safe)", () => {
    // "hi" = [104,105] → base64 "aGk=" → base64url "aGk"
    expect(Array.from(b64urlToBytes("aGk"))).toEqual([104, 105]);
    // bytes con chars url-safe: 0xfb 0xff 0xbf → base64 "+/+/" → base64url "-_-_"
    expect(Array.from(b64urlToBytes("-_-_"))).toEqual([251, 255, 191]);
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `cd /Volumes/SSDExterno/prodproyects/backstagereactnative && pnpm --filter @dentvega/host-runtime test signatureMessage`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 3: Implement `base64url.ts`**

```ts
/** base64url → bytes, puro (Hermes: sin Buffer ni atob confiables). */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const LOOKUP: Record<string, number> = {};
for (let i = 0; i < ALPHABET.length; i++) LOOKUP[ALPHABET[i]] = i;

export function b64urlToBytes(s: string): Uint8Array {
  const clean = s.replace(/=+$/, "");
  const out = new Uint8Array(Math.floor((clean.length * 6) / 8));
  let bits = 0;
  let value = 0;
  let o = 0;
  for (let i = 0; i < clean.length; i++) {
    const idx = LOOKUP[clean[i]];
    if (idx === undefined) throw new Error("base64url inválido");
    value = (value << 6) | idx;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (value >> bits) & 0xff;
    }
  }
  return out;
}
```

- [ ] **Step 4: Implement `signatureMessage.ts`**

```ts
/** Mensaje que firma el CI y reconstruye el host: id:platform:integrity. */
export function signatureMessage(id: string, platform: string, integrity: string): string {
  return `${id}:${platform}:${integrity}`;
}
```

- [ ] **Step 5: Run — should pass**

Run: `pnpm --filter @dentvega/host-runtime test signatureMessage`
Expected: PASS.

- [ ] **Step 6: Commit** (host repo)

```bash
git add packages/host-runtime/src/signatureMessage.ts packages/host-runtime/src/base64url.ts \
        packages/host-runtime/src/__tests__/signatureMessage.test.ts
git commit -m "feat(host-runtime): signatureMessage + base64url decoder (Hermes-safe)"
```

### Task C2: Trust bundle client (fetch + verify firma root)

**Files:**
- Modify: `packages/host-runtime/package.json` — dep `@noble/curves`
- Create: `packages/host-runtime/src/trustBundle.ts`
- Test: `packages/host-runtime/src/__tests__/trustBundle.test.ts`

**Interfaces:**
- Consumes: `b64urlToBytes` (C1), `@noble/curves/ed25519`.
- Produces:
  - `canonicalBundleMessage(body): string` (espeja backstage-web: keys ordenadas).
  - `httpTrustBundleClient(baseUrl, rootPublicKeyB64url, fetchImpl?): { keys(): Promise<Record<string,string> | null> }` — GET `${baseUrl}/api/trust-bundle`, verifica la firma root, devuelve el mapa `keys` o `null` (sin bundle / firma inválida / sin root key). Cachea el resultado en memoria (session).

- [ ] **Step 1: Add the dep**

Run: `cd /Volumes/SSDExterno/prodproyects/backstagereactnative && pnpm --filter @dentvega/host-runtime add @noble/curves`

- [ ] **Step 2: Write the failing test** — `trustBundle.test.ts`:

```ts
import { ed25519 } from "@noble/curves/ed25519";
import { httpTrustBundleClient, canonicalBundleMessage } from "../trustBundle";
import { b64urlToBytes } from "../base64url";

const bytesToB64url = (b: Uint8Array) =>
  Buffer.from(b).toString("base64url"); // solo en el test (node), no en prod

function makeBundle(rootPriv: Uint8Array, keys: Record<string, string>) {
  const body = { version: 1, updatedAt: "2026-08-27T00:00:00.000Z", keys };
  const sig = ed25519.sign(new TextEncoder().encode(canonicalBundleMessage(body)), rootPriv);
  return { bundle: body, signature: bytesToB64url(sig) };
}
const fetchOf = (obj: unknown, ok = true) =>
  (async () => ({ ok, json: async () => obj, status: ok ? 200 : 404 })) as unknown as typeof fetch;

describe("httpTrustBundleClient", () => {
  const rootPriv = ed25519.utils.randomPrivateKey();
  const rootPub = bytesToB64url(ed25519.getPublicKey(rootPriv));

  it("devuelve el mapa keys cuando la firma root verifica", async () => {
    const signed = makeBundle(rootPriv, { acc: "PKacc" });
    const client = httpTrustBundleClient("http://x", rootPub, fetchOf(signed));
    expect(await client.keys()).toEqual({ acc: "PKacc" });
  });

  it("devuelve null si la firma root no verifica", async () => {
    const other = ed25519.utils.randomPrivateKey();
    const signed = makeBundle(other, { acc: "PKacc" }); // firmado con otra root
    const client = httpTrustBundleClient("http://x", rootPub, fetchOf(signed));
    expect(await client.keys()).toBeNull();
  });

  it("devuelve null sin root key pineada", async () => {
    const signed = makeBundle(rootPriv, { acc: "PKacc" });
    const client = httpTrustBundleClient("http://x", "", fetchOf(signed));
    expect(await client.keys()).toBeNull();
  });

  it("devuelve null si el endpoint da 404", async () => {
    const client = httpTrustBundleClient("http://x", rootPub, fetchOf({}, false));
    expect(await client.keys()).toBeNull();
  });
});
```

- [ ] **Step 3: Run — should fail**

Run: `pnpm --filter @dentvega/host-runtime test trustBundle`
Expected: FAIL — `../trustBundle` no existe.

- [ ] **Step 4: Implement `trustBundle.ts`**

```ts
import { ed25519 } from "@noble/curves/ed25519";
import { b64urlToBytes } from "./base64url";

export interface TrustBundleBody {
  readonly version: number;
  readonly updatedAt: string;
  readonly keys: Readonly<Record<string, string>>;
}
export interface SignedTrustBundle {
  readonly bundle: TrustBundleBody;
  readonly signature: string;
}

/** Igual que el backend: keys ordenadas alfabéticamente, JSON determinístico. */
export function canonicalBundleMessage(body: TrustBundleBody): string {
  const keys: Record<string, string> = {};
  for (const k of Object.keys(body.keys).sort()) keys[k] = body.keys[k];
  return JSON.stringify({ version: body.version, updatedAt: body.updatedAt, keys });
}

export interface TrustBundleClient {
  keys(): Promise<Record<string, string> | null>;
}

export function httpTrustBundleClient(
  baseUrl: string,
  rootPublicKeyB64url: string,
  fetchImpl: typeof fetch = fetch,
): TrustBundleClient {
  let cache: Record<string, string> | null | undefined; // undefined = no consultado aún
  return {
    async keys() {
      if (cache !== undefined) return cache;
      cache = await load();
      return cache;
    },
  };

  async function load(): Promise<Record<string, string> | null> {
    if (!rootPublicKeyB64url) return null; // sin root key pineada ⇒ off
    try {
      const res = await fetchImpl(`${baseUrl}/api/trust-bundle`);
      if (!res.ok) return null;
      const signed = (await res.json()) as SignedTrustBundle;
      if (!signed?.bundle || typeof signed.signature !== "string") return null;
      const msg = new TextEncoder().encode(canonicalBundleMessage(signed.bundle));
      const ok = ed25519.verify(
        b64urlToBytes(signed.signature),
        msg,
        b64urlToBytes(rootPublicKeyB64url),
      );
      if (!ok) return null;
      return { ...signed.bundle.keys };
    } catch {
      return null;
    }
  }
}
```

- [ ] **Step 5: Run — should pass**

Run: `pnpm --filter @dentvega/host-runtime test trustBundle`
Expected: PASS (4 tests).

- [ ] **Step 6: Commit** (host repo)

```bash
git add packages/host-runtime/package.json ../../pnpm-lock.yaml \
        packages/host-runtime/src/trustBundle.ts packages/host-runtime/src/__tests__/trustBundle.test.ts
git commit -m "feat(host-runtime): trust bundle client + verify de la firma root (@noble/curves)"
```
> Nota: el `pnpm-lock.yaml` vive en la raíz del monorepo host; ajustá el path del `git add` si difiere.

### Task C3: `SignatureVerifier`

**Files:**
- Create: `packages/host-runtime/src/signature.ts`
- Test: `packages/host-runtime/src/__tests__/signature.test.ts`

**Interfaces:**
- Consumes: `TrustBundleClient` (C2), `signatureMessage` + `b64urlToBytes` (C1), `@noble/curves/ed25519`.
- Produces:
  - `type SignatureResult = "ok" | "missing" | "invalid" | "unknown-key" | "skip";`
  - `interface SignatureVerifier { verify(resolved: ResolveResponse, platform: string): Promise<SignatureResult>; }`
  - `signatureVerifier(bundle: TrustBundleClient): SignatureVerifier`.

- [ ] **Step 1: Write the failing test** — `signature.test.ts`:

```ts
import { ed25519 } from "@noble/curves/ed25519";
import { signatureVerifier } from "../signature";
import { signatureMessage } from "../signatureMessage";
import type { ResolveResponse } from "@dentvega/miniapp-contract";

const b64url = (b: Uint8Array) => Buffer.from(b).toString("base64url");
const bundleOf = (keys: Record<string, string> | null) => ({ keys: async () => keys });

function resolved(signature?: string, integrity = "sha256-abc"): ResolveResponse {
  return {
    id: "acc" as never, version: "1.0.0" as never, url: "u",
    manifest: { id: "acc" as never, version: "1.0.0" as never, entry: "./E", shared: [], capabilities: [], integrity, signature },
  };
}

describe("signatureVerifier", () => {
  const priv = ed25519.utils.randomPrivateKey();
  const pub = b64url(ed25519.getPublicKey(priv));
  const sigFor = (msg: string) => b64url(ed25519.sign(new TextEncoder().encode(msg), priv));

  it("ok cuando la firma verifica contra la pubkey del bundle", async () => {
    const sig = sigFor(signatureMessage("acc", "android", "sha256-abc"));
    const v = signatureVerifier(bundleOf({ acc: pub }));
    expect(await v.verify(resolved(sig), "android")).toBe("ok");
  });
  it("invalid cuando la firma no corresponde", async () => {
    const v = signatureVerifier(bundleOf({ acc: pub }));
    expect(await v.verify(resolved("firma-mala"), "android")).toBe("invalid");
  });
  it("missing cuando no hay signature en el manifest", async () => {
    const v = signatureVerifier(bundleOf({ acc: pub }));
    expect(await v.verify(resolved(undefined), "android")).toBe("missing");
  });
  it("unknown-key cuando la miniapp no está en el bundle", async () => {
    const sig = sigFor(signatureMessage("acc", "android", "sha256-abc"));
    const v = signatureVerifier(bundleOf({ otra: pub }));
    expect(await v.verify(resolved(sig), "android")).toBe("unknown-key");
  });
  it("skip cuando no hay bundle (root key off)", async () => {
    const v = signatureVerifier(bundleOf(null));
    expect(await v.verify(resolved("x"), "android")).toBe("skip");
  });
});
```

- [ ] **Step 2: Run — should fail**

Run: `pnpm --filter @dentvega/host-runtime test signature`
Expected: FAIL — `../signature` no existe.

- [ ] **Step 3: Implement `signature.ts`**

```ts
import { ed25519 } from "@noble/curves/ed25519";
import type { ResolveResponse } from "@dentvega/miniapp-contract";
import { b64urlToBytes } from "./base64url";
import { signatureMessage } from "./signatureMessage";
import type { TrustBundleClient } from "./trustBundle";

export type SignatureResult = "ok" | "missing" | "invalid" | "unknown-key" | "skip";

export interface SignatureVerifier {
  verify(resolved: ResolveResponse, platform: string): Promise<SignatureResult>;
}

export function signatureVerifier(bundle: TrustBundleClient): SignatureVerifier {
  return {
    async verify(resolved, platform) {
      const keys = await bundle.keys();
      if (keys === null) return "skip"; // sin root key / bundle ⇒ verificación off
      const pubkey = keys[resolved.id];
      if (pubkey === undefined) return "unknown-key";
      const sig = resolved.manifest.signature;
      const integrity = resolved.manifest.integrity;
      if (!sig || !integrity) return "missing";
      try {
        const msg = new TextEncoder().encode(signatureMessage(resolved.id, platform, integrity));
        const ok = ed25519.verify(b64urlToBytes(sig), msg, b64urlToBytes(pubkey));
        return ok ? "ok" : "invalid";
      } catch {
        return "invalid";
      }
    },
  };
}
```

- [ ] **Step 4: Run — should pass**

Run: `pnpm --filter @dentvega/host-runtime test signature`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit** (host repo)

```bash
git add packages/host-runtime/src/signature.ts packages/host-runtime/src/__tests__/signature.test.ts
git commit -m "feat(host-runtime): SignatureVerifier (ok/missing/invalid/unknown-key/skip)"
```

### Task C4: Fallback reasons nuevas

**Files:**
- Modify: `packages/host-runtime/src/loaderState.ts:3-20`
- Modify: `packages/host-runtime/src/index.ts` (si re-exporta el tipo — ya lo hace)
- Test: `packages/host-runtime/src/__tests__/loaderState.test.ts` (crear si no existe, o agregar)

**Interfaces:**
- Produces: `FallbackReason` += `'invalid-signature' | 'unknown-key'`, ambas **no-retryable**.

- [ ] **Step 1: Write the failing test** — agregar/crear `loaderState.test.ts`:

```ts
import { isRetryable } from "../loaderState";
import type { FallbackReason } from "../loaderState";

describe("isRetryable — razones de firma", () => {
  it("invalid-signature y unknown-key NO son retryables", () => {
    expect(isRetryable("invalid-signature")).toBe(false);
    expect(isRetryable("unknown-key")).toBe(false);
  });
  it("integrity-failed sigue retryable", () => {
    expect(isRetryable("integrity-failed")).toBe(true);
  });
  it("acepta las razones nuevas como FallbackReason (typecheck)", () => {
    const a: FallbackReason = "invalid-signature";
    const b: FallbackReason = "unknown-key";
    expect([a, b]).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run — should fail** (typecheck: los literales no existen en el union)

Run: `pnpm --filter @dentvega/host-runtime test loaderState`
Expected: FAIL.

- [ ] **Step 3: Add the reasons** — `loaderState.ts`, en el union `FallbackReason` (después de `"host-too-old"`):

```ts
  | "invalid-signature"
  | "unknown-key"
```
(No agregarlas a `RETRYABLE_REASONS` — son permanentes.)

- [ ] **Step 4: Run — should pass**

Run: `pnpm --filter @dentvega/host-runtime test loaderState`
Expected: PASS.

- [ ] **Step 5: Commit** (host repo)

```bash
git add packages/host-runtime/src/loaderState.ts packages/host-runtime/src/__tests__/loaderState.test.ts
git commit -m "feat(host-runtime): fallback reasons invalid-signature / unknown-key (no-retryable)"
```

### Task C5: Wire en `useMiniapp` (warn/enforce)

**Files:**
- Modify: `packages/host-runtime/src/useMiniapp.ts:49-128`
- Test: `packages/host-runtime/src/__tests__/useMiniapp-signature.test.ts` (nuevo) o el loader test existente

**Interfaces:**
- Consumes: `SignatureVerifier` (C3), la razón de fallback (C4). El deps object de `useMiniapp` suma `signature?: SignatureVerifier`, `signatureMode?: 'warn' | 'enforce'`, y el `platform` que ya se inyecta al `ResolveRequest`.
- Produces: en **warn**, un resultado no-`ok`/`skip` monta igual + emite métrica; en **enforce**, falla con la razón tipada (no monta).

- [ ] **Step 1: Write the failing test** — `useMiniapp-signature.test.ts`. Seguir el patrón del `loader.test.ts` existente (renderHook + deps mockeados). Estructura:

```ts
// Pseudo-estructura — adaptar a los helpers reales de loader.test.ts (renderHook, deps mock).
// Dado un signatureVerifier que devuelve "invalid":
//  - signatureMode "warn"  → el estado final es "ready" (montó) y se llamó metrics con "invalid-signature".
//  - signatureMode "enforce" → el estado final es "fallback" con reason "invalid-signature".
// Dado signatureVerifier "skip" → monta normal, sin métrica de firma.
```

Escribir 3 casos concretos calcando el harness de `loader.test.ts` (imports, `renderHook`, `deps` con `resolveClient`/`integrity`/`chunkLoader`/`metrics` mockeados + el nuevo `signature`). Asegurar que integrity devuelve `true` para aislar el gate de firma.

- [ ] **Step 2: Run — should fail**

Run: `pnpm --filter @dentvega/host-runtime test useMiniapp-signature`
Expected: FAIL — el wiring no existe.

- [ ] **Step 3: Implement the wiring** — en `useMiniapp.ts`, después del gate de integridad (donde hoy hace `component = await chunkLoader.load(resolved)`), intercalar el signature gate:

```ts
    const intact = await integrity.verify(resolved);
    if (cancelled.current) return;
    if (!intact) {
      failure = { reason: "integrity-failed", detail: "integrity check failed" };
    } else {
      const sig = deps.signature ? await deps.signature.verify(resolved, request.platform ?? "android") : "skip";
      if (cancelled.current) return;
      const sigOk = sig === "ok" || sig === "skip";
      const mode = deps.signatureMode ?? "warn";
      if (!sigOk) {
        const reason = sig === "unknown-key" ? "unknown-key" : "invalid-signature";
        if (mode === "enforce") {
          failure = { reason, detail: `signature ${sig}` };
        } else {
          deps.metrics?.fallback?.(reason); // warn: reporta y monta igual
        }
      }
      if (!failure) {
        dispatch({ type: "resolved", resolved });
        component = await chunkLoader.load(resolved);
      }
    }
```

Sumar al tipo del `deps` de `useMiniapp` (donde se declaran `integrity`, `chunkLoader`, `metrics`, etc.):
```ts
  signature?: SignatureVerifier;
  signatureMode?: "warn" | "enforce";
```
(Importar `SignatureVerifier` de `./signature`. Usar el método real del `metrics` client para reportar la razón — chequear la firma exacta de `metrics` en `useMiniapp.ts` y adaptar `deps.metrics?.fallback?.(reason)` al método que exista, p.ej. `deps.metrics?.recordFallback(reason)`.)

- [ ] **Step 4: Run — should pass**

Run: `pnpm --filter @dentvega/host-runtime test useMiniapp-signature`
Expected: PASS.

- [ ] **Step 5: Re-exports + full package test + commit**

En `index.ts` re-exportar lo público: `signatureVerifier`, `SignatureVerifier`, `SignatureResult`, `httpTrustBundleClient`, `signatureMessage`.

```bash
pnpm --filter @dentvega/host-runtime test && pnpm --filter @dentvega/host-runtime typecheck
git add packages/host-runtime/src/useMiniapp.ts packages/host-runtime/src/index.ts \
        packages/host-runtime/src/__tests__/useMiniapp-signature.test.ts
git commit -m "feat(host-runtime): wire de verificación de firma en useMiniapp (warn/enforce)"
```

### Task C6: Config injection + wiring en la app host

**Files:**
- Modify: `apps/host/src/globals.d.ts`
- Modify: `apps/host/rspack.config.mjs`
- Modify: `apps/host/src/hostProvided.ts`
- Modify: `apps/host/src/screens/MiniappScreen.tsx`

**Interfaces:**
- Consumes: `httpTrustBundleClient` + `signatureVerifier` (C2/C3), `ROOT_PUBLIC_KEY` + `SIGNATURE_MODE` (nuevos).
- Produces: la app construye el verifier con la root key pineada y el modo, y se lo pasa a `MiniappHost`/`useMiniapp`.

> Nota: esta task es integración (config build-time + wiring de singletons); no lleva unit test propio salvo el fallback de `hostProvided`. Verificación real = `typecheck` + el build del host (owner).

- [ ] **Step 1: Ambient globals** — `globals.d.ts`, junto a `__BACKSTAGE_URL__`:

```ts
declare const __ROOT_PUBLIC_KEY__: string | undefined;
declare const __SIGNATURE_MODE__: string | undefined;
```

- [ ] **Step 2: DefinePlugin** — `rspack.config.mjs`, dentro del `new rspack.DefinePlugin({ ... })`:

```js
    __ROOT_PUBLIC_KEY__: JSON.stringify(process.env.ROOT_PUBLIC_KEY ?? ''),
    __SIGNATURE_MODE__: JSON.stringify(process.env.SIGNATURE_MODE ?? 'warn'),
```

- [ ] **Step 3: hostProvided exports** — `hostProvided.ts`, junto a `BACKSTAGE_BASE_URL`:

```ts
export const ROOT_PUBLIC_KEY =
  typeof __ROOT_PUBLIC_KEY__ !== 'undefined' ? __ROOT_PUBLIC_KEY__ : '';
export const SIGNATURE_MODE: 'warn' | 'enforce' =
  (typeof __SIGNATURE_MODE__ !== 'undefined' && __SIGNATURE_MODE__ === 'enforce') ? 'enforce' : 'warn';
```

- [ ] **Step 4: Wire en `MiniappScreen.tsx`** — junto a los otros singletons (`httpResolveClient`, `sha256Verifier`, `httpMetricsClient`):

```ts
import { httpTrustBundleClient, signatureVerifier } from '@dentvega/host-runtime';
import { BACKSTAGE_BASE_URL, ROOT_PUBLIC_KEY, SIGNATURE_MODE } from '../hostProvided';

const trustBundle = httpTrustBundleClient(BACKSTAGE_BASE_URL, ROOT_PUBLIC_KEY);
const signature = signatureVerifier(trustBundle);
```
Y pasarlos al `MiniappHost`/`useMiniapp` (junto a `integrity`): `signature={signature}` + `signatureMode={SIGNATURE_MODE}`. Para dev-remotes, pasar `signature={undefined}` (o un verifier que haga `skip`) igual que se hace `noopVerifier` con integrity. Ajustar la prop-drill de `MiniappHost` → `useMiniapp` para aceptar `signature`/`signatureMode` (mismo camino que `integrity`).

- [ ] **Step 5: Typecheck + commit** (host repo)

```bash
pnpm --filter @dentvega/host-runtime typecheck
# typecheck de la app host si tiene script propio:
pnpm --filter host typecheck 2>/dev/null || true
git add apps/host/src/globals.d.ts apps/host/rspack.config.mjs apps/host/src/hostProvided.ts \
        apps/host/src/screens/MiniappScreen.tsx
git commit -m "feat(host): pin ROOT_PUBLIC_KEY + SIGNATURE_MODE, wire signature verifier"
```

---

## FASE D — Limpieza backstage-web (owner-gated: tras publicar contract 0.4.0)

### Task D1: Bump del contrato + sacar el cast local

**Files:**
- Modify: `package.json` (backstage-web) — `@dentvega/miniapp-contract` `^0.4.0`
- Modify: `lib/registry/registry.ts` (`resolveMiniapp`) — sacar `as Manifest`

**Interfaces:** ninguno nuevo; el manifest ya lleva `signature?` desde el contrato.

- [ ] **Step 1: Bump + reinstalar** (requiere que 0.4.0 esté publicado)

```bash
cd /Volumes/SSDExterno/prodproyects/backstage-web
# editar package.json: "@dentvega/miniapp-contract": "^0.4.0"
pnpm install
```

- [ ] **Step 2: Sacar el cast** — en `resolveMiniapp`, cambiar `{ ...version.manifest, signature: version.signature } as Manifest` por el objeto sin cast (ya que `Manifest.signature?` existe). Ídem la rama iOS.

- [ ] **Step 3: Verificar + commit**

```bash
pnpm typecheck && pnpm test
git add package.json pnpm-lock.yaml lib/registry/registry.ts
git commit -m "chore(contract): consumir 0.4.0 y sacar el cast de signature en resolve"
```

---

## Activación operacional (runbook, owner-run — NO en este plan)

Ver `docs/superpowers/specs/2026-08-27-chunk-signing-end-to-end-design.md` §Fase 4. Orden:
1. Publicar contract 0.4.0 → Fase D.
2. Setear secrets `MINIAPP_SIGN_KEY` en los repos.
3. Keygen root → `ROOT_PUBLIC_KEY` en Vercel + pin en el host (rebuild).
4. Keygen por-miniapp → registrar pubkeys (`PUT /api/miniapps/:id/public-key`).
5. `sign-trust-bundle.mjs` → publicar el bundle.
6. Republicar la flota firmada.
7. Observar `/metrics` en warn → sin `invalid-signature`/`unknown-key`.
8. Flip `SIGNATURE_MODE=enforce` + release del host.

## Self-review notes

- Cobertura del spec: Fase 1→A, Fase 2→B, Fase 3→C, Fase 4→runbook + D. ✓
- `metrics` en C5: el método exacto (`recordFallback` vs otro) debe verificarse contra `useMiniapp.ts` al implementar — marcado explícitamente en la task.
- Anti-rollback: fuera de alcance por diseño (spec Delta 2). No hay task.
