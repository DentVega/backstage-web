# Firma de chunks — Implementation Plan (backstage-web)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que backstage-web acepte, guarde y sirva firmas Ed25519 de los chunks, más la infraestructura de la tabla de confianza (trust bundle) firmada por el root del owner, para que el host pueda verificar autenticidad además de integridad.

**Architecture:** Jerarquía de dos niveles. Cada miniapp firma su chunk en su CI con una clave privada por-repo (out-of-band); backstage guarda esa firma junto a la versión y la devuelve en el resolve. El owner firma offline (CLI local) una tabla `{miniapp→pubkey}` con una clave **root**; backstage la guarda en KV y la sirve. La pubkey root va pineada en el host (repo separado). Todos los cambios en este repo son **aditivos** (sin migración), siguiendo el patrón de `iosIntegrity`.

**Tech Stack:** TypeScript, Next.js 16 (App Router, route handlers), `node:crypto` (Ed25519), Vitest (unit + route tests), `node:test` para los `scripts/*.mjs`. Interop con `@noble/ed25519` del host vía claves raw de 32 bytes.

## Global Constraints

- **Algoritmo:** Ed25519. Claves y firmas se codifican en **base64url** (URL-safe, sin `+/=`). Clave pública raw = 32 bytes (`x`); clave privada raw = seed de 32 bytes (`d`); firma = 64 bytes.
- **Aditivo, sin migración:** los campos nuevos son opcionales; el host viejo y las versiones ya publicadas siguen funcionando. Mismo patrón que `PublishedVersion.iosIntegrity`.
- **Mensaje de firma del chunk:** exactamente `` `${id}:${platform}:${integrity}` `` donde `integrity` es el `sha256-<hex>` ya calculado por `sha256Integrity`. **No** incluye `version`.
- **El root private key NUNCA se commitea ni va a Vercel.** Vive en la máquina del owner; la CLI lo lee de un archivo/env local que pasa el owner en runtime.
- **Autoridad de confianza:** la tabla firmada por root (verificada por el host contra la pubkey root pineada). `MiniappRecord.publicKey` en KV es solo conveniencia, no autoridad.
- **Tests colocados:** unit en `<dir>/__tests__/*.test.ts` (vitest), rutas en `app/api/__tests__/*.test.ts` (vitest), scripts en `scripts/*.test.mjs` (`node --test`, excluidos de vitest).
- **Comandos:** `pnpm test` (= `vitest run`), `pnpm typecheck` (= `tsc --noEmit`), `node --test scripts/<x>.test.mjs`.

## File Structure

- `lib/crypto/ed25519.ts` (nuevo) — primitivas Ed25519 puras (generar par, firmar, verificar) sobre claves raw base64url.
- `lib/trust/message.ts` (nuevo) — builders de mensajes canónicos: `chunkSignatureMessage`, `canonicalBundleMessage`.
- `lib/trust/types.ts` (nuevo) — `TrustBundleBody`, `SignedTrustBundle`.
- `lib/trust/store.ts` (nuevo) — `TrustBundleStore` (load/save) env-selected (KV key `trust-bundle` en prod, JSON-fs en dev), + inMemory para tests.
- `lib/registry/types.ts` (modificar) — `PublishedVersion += signature?/iosSignature?`, `MiniappRecord += publicKey?`.
- `lib/registry/registry.ts` (modificar) — `publishVersion` acarrea `signature`; `resolveMiniapp` adjunta `signature` al manifest; nuevo `setMiniappPublicKey`.
- `lib/config.ts` (modificar) — `rootPublicKey()` accessor (opcional, para sanity-check server-side del bundle).
- `app/api/miniapps/[id]/upload/route.ts` (modificar) — lee el form field `signature`, sanity-verify best-effort, pasa a `publishVersion`.
- `app/api/miniapps/[id]/public-key/route.ts` (nuevo) — `PUT` registra/rota la pubkey de una miniapp.
- `app/api/trust-bundle/route.ts` (nuevo) — `GET` (público) sirve el bundle; `PUT` (canScaffold) lo guarda.
- `scripts/keygen.mjs` (nuevo) — genera un par Ed25519 (root o miniapp).
- `scripts/sign-trust-bundle.mjs` (nuevo) — arma, firma y publica el bundle.

---

### Task 1: Primitivas Ed25519 + mensajes canónicos

**Files:**
- Create: `lib/crypto/ed25519.ts`
- Create: `lib/trust/message.ts`
- Create: `lib/trust/types.ts`
- Test: `lib/crypto/__tests__/ed25519.test.ts`
- Test: `lib/trust/__tests__/message.test.ts`

**Interfaces:**
- Produces:
  - `generateKeypair(): { publicKey: string; privateKey: string }` (raw base64url).
  - `signMessage(message: string, privateKeyB64url: string): string` (firma base64url).
  - `verifyMessage(message: string, signatureB64url: string, publicKeyB64url: string): boolean`.
  - `chunkSignatureMessage(id: string, platform: "android" | "ios", integrity: string): string`.
  - `canonicalBundleMessage(body: TrustBundleBody): string`.
  - `interface TrustBundleBody { version: number; updatedAt: string; keys: Record<string, string> }`.
  - `interface SignedTrustBundle { bundle: TrustBundleBody; signature: string }`.

- [ ] **Step 1: Write the failing test for the crypto primitives**

Create `lib/crypto/__tests__/ed25519.test.ts`:

```ts
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
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test -- lib/crypto/__tests__/ed25519.test.ts`
Expected: FAIL — no se puede resolver `@/lib/crypto/ed25519`.

- [ ] **Step 3: Implement `lib/crypto/ed25519.ts`**

```ts
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
```

- [ ] **Step 4: Run the crypto test — should pass**

Run: `pnpm test -- lib/crypto/__tests__/ed25519.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing test for the message builders**

Create `lib/trust/__tests__/message.test.ts`:

```ts
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
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `pnpm test -- lib/trust/__tests__/message.test.ts`
Expected: FAIL — no se resuelven `@/lib/trust/message`.

- [ ] **Step 7: Implement `lib/trust/types.ts` and `lib/trust/message.ts`**

`lib/trust/types.ts`:

```ts
/** Tabla de confianza {miniapp→pubkey}, firmada por el root del owner. */
export interface TrustBundleBody {
  /** Monotónico. El host rechaza un rollback a versión menor. */
  readonly version: number;
  readonly updatedAt: string; // ISO
  /** miniappId → pubkey raw base64url */
  readonly keys: Readonly<Record<string, string>>;
}

export interface SignedTrustBundle {
  readonly bundle: TrustBundleBody;
  /** Firma Ed25519 (base64url) del root sobre `canonicalBundleMessage(bundle)`. */
  readonly signature: string;
}
```

`lib/trust/message.ts`:

```ts
/** Mensajes canónicos que firman el CI (chunk) y el owner (bundle). Puros y
 *  determinísticos — el host reconstruye estos mismos strings para verificar. */
import type { TrustBundleBody } from "./types";

export function chunkSignatureMessage(
  id: string,
  platform: "android" | "ios",
  integrity: string,
): string {
  return `${id}:${platform}:${integrity}`;
}

export function canonicalBundleMessage(body: TrustBundleBody): string {
  const keys: Record<string, string> = {};
  for (const k of Object.keys(body.keys).sort()) keys[k] = body.keys[k];
  return JSON.stringify({ version: body.version, updatedAt: body.updatedAt, keys });
}
```

- [ ] **Step 8: Run the message test — should pass**

Run: `pnpm test -- lib/trust/__tests__/message.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 9: Typecheck + commit**

```bash
pnpm typecheck
git add lib/crypto/ed25519.ts lib/crypto/__tests__/ed25519.test.ts \
        lib/trust/types.ts lib/trust/message.ts lib/trust/__tests__/message.test.ts
git commit -m "feat(crypto): primitivas Ed25519 raw + mensajes canónicos de firma"
```

---

### Task 2: Tipos del registry + threading de la firma en `publishVersion`

**Files:**
- Modify: `lib/registry/types.ts` (interfaces `PublishedVersion`, `MiniappRecord`)
- Modify: `lib/registry/registry.ts:183-258` (`publishVersion`)
- Test: `lib/registry/__tests__/registry.test.ts` (agregar casos)

**Interfaces:**
- Consumes: nada nuevo.
- Produces:
  - `PublishedVersion.signature?: string`, `PublishedVersion.iosSignature?: string`.
  - `MiniappRecord.publicKey?: string`.
  - `publishVersion(reg, id, { version, url, manifest, platform?, integrity?, signature? }, now)` — la firma se adjunta por plataforma igual que `integrity`.

- [ ] **Step 1: Write the failing test**

Agregar a `lib/registry/__tests__/registry.test.ts` (dentro del `describe` de `publishVersion`; seguir el estilo de fixtures existente del archivo):

```ts
describe("publishVersion — firma", () => {
  const base = registerMiniapp({}, { id: "cards_wallet", name: "C", owner: "o" }, "t0");
  const manifest = { id: "cards_wallet", version: "0.1.0", entry: "./E", shared: [], capabilities: [] };

  it("Android guarda signature en la versión", () => {
    const reg = publishVersion(
      base, "cards_wallet",
      { version: "0.1.0", url: "u", manifest, platform: "android", integrity: "sha256-a", signature: "sigA" },
      "t1",
    );
    expect(reg.cards_wallet.versions[0].signature).toBe("sigA");
  });

  it("iOS adjunta iosSignature a la versión Android existente", () => {
    const android = publishVersion(
      base, "cards_wallet",
      { version: "0.1.0", url: "u", manifest, platform: "android", integrity: "sha256-a", signature: "sigA" },
      "t1",
    );
    const withIos = publishVersion(
      android, "cards_wallet",
      { version: "0.1.0", url: "u-ios", manifest, platform: "ios", integrity: "sha256-i", signature: "sigI" },
      "t2",
    );
    const v = withIos.cards_wallet.versions[0];
    expect(v.signature).toBe("sigA");
    expect(v.iosSignature).toBe("sigI");
  });
});
```

(Asumí `registerMiniapp` y `publishVersion` ya importados en el archivo; si no, agregalos al `import` desde `../registry`.)

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test -- lib/registry/__tests__/registry.test.ts`
Expected: FAIL — `signature` no existe en `PublishedVersion` (typecheck) y/o el valor es `undefined`.

- [ ] **Step 3: Add the fields to `lib/registry/types.ts`**

En `interface PublishedVersion` (después de `iosIntegrity?`):

```ts
  /** Firma Ed25519 (base64url) del chunk Android — el CI la produce; el host la verifica. */
  readonly signature?: string;
  /** Firma Ed25519 (base64url) del chunk iOS; el resolve iOS la inyecta en manifest.signature. */
  readonly iosSignature?: string;
```

En `interface MiniappRecord` (después de `maintainers?`):

```ts
  /** Pubkey actual de la miniapp (raw base64url). SOLO conveniencia (UI + borrador del
   *  bundle). La autoridad es la tabla firmada por root, no este campo (vive en KV). */
  readonly publicKey?: string;
```

- [ ] **Step 4: Thread `signature` through `publishVersion` in `lib/registry/registry.ts`**

En la firma del input (línea ~186), agregar `signature?: string`:

```ts
  input: {
    version: string;
    url: string;
    manifest: unknown;
    platform?: "android" | "ios";
    integrity?: string;
    signature?: string;
  },
```

En la rama iOS (el objeto `attached`, ~línea 231):

```ts
    const attached: PublishedVersion = {
      ...existing,
      iosUrl: input.url,
      iosIntegrity: input.integrity,
      iosSignature: input.signature,
    };
```

En la rama Android (el objeto `published`, ~línea 247):

```ts
  const published: PublishedVersion = {
    version,
    url: input.url,
    manifest,
    publishedAt: now,
    ...(input.signature !== undefined ? { signature: input.signature } : {}),
  };
```

- [ ] **Step 5: Run the tests — should pass**

Run: `pnpm test -- lib/registry/__tests__/registry.test.ts`
Expected: PASS (incluye los 2 casos nuevos).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm typecheck
git add lib/registry/types.ts lib/registry/registry.ts lib/registry/__tests__/registry.test.ts
git commit -m "feat(registry): campos de firma en PublishedVersion + publicKey; publishVersion acarrea signature"
```

---

### Task 3: Upload route — aceptar y guardar la firma (+ sanity-verify best-effort)

**Files:**
- Modify: `app/api/miniapps/[id]/upload/route.ts`
- Test: `app/api/__tests__/upload-route.test.ts` (agregar casos)

**Interfaces:**
- Consumes: `publishVersion(..., { signature? })` (Task 2), `chunkSignatureMessage` + `verifyMessage` (Task 1).
- Produces: el upload lee el form field `signature` (string, opcional) y lo persiste; si `reg[id].publicKey` existe y la firma no valida `id:platform:integrity` → `400`.

- [ ] **Step 1: Write the failing test**

Agregar a `app/api/__tests__/upload-route.test.ts` (seguir el helper de construcción de `FormData`/zip del archivo; abajo el shape esperado):

```ts
it("guarda la signature del form en la versión publicada", async () => {
  // `makeUploadForm` = helper existente del archivo que arma el multipart con el zip del container.
  const form = makeUploadForm({ id: "cards_wallet", version: "0.1.0" });
  form.set("signature", "sig-android-b64url");
  const res = await POST(uploadReq(form), params("cards_wallet"));
  expect(res.status).toBe(201);
  expect(reg().cards_wallet.versions[0].signature).toBe("sig-android-b64url");
});

it("400 si hay publicKey registrada y la firma no valida", async () => {
  // Registrar una pubkey real y mandar una firma inválida.
  const { generateKeypair } = await import("@/lib/crypto/ed25519");
  reg().cards_wallet.publicKey = generateKeypair().publicKey;
  const form = makeUploadForm({ id: "cards_wallet", version: "0.1.0" });
  form.set("signature", "firma-que-no-corresponde");
  const res = await POST(uploadReq(form), params("cards_wallet"));
  expect(res.status).toBe(400);
  expect(reg().cards_wallet.versions).toHaveLength(0); // no persistió
});
```

> Si el archivo de test no tiene un helper equivalente a `makeUploadForm`/`uploadReq`, reusar el que ya arma el `FormData` con el `${id}.container.js.bundle` zippeado (está en los casos existentes de este mismo archivo). No inventar uno nuevo si ya existe.

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test -- app/api/__tests__/upload-route.test.ts`
Expected: FAIL — la firma no se guarda / no hay 400.

- [ ] **Step 3: Read the signature field and verify + pass it to publishVersion**

En `app/api/miniapps/[id]/upload/route.ts`:

Agregar imports (junto a `sha256Integrity`):

```ts
import { verifyMessage } from "@/lib/crypto/ed25519";
import { chunkSignatureMessage } from "@/lib/trust/message";
```

Después de calcular `integrity` (línea ~87), leer la firma y hacer el sanity-check best-effort. Ubicarlo **después** del `const reg = await getStore().load();` (línea ~165), donde ya está el record disponible:

```ts
    // Firma del chunk (opcional; la produce el CI con la clave privada del repo).
    const signatureRaw = form.get("signature");
    const signature = typeof signatureRaw === "string" && signatureRaw.length > 0 ? signatureRaw : undefined;
    // Sanity-check best-effort: si la miniapp ya tiene pubkey registrada, la firma DEBE validar
    // el mensaje id:platform:integrity. Feedback temprano al publisher; el host es la autoridad.
    const pubkey = reg[id]?.publicKey;
    if (signature !== undefined && pubkey !== undefined) {
      const msg = chunkSignatureMessage(id, platform, integrity);
      if (!verifyMessage(msg, signature, pubkey)) {
        return NextResponse.json(
          { error: "signature does not verify against the registered public key", code: "BAD_SIGNATURE" },
          { status: 400 },
        );
      }
    }
```

Y en la llamada a `publishVersion` (línea ~172), sumar `signature`:

```ts
    const next = publishVersion(
      reg,
      id,
      { version, url, manifest, platform, integrity, signature },
      new Date().toISOString(),
    );
```

- [ ] **Step 4: Run the tests — should pass**

Run: `pnpm test -- app/api/__tests__/upload-route.test.ts`
Expected: PASS (incluye los 2 casos nuevos).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add app/api/miniapps/[id]/upload/route.ts app/api/__tests__/upload-route.test.ts
git commit -m "feat(upload): acepta y guarda la firma del chunk; sanity-verify contra publicKey"
```

---

### Task 4: Resolve — adjuntar la firma al manifest devuelto

**Files:**
- Modify: `lib/registry/registry.ts:310-327` (`resolveMiniapp`, ambas ramas de retorno)
- Test: `lib/registry/__tests__/registry.test.ts` (agregar casos al `describe` de resolve)

**Interfaces:**
- Consumes: `PublishedVersion.signature/iosSignature` (Task 2).
- Produces: la `ResolveResponse` devuelve `manifest.signature` = firma de la plataforma pedida (Android → `version.signature`; iOS → `version.iosSignature`). Ausente cuando no hay firma (no aparece la key).

- [ ] **Step 1: Write the failing test**

Agregar a `lib/registry/__tests__/registry.test.ts`:

```ts
describe("resolveMiniapp — firma en el manifest", () => {
  const manifest = { id: "cards_wallet", version: "0.1.0", entry: "./E", shared: [], capabilities: [] };
  let reg: ReturnType<typeof registerMiniapp>;
  beforeEach(() => {
    const base = registerMiniapp({}, { id: "cards_wallet", name: "C", owner: "o" }, "t0");
    reg = publishVersion(
      base, "cards_wallet",
      { version: "0.1.0", url: "u", manifest, platform: "android", integrity: "sha256-a", signature: "sigA" },
      "t1",
    );
    reg = publishVersion(
      reg, "cards_wallet",
      { version: "0.1.0", url: "u-ios", manifest, platform: "ios", integrity: "sha256-i", signature: "sigI" },
      "t2",
    );
  });

  it("Android devuelve manifest.signature = signature", () => {
    const r = resolveMiniapp(reg, "cards_wallet", {});
    expect((r.manifest as { signature?: string }).signature).toBe("sigA");
  });

  it("iOS devuelve manifest.signature = iosSignature (y su integrity)", () => {
    const r = resolveMiniapp(reg, "cards_wallet", { platform: "ios" });
    expect((r.manifest as { signature?: string }).signature).toBe("sigI");
    expect(r.manifest.integrity).toBe("sha256-i");
  });

  it("sin firma no aparece la key signature", () => {
    const base = registerMiniapp({}, { id: "solo", name: "S", owner: "o" }, "t0");
    const noSig = publishVersion(
      base, "solo",
      { version: "0.1.0", url: "u", manifest: { ...manifest, id: "solo" }, platform: "android", integrity: "sha256-a" },
      "t1",
    );
    const r = resolveMiniapp(noSig, "solo", {});
    expect("signature" in (r.manifest as object)).toBe(false);
  });
});
```

(Asegurate de que `beforeEach`/`resolveMiniapp` estén importados en el archivo.)

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test -- lib/registry/__tests__/registry.test.ts`
Expected: FAIL — `manifest.signature` es `undefined`.

- [ ] **Step 3: Attach signature in `resolveMiniapp`**

En `lib/registry/registry.ts`, la rama iOS (línea ~314):

```ts
  if (opts.platform === "ios") {
    if (version.iosUrl === undefined) {
      throw new NoCompatibleVersionError(id, `iOS no publicado para la versión ${version.version}`);
    }
    return {
      id,
      version: version.version,
      url: version.iosUrl,
      manifest: {
        ...version.manifest,
        integrity: version.iosIntegrity,
        ...(version.iosSignature !== undefined ? { signature: version.iosSignature } : {}),
      } as Manifest,
    };
  }
```

La rama Android (línea ~322):

```ts
  return {
    id,
    version: version.version,
    url: version.url,
    manifest: (version.signature !== undefined
      ? { ...version.manifest, signature: version.signature }
      : version.manifest) as Manifest,
  };
```

> Nota: el `as Manifest` es intencional. `signature` viaja como propiedad extra del manifest (aditivo, igual que `integrity` en su momento). El campo se formaliza en `@dentvega/miniapp-contract` como out-of-band; el host lo lee en runtime independientemente del tipo compilado.

- [ ] **Step 4: Run the tests — should pass**

Run: `pnpm test -- lib/registry/__tests__/registry.test.ts`
Expected: PASS (incluye los 3 casos nuevos).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add lib/registry/registry.ts lib/registry/__tests__/registry.test.ts
git commit -m "feat(resolve): adjunta la firma del chunk al manifest (Android + spread iOS)"
```

---

### Task 5: `setMiniappPublicKey` + ruta `PUT /api/miniapps/:id/public-key`

**Files:**
- Modify: `lib/registry/registry.ts` (nuevo export `setMiniappPublicKey`, junto a `setMaintainers`)
- Create: `app/api/miniapps/[id]/public-key/route.ts`
- Test: `lib/registry/__tests__/public-key.test.ts`
- Test: `app/api/__tests__/public-key-route.test.ts`

**Interfaces:**
- Consumes: `getMiniappDetail`, `canManageMiniapp`, `scaffoldAllowedLogins`, `ScaffoldForbiddenError`, `errorBody`/`statusForError`.
- Produces: `setMiniappPublicKey(reg, id, pubkey|null): Registry` (null limpia el campo). Ruta `PUT` gate `canManageMiniapp` (admin o maintainer).

- [ ] **Step 1: Write the failing unit test**

Create `lib/registry/__tests__/public-key.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { registerMiniapp, setMiniappPublicKey } from "@/lib/registry/registry";
import { MiniappNotFoundError } from "@/lib/registry/types";

const base = () => registerMiniapp({}, { id: "cards_wallet", name: "C", owner: "o" }, "t0");

describe("setMiniappPublicKey", () => {
  it("setea la pubkey", () => {
    const reg = setMiniappPublicKey(base(), "cards_wallet", "PK");
    expect(reg.cards_wallet.publicKey).toBe("PK");
  });
  it("null limpia el campo", () => {
    const withKey = setMiniappPublicKey(base(), "cards_wallet", "PK");
    const cleared = setMiniappPublicKey(withKey, "cards_wallet", null);
    expect(cleared.cards_wallet.publicKey).toBeUndefined();
  });
  it("tira MiniappNotFoundError si no existe", () => {
    expect(() => setMiniappPublicKey({}, "ghost", "PK")).toThrow(MiniappNotFoundError);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test -- lib/registry/__tests__/public-key.test.ts`
Expected: FAIL — `setMiniappPublicKey` no existe.

- [ ] **Step 3: Implement `setMiniappPublicKey` in `lib/registry/registry.ts`**

Después de `setMaintainers` (línea ~181):

```ts
/** Setea (o limpia con null) la pubkey de firma de una miniapp. Throws si no existe. */
export function setMiniappPublicKey(
  reg: Registry,
  rawId: string,
  publicKey: string | null,
): Registry {
  const id = parseMiniappId(rawId);
  if (id === null) throw new InvalidManifestError(`bad miniapp id "${rawId}"`);
  const record = reg[id];
  if (record === undefined) throw new MiniappNotFoundError(id);
  if (publicKey === null || publicKey.trim().length === 0) {
    const next = { ...record };
    delete (next as { publicKey?: string }).publicKey;
    return { ...reg, [id]: next };
  }
  return { ...reg, [id]: { ...record, publicKey: publicKey.trim() } };
}
```

- [ ] **Step 4: Run the unit test — should pass**

Run: `pnpm test -- lib/registry/__tests__/public-key.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing route test**

Create `app/api/__tests__/public-key-route.test.ts` (calcar `pin-route.test.ts`):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ reg: {} as Record<string, unknown> }));
vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({
    load: async () => state.reg,
    save: async (r: typeof state.reg) => { state.reg = r; },
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { PUT } from "@/app/api/miniapps/[id]/public-key/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "DentVega";
const reg = () => state.reg as Record<string, { publicKey?: string; maintainers?: string[] }>;
const putReq = (body: unknown) =>
  new Request("http://x/api/miniapps/cards_wallet/public-key", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  state.reg = { cards_wallet: { id: "cards_wallet", name: "C", owner: "o", versions: [] } };
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  authMock.mockResolvedValue({ githubLogin: ADMIN });
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.SCAFFOLD_ALLOWED_LOGINS; });

describe("PUT /api/miniapps/:id/public-key", () => {
  it("200 y setea la pubkey (admin)", async () => {
    const res = await PUT(putReq({ publicKey: "PK" }), params("cards_wallet"));
    expect(res.status).toBe(200);
    expect(reg().cards_wallet.publicKey).toBe("PK");
  });
  it("200 y limpia con null", async () => {
    await PUT(putReq({ publicKey: "PK" }), params("cards_wallet"));
    const res = await PUT(putReq({ publicKey: null }), params("cards_wallet"));
    expect(res.status).toBe(200);
    expect(reg().cards_wallet.publicKey).toBeUndefined();
  });
  it("403 si no es admin ni maintainer", async () => {
    authMock.mockResolvedValue({ githubLogin: "randolino" });
    const res = await PUT(putReq({ publicKey: "PK" }), params("cards_wallet"));
    expect(res.status).toBe(403);
  });
  it("400 si publicKey no es string ni null", async () => {
    const res = await PUT(putReq({ publicKey: 123 }), params("cards_wallet"));
    expect(res.status).toBe(400);
  });
  it("404 si la miniapp no existe", async () => {
    const res = await PUT(putReq({ publicKey: "PK" }), params("ghost"));
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `pnpm test -- app/api/__tests__/public-key-route.test.ts`
Expected: FAIL — la ruta no existe.

- [ ] **Step 7: Implement `app/api/miniapps/[id]/public-key/route.ts`**

```ts
import { NextResponse } from "next/server";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canManageMiniapp, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { getStore } from "@/lib/registry/store";
import { setMiniappPublicKey, getMiniappDetail } from "@/lib/registry/registry";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * PUT /api/miniapps/:id/public-key — registra (o limpia con `publicKey: null`) la pubkey de
 * firma de la miniapp (raw base64url). Auth: platform-admin O un maintainer. Sirve para alta y
 * rotación. Devuelve el MiniappDetail actualizado.
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const { id } = await params;
    const reg = await getStore().load();
    if (reg[id] === undefined) {
      return NextResponse.json({ error: "miniapp no encontrada" }, { status: 404 });
    }
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canManageMiniapp(session?.githubLogin, reg[id].maintainers, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const body = (await req.json().catch(() => null)) as { publicKey?: unknown } | null;
    const pk = body?.publicKey ?? null;
    if (pk !== null && typeof pk !== "string") {
      return NextResponse.json({ error: "publicKey must be a string or null" }, { status: 400 });
    }
    const next = setMiniappPublicKey(reg, id, pk);
    await getStore().save(next);
    return NextResponse.json(getMiniappDetail(next, id), { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
```

- [ ] **Step 8: Run the route test — should pass**

Run: `pnpm test -- app/api/__tests__/public-key-route.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 9: Typecheck + commit**

```bash
pnpm typecheck
git add lib/registry/registry.ts lib/registry/__tests__/public-key.test.ts \
        "app/api/miniapps/[id]/public-key/route.ts" app/api/__tests__/public-key-route.test.ts
git commit -m "feat(registry): setMiniappPublicKey + PUT /api/miniapps/:id/public-key (alta/rotación)"
```

---

### Task 6: Trust bundle store (KV / JSON-fs env-selected)

**Files:**
- Create: `lib/trust/store.ts`
- Test: `lib/trust/__tests__/store.test.ts`

**Interfaces:**
- Consumes: `KvClient`, `upstashClient`, `inMemoryKvClient` (de `@/lib/registry/kv`), `SignedTrustBundle` (Task 1).
- Produces:
  - `interface TrustBundleStore { load(): Promise<SignedTrustBundle | null>; save(b: SignedTrustBundle): Promise<void> }`.
  - `kvTrustBundleStore(client: KvClient): TrustBundleStore` (key `trust-bundle`).
  - `getTrustBundleStore(): TrustBundleStore` (KV en prod, JSON-fs en dev).

- [ ] **Step 1: Write the failing test**

Create `lib/trust/__tests__/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { inMemoryKvClient } from "@/lib/registry/kv";
import { kvTrustBundleStore } from "@/lib/trust/store";
import type { SignedTrustBundle } from "@/lib/trust/types";

const sample: SignedTrustBundle = {
  bundle: { version: 1, updatedAt: "2026-08-26T00:00:00.000Z", keys: { cards_wallet: "PK" } },
  signature: "rootsig",
};

describe("kvTrustBundleStore", () => {
  it("load devuelve null cuando no hay nada", async () => {
    const store = kvTrustBundleStore(inMemoryKvClient());
    expect(await store.load()).toBeNull();
  });
  it("save y load hacen round-trip", async () => {
    const store = kvTrustBundleStore(inMemoryKvClient());
    await store.save(sample);
    expect(await store.load()).toEqual(sample);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test -- lib/trust/__tests__/store.test.ts`
Expected: FAIL — `@/lib/trust/store` no existe.

- [ ] **Step 3: Implement `lib/trust/store.ts`**

```ts
/** Store del trust bundle (ADR-014 style): Upstash KV en prod, JSON-fs en dev.
 *  Bajo su propia key `trust-bundle` (separado del registry). */
import { promises as fs } from "node:fs";
import path from "node:path";
import { type KvClient, upstashClient } from "@/lib/registry/kv";
import type { SignedTrustBundle } from "./types";

const BUNDLE_KEY = "trust-bundle";
const DATA_FILE = path.join(process.cwd(), "data", "trust-bundle.json");

export interface TrustBundleStore {
  load(): Promise<SignedTrustBundle | null>;
  save(bundle: SignedTrustBundle): Promise<void>;
}

export function kvTrustBundleStore(client: KvClient): TrustBundleStore {
  return {
    async load() {
      const raw = await client.get(BUNDLE_KEY);
      return raw ? (JSON.parse(raw) as SignedTrustBundle) : null;
    },
    async save(bundle) {
      await client.set(BUNDLE_KEY, JSON.stringify(bundle));
    },
  };
}

export const jsonTrustBundleStore: TrustBundleStore = {
  async load() {
    try {
      return JSON.parse(await fs.readFile(DATA_FILE, "utf8")) as SignedTrustBundle;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  },
  async save(bundle) {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  },
};

export function getTrustBundleStore(): TrustBundleStore {
  if (process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN) {
    return kvTrustBundleStore(upstashClient());
  }
  return jsonTrustBundleStore;
}
```

- [ ] **Step 4: Run the test — should pass**

Run: `pnpm test -- lib/trust/__tests__/store.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
pnpm typecheck
git add lib/trust/store.ts lib/trust/__tests__/store.test.ts
git commit -m "feat(trust): store del trust bundle (KV/JSON-fs env-selected)"
```

---

### Task 7: Rutas `GET`/`PUT /api/trust-bundle`

**Files:**
- Modify: `lib/config.ts` (accessor `rootPublicKey()`)
- Create: `app/api/trust-bundle/route.ts`
- Test: `app/api/__tests__/trust-bundle-route.test.ts`

**Interfaces:**
- Consumes: `getTrustBundleStore` (Task 6), `canScaffold`, `scaffoldAllowedLogins`, `verifyMessage` (Task 1), `canonicalBundleMessage` (Task 1), `rootPublicKey`.
- Produces: `GET` (público) → `SignedTrustBundle` o `404`. `PUT` (canScaffold) guarda el bundle; si `ROOT_PUBLIC_KEY` está seteada, valida la firma root antes de guardar (`400` si no valida).

- [ ] **Step 1: Add `rootPublicKey()` to `lib/config.ts`**

Agregar (junto a los otros accessors):

```ts
/** Pubkey root (raw base64url) para el sanity-check server-side del trust bundle.
 *  Opcional: si no está, el PUT no valida (el host es la autoridad final igual). */
export function rootPublicKey(): string | null {
  const v = process.env.ROOT_PUBLIC_KEY;
  return v && v.length > 0 ? v : null;
}
```

- [ ] **Step 2: Write the failing route test**

Create `app/api/__tests__/trust-bundle-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeypair, signMessage } from "@/lib/crypto/ed25519";
import { canonicalBundleMessage } from "@/lib/trust/message";
import type { SignedTrustBundle } from "@/lib/trust/types";

const state = vi.hoisted(() => ({ bundle: null as SignedTrustBundle | null }));
vi.mock("@/lib/trust/store", () => ({
  getTrustBundleStore: () => ({
    load: async () => state.bundle,
    save: async (b: SignedTrustBundle) => { state.bundle = b; },
  }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));

import { GET, PUT } from "@/app/api/trust-bundle/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "DentVega";
const root = generateKeypair();
const signed = (): SignedTrustBundle => {
  const body = { version: 1, updatedAt: "2026-08-26T00:00:00.000Z", keys: { cards_wallet: "PK" } };
  return { bundle: body, signature: signMessage(canonicalBundleMessage(body), root.privateKey) };
};
const putReq = (b: unknown) =>
  new Request("http://x/api/trust-bundle", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(b) });

beforeEach(() => {
  state.bundle = null;
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  authMock.mockResolvedValue({ githubLogin: ADMIN });
});
afterEach(() => { vi.restoreAllMocks(); delete process.env.SCAFFOLD_ALLOWED_LOGINS; delete process.env.ROOT_PUBLIC_KEY; });

describe("GET /api/trust-bundle", () => {
  it("404 cuando no hay bundle", async () => {
    expect((await GET()).status).toBe(404);
  });
  it("200 y devuelve el bundle guardado", async () => {
    state.bundle = signed();
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(signed());
  });
});

describe("PUT /api/trust-bundle", () => {
  it("200 y guarda (admin)", async () => {
    const res = await PUT(putReq(signed()));
    expect(res.status).toBe(200);
    expect(state.bundle).toEqual(signed());
  });
  it("403 si no es admin", async () => {
    authMock.mockResolvedValue({ githubLogin: "randolino" });
    expect((await PUT(putReq(signed()))).status).toBe(403);
    expect(state.bundle).toBeNull();
  });
  it("400 si el body no tiene la forma de SignedTrustBundle", async () => {
    expect((await PUT(putReq({ nope: 1 }))).status).toBe(400);
  });
  it("400 con ROOT_PUBLIC_KEY seteada y firma inválida", async () => {
    process.env.ROOT_PUBLIC_KEY = root.publicKey;
    const bad = { ...signed(), signature: "firma-mala" };
    const res = await PUT(putReq(bad));
    expect(res.status).toBe(400);
    expect(state.bundle).toBeNull();
  });
  it("200 con ROOT_PUBLIC_KEY seteada y firma válida", async () => {
    process.env.ROOT_PUBLIC_KEY = root.publicKey;
    expect((await PUT(putReq(signed()))).status).toBe(200);
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `pnpm test -- app/api/__tests__/trust-bundle-route.test.ts`
Expected: FAIL — la ruta no existe.

- [ ] **Step 4: Implement `app/api/trust-bundle/route.ts`**

```ts
import { NextResponse } from "next/server";
import { scaffoldAllowedLogins, rootPublicKey } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { getTrustBundleStore } from "@/lib/trust/store";
import { canonicalBundleMessage } from "@/lib/trust/message";
import { verifyMessage } from "@/lib/crypto/ed25519";
import type { SignedTrustBundle, TrustBundleBody } from "@/lib/trust/types";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

function isSignedBundle(x: unknown): x is SignedTrustBundle {
  const b = x as SignedTrustBundle | null;
  if (b === null || typeof b !== "object") return false;
  if (typeof b.signature !== "string") return false;
  const body = b.bundle as TrustBundleBody | undefined;
  return (
    body !== undefined &&
    typeof body.version === "number" &&
    typeof body.updatedAt === "string" &&
    typeof body.keys === "object" && body.keys !== null
  );
}

/** GET /api/trust-bundle — público. Sirve el bundle firmado (o 404 si aún no hay). */
export async function GET(): Promise<NextResponse> {
  const bundle = await getTrustBundleStore().load();
  if (bundle === null) {
    return NextResponse.json({ error: "no trust bundle published" }, { status: 404 });
  }
  return NextResponse.json(bundle, { status: 200 });
}

/**
 * PUT /api/trust-bundle — guarda el bundle que produjo la CLI de firma. Admin (canScaffold).
 * Si ROOT_PUBLIC_KEY está seteada, valida la firma root antes de guardar (feedback temprano).
 */
export async function PUT(req: Request): Promise<NextResponse> {
  try {
    const { auth } = await import("@/auth");
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const body = (await req.json().catch(() => null)) as unknown;
    if (!isSignedBundle(body)) {
      return NextResponse.json({ error: "body is not a SignedTrustBundle" }, { status: 400 });
    }
    const rootPk = rootPublicKey();
    if (rootPk !== null) {
      const ok = verifyMessage(canonicalBundleMessage(body.bundle), body.signature, rootPk);
      if (!ok) {
        return NextResponse.json(
          { error: "bundle signature does not verify against ROOT_PUBLIC_KEY", code: "BAD_ROOT_SIGNATURE" },
          { status: 400 },
        );
      }
    }
    await getTrustBundleStore().save(body);
    return NextResponse.json(body, { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
```

- [ ] **Step 5: Run the route test — should pass**

Run: `pnpm test -- app/api/__tests__/trust-bundle-route.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Typecheck + commit**

```bash
pnpm typecheck
git add lib/config.ts app/api/trust-bundle/route.ts app/api/__tests__/trust-bundle-route.test.ts
git commit -m "feat(trust): GET/PUT /api/trust-bundle (sirve + guarda con sanity-verify root)"
```

---

### Task 8: CLI de firma — `keygen.mjs` + `sign-trust-bundle.mjs`

**Files:**
- Create: `scripts/keygen.mjs`
- Create: `scripts/sign-trust-bundle.mjs`
- Test: `scripts/sign-trust-bundle.test.mjs`

**Interfaces:**
- Producen (funciones exportadas, para poder testear con `node:test`):
  - `keygen.mjs`: `export function generateKeypair(): { publicKey, privateKey }` (base64url raw) — misma lógica que `lib/crypto/ed25519.ts` pero en JS puro para el script.
  - `sign-trust-bundle.mjs`: `export function buildSignedBundle({ keys, version, updatedAt, privateKey }): SignedTrustBundle` (arma el body, lo canonicaliza igual que `lib/trust/message.ts`, y lo firma).

> Los scripts usan `node:crypto` (no importan el código TS de `lib/` — vitest excluye `scripts/**` y `node --test` no bundlea TS). La lógica cripto se duplica en JS a propósito (herramienta de bootstrap, mismo criterio que otros `scripts/*.mjs` del repo). El **test** garantiza que la firma que produce la CLI la verifica el verificador de producción.

- [ ] **Step 1: Write the failing test**

Create `scripts/sign-trust-bundle.test.mjs`:

```mjs
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
    version: 3, updatedAt: "2026-08-26T00:00:00.000Z", keys: { a: "ka", b: "kb" },
  });
  const ok = verify(null, Buffer.from(canonical, "utf8"), publicKeyObject(publicKey), Buffer.from(signed.signature, "base64url"));
  assert.equal(ok, true);

  // Determinismo: mismo input → misma firma (Ed25519 es determinística).
  const again = buildSignedBundle(args);
  assert.equal(again.signature, signed.signature);
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test scripts/sign-trust-bundle.test.mjs`
Expected: FAIL — no se resuelven `./keygen.mjs` / `./sign-trust-bundle.mjs`.

- [ ] **Step 3: Implement `scripts/keygen.mjs`**

```mjs
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
```

- [ ] **Step 4: Implement `scripts/sign-trust-bundle.mjs`**

```mjs
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
  const signature = sign(null, Buffer.from(canonicalBundleMessage(bundle), "utf8"), privateKeyObject(privateKey)).toString("base64url");
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
    keys, version: nextVersion, updatedAt: new Date().toISOString(), privateKey,
  });

  // 4) Publicar.
  const put = await fetch(`${base}/api/trust-bundle`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(signed),
  });
  console.error(put.ok ? `✅ Publicado v${nextVersion}` : `❌ ${put.status}: ${await put.text()}`);
  if (!put.ok) process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
```

> Nota: `PUT /api/trust-bundle` usa `canScaffold` (sesión), no Bearer token. Para correr la CLI headless, o bien el owner corre con su sesión (curl con cookie) o se agrega el token a la gate en un follow-up. Para v1 el owner publica el bundle logueado desde su máquina; el `--token` queda como hook para el follow-up. Documentarlo en el runbook (fuera de este plan).

- [ ] **Step 5: Run the script test — should pass**

Run: `node --test scripts/sign-trust-bundle.test.mjs`
Expected: PASS (1 test).

- [ ] **Step 6: Full suite + typecheck + commit**

```bash
pnpm typecheck && pnpm test && node --test scripts/sign-trust-bundle.test.mjs
git add scripts/keygen.mjs scripts/sign-trust-bundle.mjs scripts/sign-trust-bundle.test.mjs
git commit -m "feat(cli): keygen + sign-trust-bundle (firma offline del root)"
```

---

## Out of scope (coordinado out-of-band, NO en este plan)

- **Contrato `@dentvega/miniapp-contract`:** formalizar `Manifest.signature?: string` (mirror de `integrity`). Backstage ya adjunta el campo en runtime; el bump del paquete es para type-safety del host.
- **Template / CI (`scripts/publish.mjs` vía Capa 2):** firmar `id:platform:integrity` con `MINIAPP_SIGN_KEY` y mandar el form field `signature`, por plataforma.
- **`scaffoldSecrets()` auto-seed de `MINIAPP_SIGN_KEY`** para miniapps nuevas (v1: keygen + registro manual).
- **Host (repo separado):** pinear `ROOT_PUBLIC_KEY`, fetch+verify del bundle (anti-rollback por `version`), verificar la firma del chunk (enforce siempre), dep `@noble/ed25519`.
- **Runbook de operación:** cómo el owner corre `keygen` para las 3 miniapps, registra pubkeys, y publica el primer bundle; secuencia de rollout (deploy backstage → firmar bundle → republicar flota firmada → release host enforce).

## Rollout (recordatorio — enforce directo exige orden)

1. Deploy backstage-web (este plan). Aditivo — host viejo intacto.
2. Keygen de las 3 miniapps + `PUT public-key` + `sign-trust-bundle` (primer bundle).
3. Template `publish.mjs` firmado → Capa 2 → republicar las 3 firmadas.
4. Recién ahí: release del host que hace enforce.
