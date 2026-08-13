# R2 storage adapter (Fase A) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un adapter de storage para Cloudflare R2 detrás de la interfaz `ChunkStorage` existente, seleccionado por env (R2 → Blob → fs), para publicar chunks sin el límite de operaciones de Vercel Blob.

**Architecture:** `lib/storage/r2.ts` espeja `blob.ts`. Escribe con firma S3 v4 (`aws4fetch`) al endpoint S3 de R2; devuelve la **URL pública** del bucket como `baseUrl`. El cliente firmado es inyectable (una función) → testeable sin red. `getStorage()` suma R2 con precedencia.

**Tech Stack:** TypeScript, Next.js, Vitest, `aws4fetch` (nueva dep), interfaz `ChunkStorage` (`lib/storage/types.ts`).

## Global Constraints

- **Owner:** <owner>. **Única dep nueva:** `aws4fetch`. Nada más.
- **Repo:** `backstage-web`. Commits **locales** (push tras la review final).
- **Comportamiento existente intacto:** si R2 no está configurado, `getStorage()` sigue eligiendo Blob (si hay token) o fs — igual que hoy.
- **Dos URLs de R2:** escritura al endpoint S3 (`{accountId}.r2.cloudflarestorage.com`), lectura a la URL pública (`R2_PUBLIC_BASE_URL`). El adapter escribe en la primera y devuelve la segunda.
- Commits con **paths explícitos** (no `data/*.json`); trailer en cada commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```

---

### Task 1: `lib/storage/r2.ts` — el adapter

**Files:**
- Modify: `package.json` (dep `aws4fetch`)
- Create: `lib/storage/r2.ts`
- Test: `lib/storage/__tests__/r2.test.ts`

**Interfaces:**
- Produces: `R2Config`, `r2ConfigFromEnv()`, `SignedFetch`, `r2Storage(config, fetchImpl?)`.

- [ ] **Step 1: Agregar la dep** en `package.json`: `"dependencies": { ..., "aws4fetch": "^1.0.20" }` + `pnpm install`.

- [ ] **Step 2: Test que falla** — `lib/storage/__tests__/r2.test.ts`

```ts
import { describe, expect, it, vi } from "vitest";
import { r2Storage, r2ConfigFromEnv, type SignedFetch } from "@/lib/storage/r2";
import { StorageError } from "@/lib/storage/types";

const config = {
  accountId: "acct123",
  accessKeyId: "ak",
  secretAccessKey: "sk",
  bucket: "chunks",
  publicBaseUrl: "https://pub-abc.r2.dev/",
};

describe("r2ConfigFromEnv", () => {
  it("null si falta alguna var", () => {
    const old = process.env;
    process.env = { ...old, R2_ACCOUNT_ID: "x" };
    delete process.env.R2_ACCESS_KEY_ID;
    expect(r2ConfigFromEnv()).toBeNull();
    process.env = old;
  });
  it("devuelve la config con las 5", () => {
    const old = process.env;
    process.env = { ...old, R2_ACCOUNT_ID: "a", R2_ACCESS_KEY_ID: "b", R2_SECRET_ACCESS_KEY: "c", R2_BUCKET: "d", R2_PUBLIC_BASE_URL: "e" };
    expect(r2ConfigFromEnv()).toEqual({ accountId: "a", accessKeyId: "b", secretAccessKey: "c", bucket: "d", publicBaseUrl: "e" });
    process.env = old;
  });
});

describe("r2Storage.putMany", () => {
  it("PUTea cada file al endpoint S3 y devuelve la URL pública como baseUrl", async () => {
    const calls: { url: string; method: string }[] = [];
    const fake: SignedFetch = async (url, init) => { calls.push({ url, method: init.method }); return { ok: true, status: 200 }; };
    const r = await r2Storage(config, fake).putMany("cards_wallet/0.1.5", [
      { path: "cards_wallet.container.js.bundle", data: new Uint8Array([1, 2]) },
      { path: "vendors.chunk.bundle", data: new Uint8Array([3]) },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual({
      url: "https://acct123.r2.cloudflarestorage.com/chunks/cards_wallet/0.1.5/cards_wallet.container.js.bundle",
      method: "PUT",
    });
    // publicBaseUrl con barra final → limpiada
    expect(r.baseUrl).toBe("https://pub-abc.r2.dev/cards_wallet/0.1.5");
  });

  it("0 files → StorageError", async () => {
    const fake: SignedFetch = async () => ({ ok: true, status: 200 });
    await expect(r2Storage(config, fake).putMany("x", [])).rejects.toBeInstanceOf(StorageError);
  });

  it("un PUT !ok → StorageError con el status", async () => {
    const fake: SignedFetch = async () => ({ ok: false, status: 403 });
    await expect(
      r2Storage(config, fake).putMany("x", [{ path: "a.bundle", data: new Uint8Array([1]) }]),
    ).rejects.toThrow(/403/);
  });
});
```

- [ ] **Step 3: Correr — falla** (`npx vitest run lib/storage/__tests__/r2.test.ts`).

- [ ] **Step 4: `lib/storage/r2.ts`**

```ts
import { AwsClient } from "aws4fetch";
import { StorageError, type ChunkStorage } from "./types";

export interface R2Config {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly publicBaseUrl: string;
}

/** R2 config from env; null if any of the 5 vars is missing. */
export function r2ConfigFromEnv(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) {
    return null;
  }
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

/** Minimal signed-fetch: prod wraps aws4fetch; tests pass a fake. */
export type SignedFetch = (
  url: string,
  init: { method: string; body: Uint8Array; headers?: Record<string, string> },
) => Promise<{ ok: boolean; status: number }>;

function contentType(path: string): string {
  if (path.endsWith(".js") || path.endsWith(".bundle")) return "application/javascript";
  if (path.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

/** Default signed fetch — aws4fetch signs each request with SigV4 for R2 (S3). */
function defaultSignedFetch(config: R2Config): SignedFetch {
  const aws = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  return (url, init) => aws.fetch(url, init);
}

/**
 * Cloudflare R2 chunk storage (S3-compatible). WRITES are SigV4-signed to the R2 S3
 * endpoint; READS come from the bucket's PUBLIC base URL — two different hosts, so
 * putMany writes to one and returns the other as baseUrl. Idempotent (S3 PUT overwrites).
 */
export function r2Storage(config: R2Config, fetchImpl?: SignedFetch): ChunkStorage {
  const doFetch = fetchImpl ?? defaultSignedFetch(config);
  const s3 = `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`;
  const publicBase = config.publicBaseUrl.replace(/\/+$/, "");
  return {
    async putMany(prefix, files): Promise<{ baseUrl: string }> {
      if (files.length === 0) throw new StorageError("no files to upload");
      try {
        for (const file of files) {
          const res = await doFetch(`${s3}/${prefix}/${file.path}`, {
            method: "PUT",
            body: file.data,
            headers: { "content-type": contentType(file.path) },
          });
          if (!res.ok) throw new StorageError(`R2 PUT failed: HTTP ${res.status}`);
        }
      } catch (err) {
        if (err instanceof StorageError) throw err;
        throw new StorageError(err instanceof Error ? err.message : "R2 upload failed");
      }
      return { baseUrl: `${publicBase}/${prefix}` };
    },
  };
}
```
> Nota: `aws.fetch(url, init)` devuelve `Promise<Response>` (que tiene `ok`/`status`) y acepta `{method, body: Uint8Array, headers}` (asignable a `RequestInit`), así que el wrapper `(url, init) => aws.fetch(url, init)` tipea sin cast. Si `tsc` se quejara por el tipo de `AwsClient`, usar `aws.fetch(url, init as RequestInit)`.

- [ ] **Step 5: Correr — pasa** (`npx vitest run lib/storage/__tests__/r2.test.ts`) + `npx tsc --noEmit` limpio.
- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml lib/storage/r2.ts lib/storage/__tests__/r2.test.ts
git commit  # feat(storage): Cloudflare R2 adapter (aws4fetch, public read URL)  (+ trailer)
```

---

### Task 2: `getStorage()` elige R2

**Files:**
- Modify: `lib/storage/index.ts`
- Test: `lib/storage/__tests__/select.test.ts` (nuevo)

- [ ] **Step 1: Test que falla** — `lib/storage/__tests__/select.test.ts`

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/storage/r2", () => ({
  r2ConfigFromEnv: () => (process.env.R2_ACCOUNT_ID ? { accountId: "a" } : null),
  r2Storage: () => ({ __kind: "r2" }),
}));
vi.mock("@/lib/storage/blob", () => ({ blobStorage: () => ({ __kind: "blob" }) }));
vi.mock("@/lib/storage/fs", () => ({ fsStorage: () => ({ __kind: "fs" }) }));

import { getStorage } from "@/lib/storage";

afterEach(() => {
  delete process.env.R2_ACCOUNT_ID;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  vi.restoreAllMocks();
});

describe("getStorage — precedencia", () => {
  it("R2 si está configurado", () => {
    process.env.R2_ACCOUNT_ID = "a";
    expect((getStorage() as { __kind: string }).__kind).toBe("r2");
  });
  it("Blob si no hay R2 pero hay token", () => {
    process.env.BLOB_READ_WRITE_TOKEN = "t";
    expect((getStorage() as { __kind: string }).__kind).toBe("blob");
  });
  it("fs si no hay nada", () => {
    expect((getStorage() as { __kind: string }).__kind).toBe("fs");
  });
});
```
(El mock de `r2ConfigFromEnv` usa `R2_ACCOUNT_ID` como proxy de "configurado" para el test.)

- [ ] **Step 2: Correr — falla** (getStorage aún no consulta R2).

- [ ] **Step 3: `lib/storage/index.ts`**

```ts
import { r2ConfigFromEnv, r2Storage } from "./r2";
import { blobStorage } from "./blob";
import { fsStorage } from "./fs";
import type { ChunkStorage } from "./types";

/** Storage selected by env: R2 (if configured) → Vercel Blob → fs (dev). */
export function getStorage(): ChunkStorage {
  const r2 = r2ConfigFromEnv();
  if (r2 !== null) return r2Storage(r2);
  if (process.env.BLOB_READ_WRITE_TOKEN) return blobStorage();
  return fsStorage();
}
```

- [ ] **Step 4: Correr — pasa** (`npx vitest run lib/storage/__tests__/select.test.ts`) + suite completa + `npx tsc --noEmit` + `npx next build`.
- [ ] **Step 5: Commit**

```bash
git add lib/storage/index.ts lib/storage/__tests__/select.test.ts
git commit  # feat(storage): getStorage prefers R2 when configured (R2 → Blob → fs)  (+ trailer)
```

---

## Cierre (post-tasks, controller)

1. Review final whole-branch (base = commit previo a Task 1).
2. `npx tsc --noEmit && npx vitest run && npx next build` — todo verde.
3. **Push.**

## Operacional (fuera del plan)
- Setear las 5 vars `R2_*` en Vercel prod → `getStorage()` pasa a R2 → los publishes vuelven a funcionar (destraba el backfill de hellow_widget + el resto del rollout).
- **Fase B** (elegir el provider desde la UI) queda como esfuerzo siguiente.
