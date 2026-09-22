# Librería pública de storage multi-cloud — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publicar `@dentvega/miniapp-storage` a npm como librería MIT que da a cualquier proyecto Re.Pack una interfaz única sobre Cloudflare R2, AWS S3, Google Cloud Storage, Azure Blob, Vercel Blob y fs — y migrar `backstage-web` a consumirla.

**Architecture:** Monorepo público nuevo (`repack-miniapps`, pnpm workspace). Se mueve `miniapp-contract` tal cual y se publica público (la fase 4 lo necesitará). Se extrae `backstage-web/lib/storage/` generalizando `r2.ts` — que ya habla S3 SigV4 puro — a un motor `s3Compatible` del que R2, AWS y GCS son configuraciones. Azure es el único adapter nuevo de cero. La persistencia de la preferencia **no viaja**: se queda en `backstage-web`.

**Tech Stack:** TypeScript 5.6+ (ESM, `moduleResolution: Bundler`), pnpm 10 workspace, Node 24, vitest (storage), jest (contract, sin tocar), `aws4fetch` para SigV4, `@vercel/blob` como peer opcional.

**Spec:** `docs/superpowers/specs/2026-09-22-repack-miniapps-libs-design.md`

**Alcance:** este plan cubre las **fases 1-3** del spec (repo público, contract, librería de
storage y providers nuevos). La **fase 4** (`@dentvega/miniapp-runtime`) es otro subsistema y
lleva su propio plan — el spec la declara independiente y posponible.

## Global Constraints

- **Scope npm:** `@dentvega`, `access: "public"`, registry npm por defecto (NO GitHub Packages).
- **Licencia:** `MIT` en los tres `package.json` y `LICENSE` en la raíz. Nunca `UNLICENSED`.
- **Repo público:** historia limpia (commit inicial nuevo). **Prohibido** que entre al repo: URLs internas, nombres de buckets reales, tokens, ids de cuenta, o cualquier referencia a clientes o prospectos. Los ejemplos usan placeholders (`my-bucket`, `<account>`, `https://cdn.example.com`).
- **Sin red en tests:** todo adapter se testea con un `fetch` inyectado. Ningún test toca un bucket real.
- **`@vercel/blob` es `peerDependency` opcional** + export por subpath. Nunca dependencia normal.
- **TS base:** `target: ES2022`, `strict: true`, `noUncheckedIndexedAccess: true`, `verbatimModuleSyntax: true`, `declaration: true`.
- **Versionado independiente por package.**
- **Ruta del repo nuevo:** `/Volumes/SSDExterno/prodproyects/repack-miniapps`.
- **Comando de tests de `backstage-web`:** `pnpm test` (= `vitest run`). Debe quedar verde en cada task que lo toque.

---

# FASE 1 — Repo público + contract

### Task 1: Scaffold del monorepo público

**Files:**
- Create: `repack-miniapps/package.json`
- Create: `repack-miniapps/pnpm-workspace.yaml`
- Create: `repack-miniapps/tsconfig.base.json`
- Create: `repack-miniapps/LICENSE`
- Create: `repack-miniapps/README.md`
- Create: `repack-miniapps/.gitignore`
- Create: `repack-miniapps/.github/workflows/ci.yml`

**Interfaces:**
- Consumes: nada (task inicial).
- Produces: workspace `pnpm` con `packages/*`, y `tsconfig.base.json` que todos los packages extienden.

- [ ] **Step 1: Crear el directorio e inicializar git con historia limpia**

```bash
mkdir -p /Volumes/SSDExterno/prodproyects/repack-miniapps/packages
cd /Volumes/SSDExterno/prodproyects/repack-miniapps
git init
```

- [ ] **Step 2: Escribir los archivos raíz**

`package.json`:
```json
{
  "name": "repack-miniapps",
  "private": true,
  "packageManager": "pnpm@10.14.0",
  "engines": { "node": ">=24" },
  "scripts": {
    "build": "pnpm -r --if-present build",
    "typecheck": "pnpm -r --if-present typecheck",
    "test": "pnpm -r --if-present test"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - packages/*
```

`tsconfig.base.json` (copiado de `backstagereactnative/tsconfig.base.json`, que ya está probado):
```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  }
}
```

`.gitignore`:
```
node_modules/
dist/
*.tsbuildinfo
.DS_Store
.env
.env.*
```

`LICENSE`: licencia MIT estándar, `Copyright (c) 2026 Brian Dennis Vega Hidalgo`.

`README.md`: título, una línea por package, e instalación. Sin URLs internas.

- [ ] **Step 3: Escribir el CI**

`.github/workflows/ci.yml`:
```yaml
name: ci
on:
  push: { branches: [main] }
  pull_request:
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
      - uses: actions/setup-node@v4
        with: { node-version: 24, cache: pnpm }
      - run: pnpm install --frozen-lockfile
      - run: pnpm build
      - run: pnpm typecheck
      - run: pnpm test
```

- [ ] **Step 4: Verificar que el toolchain corre**

Run: `cd /Volumes/SSDExterno/prodproyects/repack-miniapps && pnpm install && pnpm typecheck`
Expected: instala sin errores; `typecheck` no falla (todavía no hay packages, así que no hace nada).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: scaffold del monorepo público (pnpm workspace, TS base, CI, MIT)"
```

---

### Task 2: Mover y publicar `@dentvega/miniapp-contract`

**Files:**
- Create: `repack-miniapps/packages/miniapp-contract/**` (copia de `backstagereactnative/packages/miniapp-contract`)
- Modify: `repack-miniapps/packages/miniapp-contract/package.json`

**Interfaces:**
- Consumes: `tsconfig.base.json` de la Task 1.
- Produces: `@dentvega/miniapp-contract@0.4.1` publicado en npm público. Exporta (sin cambios) `Manifest`, `MiniappId`, `SemVer`, `ResolveResponse`, `HostContract`, `isHostContract`, `satisfiesShared`, `gteVersion`, `evaluateManifest`.

- [ ] **Step 1: Copiar el package sin su historia**

```bash
cd /Volumes/SSDExterno/prodproyects
cp -R backstagereactnative/packages/miniapp-contract repack-miniapps/packages/miniapp-contract
rm -rf repack-miniapps/packages/miniapp-contract/node_modules \
       repack-miniapps/packages/miniapp-contract/dist
```

- [ ] **Step 2: Ajustar el `package.json` para npm público**

Cambiar exactamente tres campos (el resto queda igual — el código no se toca):
```json
{
  "version": "0.4.1",
  "license": "MIT",
  "publishConfig": {
    "access": "public"
  }
}
```
Borrar `"registry": "https://npm.pkg.github.com"`. Reemplazar `"typescript": "catalog:"` y `"jest": "catalog:"` por versiones concretas (`"^5.6.3"` y `"^29.7.0"`) — el catalog vivía en el workspace viejo y acá no existe.

- [ ] **Step 3: Verificar que compila y los tests pasan**

Run: `cd /Volumes/SSDExterno/prodproyects/repack-miniapps && pnpm install && pnpm --filter @dentvega/miniapp-contract test && pnpm --filter @dentvega/miniapp-contract build`
Expected: los tests existentes (compat, guards, host-contract, shared) pasan, y `dist/` se genera.

- [ ] **Step 4: Verificar el tarball antes de publicar**

Run: `pnpm --filter @dentvega/miniapp-contract pack && tar -tzf dentvega-miniapp-contract-0.4.1.tgz`
Expected: contiene **solo** `package/dist/**` y `package/package.json`. Si aparece `src/` o tests, `files` está mal.

- [ ] **Step 5: Publicar a npm**

```bash
npm login   # una vez, con la cuenta dueña del scope @dentvega
pnpm --filter @dentvega/miniapp-contract publish --no-git-checks
```
Expected: `https://www.npmjs.com/package/@dentvega/miniapp-contract` existe y es público.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(contract): mover miniapp-contract al repo público (MIT, npm 0.4.1)"
```

---

### Task 3: Migrar `backstage-web` al contract público

**Files:**
- Modify: `backstage-web/package.json` (dep `@dentvega/miniapp-contract`)
- Modify: `backstage-web/.npmrc` (si mapea el scope a GitHub Packages)

**Interfaces:**
- Consumes: `@dentvega/miniapp-contract@^0.4.1` de npm público (Task 2).
- Produces: `backstage-web` instalando sin token de GitHub Packages.

- [ ] **Step 1: Ver cómo está resuelto el scope hoy**

Run: `cat .npmrc 2>/dev/null; grep -n "miniapp-contract" package.json`
Expected: muestra si hay un `.npmrc` apuntando `@dentvega:registry=https://npm.pkg.github.com`.

- [ ] **Step 2: Apuntar al registry público**

En `package.json`: `"@dentvega/miniapp-contract": "^0.4.1"`.
Si `.npmrc` tiene la línea `@dentvega:registry=https://npm.pkg.github.com`, **borrarla** (npm público es el default).

- [ ] **Step 3: Reinstalar y correr la suite completa**

Run: `pnpm install && pnpm test && pnpm typecheck`
Expected: instala sin `GITHUB_TOKEN`; la suite completa queda verde. **Este es el criterio de aceptación de la fase 1.**

- [ ] **Step 4: Verificar que el build de producción no rompe**

Run: `pnpm build`
Expected: build de Next exitoso.

- [ ] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml .npmrc
git commit -m "chore(deps): consumir @dentvega/miniapp-contract desde npm público"
```

---

# FASE 2 — `@dentvega/miniapp-storage` a paridad

> **Regla de la fase:** NO se agregan providers nuevos. Solo se extrae lo que ya existe. Así, si algo se rompe, se sabe que fue la extracción y no un adapter nuevo.

### Task 4: Scaffold del package + `types.ts`

**Files:**
- Create: `repack-miniapps/packages/miniapp-storage/package.json`
- Create: `repack-miniapps/packages/miniapp-storage/tsconfig.json`
- Create: `repack-miniapps/packages/miniapp-storage/tsconfig.build.json`
- Create: `repack-miniapps/packages/miniapp-storage/vitest.config.ts`
- Create: `repack-miniapps/packages/miniapp-storage/src/types.ts`
- Test: `repack-miniapps/packages/miniapp-storage/src/__tests__/types.test.ts`

**Interfaces:**
- Consumes: `tsconfig.base.json` (Task 1).
- Produces: `ChunkStorage`, `StorageFile`, `StorageError`, `SignedFetch`, `PlainFetch`, `FetchInit`, `FetchResponse`, `PutCall`.

- [ ] **Step 1: Escribir el `package.json`**

```json
{
  "name": "@dentvega/miniapp-storage",
  "version": "0.1.0",
  "description": "Multi-cloud chunk storage for Re.Pack miniapp platforms: R2, S3, GCS, Azure, Vercel Blob, fs.",
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": { "types": "./dist/index.d.ts", "default": "./dist/index.js" },
    "./vercel-blob": { "types": "./dist/vercel-blob.d.ts", "default": "./dist/vercel-blob.js" }
  },
  "files": ["dist"],
  "publishConfig": { "access": "public" },
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "prepack": "pnpm build"
  },
  "dependencies": { "aws4fetch": "^1.0.20" },
  "peerDependencies": { "@vercel/blob": "^2.0.0" },
  "peerDependenciesMeta": { "@vercel/blob": { "optional": true } },
  "devDependencies": {
    "@vercel/blob": "^2.6.1",
    "typescript": "^5.6.3",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Escribir los tsconfig y vitest.config**

`tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "rootDir": "src", "outDir": "dist" },
  "include": ["src"]
}
```

`tsconfig.build.json`:
```json
{
  "extends": "./tsconfig.json",
  "exclude": ["src/**/*.test.ts", "src/**/__tests__/**"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { include: ["src/**/*.test.ts"] } });
```

- [ ] **Step 3: Escribir el test de `types.ts`**

`src/__tests__/types.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { StorageError } from "../types";

describe("StorageError", () => {
  it("lleva code STORAGE_ERROR y el mensaje", () => {
    const err = new StorageError("boom");
    expect(err.code).toBe("STORAGE_ERROR");
    expect(err.message).toBe("boom");
    expect(err.name).toBe("StorageError");
    expect(err).toBeInstanceOf(Error);
  });
});
```

- [ ] **Step 4: Correr el test para verlo fallar**

Run: `cd repack-miniapps && pnpm --filter @dentvega/miniapp-storage test`
Expected: FAIL — `Cannot find module '../types'`.

- [ ] **Step 5: Escribir `src/types.ts`**

```ts
/** Un archivo a subir, con su ruta relativa dentro del prefijo versionado. */
export interface StorageFile {
  readonly path: string;
  readonly data: Uint8Array;
}

/** Abstracción sobre el storage de chunks. Dos operaciones, nada más. */
export interface ChunkStorage {
  /** Sube todos los archivos bajo `prefix/`; devuelve la URL base pública de ese prefijo. */
  putMany(prefix: string, files: readonly StorageFile[]): Promise<{ baseUrl: string }>;
  /** Borra todos los objetos bajo `prefix/`. Best-effort (lo usa el prune). */
  deletePrefix(prefix: string): Promise<void>;
}

export class StorageError extends Error {
  readonly code = "STORAGE_ERROR";
  constructor(message: string) {
    super(message);
    this.name = "StorageError";
  }
}

export interface FetchInit {
  method: string;
  body?: Uint8Array;
  headers?: Record<string, string>;
}

export interface FetchResponse {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

/** Fetch inyectable. En prod lo provee aws4fetch (SigV4); en tests, un fake. */
export type SignedFetch = (url: string, init: FetchInit) => Promise<FetchResponse>;

/** Igual que SignedFetch, para adapters que no firman la request (Azure usa SAS). */
export type PlainFetch = SignedFetch;

/** Registro de una llamada a putMany, para el mock de tests. */
export interface PutCall {
  prefix: string;
  files: StorageFile[];
}
```

- [ ] **Step 6: Correr el test para verlo pasar**

Run: `pnpm --filter @dentvega/miniapp-storage test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(storage): scaffold del package + interfaz ChunkStorage"
```

---

### Task 5: El motor `s3Compatible`

**Files:**
- Create: `repack-miniapps/packages/miniapp-storage/src/s3compat.ts`
- Test: `repack-miniapps/packages/miniapp-storage/src/__tests__/s3compat.test.ts`

**Interfaces:**
- Consumes: `ChunkStorage`, `StorageFile`, `StorageError`, `SignedFetch`, `FetchInit`, `FetchResponse` de `../types` (Task 4).
- Produces: `s3Compatible(config: S3CompatConfig, fetchImpl?: SignedFetch): ChunkStorage`, `type S3CompatConfig`, `signedFetchFor(config): SignedFetch`, `contentType(path): string`.

- [ ] **Step 1: Escribir los tests que fallan**

`src/__tests__/s3compat.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { s3Compatible } from "../s3compat";
import { StorageError } from "../types";
import type { FetchInit, SignedFetch } from "../types";

const config = {
  endpoint: "https://acct123.r2.cloudflarestorage.com/chunks",
  region: "auto",
  accessKeyId: "ak",
  secretAccessKey: "sk",
  publicBaseUrl: "https://cdn.example.com/",
};

function recorder() {
  const calls: { url: string; init: FetchInit }[] = [];
  const fake: SignedFetch = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "GET") {
      return {
        ok: true,
        status: 200,
        text: async () =>
          "<ListBucketResult><Contents><Key>app/1.0.0/a.bundle</Key></Contents>" +
          "<Contents><Key>app/1.0.0/b.bundle</Key></Contents></ListBucketResult>",
      };
    }
    return { ok: true, status: 200, text: async () => "" };
  };
  return { calls, fake };
}

describe("s3Compatible.putMany", () => {
  it("PUTea cada archivo al endpoint y devuelve la URL pública como baseUrl", async () => {
    const { calls, fake } = recorder();
    const res = await s3Compatible(config, fake).putMany("app/1.0.0", [
      { path: "app.container.js.bundle", data: new Uint8Array([1, 2]) },
      { path: "vendors.chunk.bundle", data: new Uint8Array([3]) },
    ]);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe(
      "https://acct123.r2.cloudflarestorage.com/chunks/app/1.0.0/app.container.js.bundle",
    );
    expect(calls[0]!.init.method).toBe("PUT");
    // La URL de lectura es OTRO host que la de escritura, y se le saca la barra final.
    expect(res.baseUrl).toBe("https://cdn.example.com/app/1.0.0");
  });

  it("manda content-type según la extensión", async () => {
    const { calls, fake } = recorder();
    await s3Compatible(config, fake).putMany("p", [
      { path: "a.bundle", data: new Uint8Array([1]) },
      { path: "b.json", data: new Uint8Array([2]) },
    ]);
    expect(calls[0]!.init.headers!["content-type"]).toBe("application/javascript");
    expect(calls[1]!.init.headers!["content-type"]).toBe("application/json");
  });

  it("pinea content-length solo si pinContentLength está activo", async () => {
    const withPin = recorder();
    await s3Compatible({ ...config, pinContentLength: true }, withPin.fake).putMany("p", [
      { path: "a.bundle", data: new Uint8Array([1, 2, 3]) },
    ]);
    expect(withPin.calls[0]!.init.headers!["content-length"]).toBe("3");

    const noPin = recorder();
    await s3Compatible(config, noPin.fake).putMany("p", [
      { path: "a.bundle", data: new Uint8Array([1, 2, 3]) },
    ]);
    expect(noPin.calls[0]!.init.headers!["content-length"]).toBeUndefined();
  });

  it("tira StorageError si no hay archivos", async () => {
    const { fake } = recorder();
    await expect(s3Compatible(config, fake).putMany("p", [])).rejects.toThrow(StorageError);
  });

  it("tira StorageError si el PUT devuelve no-ok", async () => {
    const fake: SignedFetch = async () => ({ ok: false, status: 403, text: async () => "" });
    await expect(
      s3Compatible(config, fake).putMany("p", [{ path: "a", data: new Uint8Array([1]) }]),
    ).rejects.toThrow(/403/);
  });
});

describe("s3Compatible.deletePrefix", () => {
  it("lista bajo el prefijo y borra cada key", async () => {
    const { calls, fake } = recorder();
    await s3Compatible(config, fake).deletePrefix("app/1.0.0");
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.url).toContain("list-type=2");
    expect(calls[0]!.url).toContain(encodeURIComponent("app/1.0.0/"));
    const deletes = calls.filter((c) => c.init.method === "DELETE").map((c) => c.url);
    expect(deletes).toEqual([
      "https://acct123.r2.cloudflarestorage.com/chunks/app/1.0.0/a.bundle",
      "https://acct123.r2.cloudflarestorage.com/chunks/app/1.0.0/b.bundle",
    ]);
  });

  it("no borra nada si el listado falla (best-effort)", async () => {
    const calls: string[] = [];
    const fake: SignedFetch = async (url, init) => {
      calls.push(init.method);
      return { ok: false, status: 500, text: async () => "" };
    };
    await s3Compatible(config, fake).deletePrefix("p");
    expect(calls).toEqual(["GET"]);
  });
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `pnpm --filter @dentvega/miniapp-storage test`
Expected: FAIL — `Cannot find module '../s3compat'`.

- [ ] **Step 3: Implementar `src/s3compat.ts`**

```ts
import { AwsClient } from "aws4fetch";
import { StorageError, type ChunkStorage, type SignedFetch } from "./types";

export interface S3CompatConfig {
  /** URL base del bucket, ya resuelta (sin barra final). */
  readonly endpoint: string;
  /** "auto" para R2 y GCS; la región real para AWS. */
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** De dónde LEE el host. Puede ser otro host que el de escritura (R2: dominio público). */
  readonly publicBaseUrl: string;
  /**
   * Fuerza `content-length` explícito. R2 rechaza uploads chunked con HTTP 411, y el fetch
   * parcheado de Next puede convertir un buffer en stream. AWS y GCS no lo necesitan.
   */
  readonly pinContentLength?: boolean;
}

export function contentType(path: string): string {
  if (path.endsWith(".js") || path.endsWith(".bundle")) return "application/javascript";
  if (path.endsWith(".json")) return "application/json";
  return "application/octet-stream";
}

/** Fetch firmado con SigV4. Es lo que usan R2, AWS S3 y GCS (modo interoperabilidad). */
export function signedFetchFor(config: S3CompatConfig): SignedFetch {
  const aws = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: config.region,
  });
  return async (url, init) => {
    const res = await aws.fetch(url, init as RequestInit);
    return { ok: res.ok, status: res.status, text: () => res.text() };
  };
}

/**
 * Motor S3-compatible. Las ESCRITURAS van firmadas al `endpoint`; las LECTURAS salen de
 * `publicBaseUrl` — dos hosts distintos, por eso putMany escribe en uno y devuelve el otro.
 * Idempotente (PUT sobreescribe).
 */
export function s3Compatible(config: S3CompatConfig, fetchImpl?: SignedFetch): ChunkStorage {
  const doFetch = fetchImpl ?? signedFetchFor(config);
  const base = config.endpoint.replace(/\/+$/, "");
  const publicBase = config.publicBaseUrl.replace(/\/+$/, "");
  return {
    async putMany(prefix, files): Promise<{ baseUrl: string }> {
      if (files.length === 0) throw new StorageError("no files to upload");
      try {
        for (const file of files) {
          const headers: Record<string, string> = { "content-type": contentType(file.path) };
          if (config.pinContentLength) {
            headers["content-length"] = String(file.data.byteLength);
          }
          const res = await doFetch(`${base}/${prefix}/${file.path}`, {
            method: "PUT",
            body: file.data,
            headers,
          });
          if (!res.ok) throw new StorageError(`S3 PUT failed: HTTP ${res.status}`);
        }
      } catch (err) {
        if (err instanceof StorageError) throw err;
        throw new StorageError(err instanceof Error ? err.message : "S3 upload failed");
      }
      return { baseUrl: `${publicBase}/${prefix}` };
    },
    async deletePrefix(prefix): Promise<void> {
      // ListObjectsV2 → DELETE por key. Best-effort: si el listado falla, no borramos nada.
      const listRes = await doFetch(
        `${base}?list-type=2&prefix=${encodeURIComponent(`${prefix}/`)}`,
        { method: "GET" },
      );
      if (!listRes.ok) return;
      const xml = await listRes.text();
      const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]!);
      for (const key of keys) {
        await doFetch(`${base}/${key}`, { method: "DELETE" });
      }
    },
  };
}
```

- [ ] **Step 4: Correr los tests para verlos pasar**

Run: `pnpm --filter @dentvega/miniapp-storage test`
Expected: PASS, los 7 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(storage): motor s3Compatible (SigV4, putMany/deletePrefix)"
```

---

### Task 6: `r2Storage` sobre el motor (paridad con el original)

**Files:**
- Create: `repack-miniapps/packages/miniapp-storage/src/r2.ts`
- Test: `repack-miniapps/packages/miniapp-storage/src/__tests__/r2.test.ts`

**Interfaces:**
- Consumes: `s3Compatible`, `S3CompatConfig` (Task 5).
- Produces: `r2Storage(config: R2Config, fetchImpl?: SignedFetch): ChunkStorage`, `r2ConfigFromEnv(env): R2Config | null`, `type R2Config`.

- [ ] **Step 1: Escribir los tests que fallan**

`src/__tests__/r2.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { r2Storage, r2ConfigFromEnv } from "../r2";
import type { FetchInit, SignedFetch } from "../types";

const config = {
  accountId: "acct123",
  accessKeyId: "ak",
  secretAccessKey: "sk",
  bucket: "chunks",
  publicBaseUrl: "https://cdn.example.com/",
};

describe("r2ConfigFromEnv", () => {
  it("null si falta alguna de las 5 vars", () => {
    expect(r2ConfigFromEnv({ R2_ACCOUNT_ID: "x" })).toBeNull();
  });
  it("devuelve la config con las 5", () => {
    expect(
      r2ConfigFromEnv({
        R2_ACCOUNT_ID: "a",
        R2_ACCESS_KEY_ID: "b",
        R2_SECRET_ACCESS_KEY: "c",
        R2_BUCKET: "d",
        R2_PUBLIC_BASE_URL: "e",
      }),
    ).toEqual({
      accountId: "a",
      accessKeyId: "b",
      secretAccessKey: "c",
      bucket: "d",
      publicBaseUrl: "e",
    });
  });
});

describe("r2Storage", () => {
  it("escribe al endpoint S3 de R2 y pinea content-length (R2 rechaza chunked)", async () => {
    const calls: { url: string; init: FetchInit }[] = [];
    const fake: SignedFetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => "" };
    };
    const res = await r2Storage(config, fake).putMany("app/1.0.0", [
      { path: "app.container.js.bundle", data: new Uint8Array([1, 2]) },
    ]);
    expect(calls[0]!.url).toBe(
      "https://acct123.r2.cloudflarestorage.com/chunks/app/1.0.0/app.container.js.bundle",
    );
    expect(calls[0]!.init.headers!["content-length"]).toBe("2");
    expect(res.baseUrl).toBe("https://cdn.example.com/app/1.0.0");
  });
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `pnpm --filter @dentvega/miniapp-storage test`
Expected: FAIL — `Cannot find module '../r2'`.

- [ ] **Step 3: Implementar `src/r2.ts`**

```ts
import { s3Compatible } from "./s3compat";
import type { ChunkStorage, SignedFetch } from "./types";

export interface R2Config {
  readonly accountId: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly bucket: string;
  readonly publicBaseUrl: string;
}

/** Config de R2 desde un env; null si falta alguna de las 5 vars. */
export function r2ConfigFromEnv(env: Record<string, string | undefined>): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID;
  const accessKeyId = env.R2_ACCESS_KEY_ID;
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY;
  const bucket = env.R2_BUCKET;
  const publicBaseUrl = env.R2_PUBLIC_BASE_URL;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicBaseUrl) return null;
  return { accountId, accessKeyId, secretAccessKey, bucket, publicBaseUrl };
}

/** Cloudflare R2: S3-compatible, región "auto", y necesita content-length explícito. */
export function r2Storage(config: R2Config, fetchImpl?: SignedFetch): ChunkStorage {
  return s3Compatible(
    {
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com/${config.bucket}`,
      region: "auto",
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      publicBaseUrl: config.publicBaseUrl,
      pinContentLength: true,
    },
    fetchImpl,
  );
}
```

- [ ] **Step 4: Correr los tests para verlos pasar**

Run: `pnpm --filter @dentvega/miniapp-storage test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(storage): r2Storage sobre el motor s3Compatible"
```

---

### Task 7: `fsStorage` y `mockStorage`

**Files:**
- Create: `repack-miniapps/packages/miniapp-storage/src/fs.ts`
- Create: `repack-miniapps/packages/miniapp-storage/src/mock.ts`
- Test: `repack-miniapps/packages/miniapp-storage/src/__tests__/fs.test.ts`

**Interfaces:**
- Consumes: `ChunkStorage`, `StorageFile`, `StorageError`, `PutCall` (Task 4).
- Produces: `fsStorage(root: string, baseOrigin: string): ChunkStorage`, `mockStorage(): ChunkStorage & { puts: PutCall[]; deletes: string[] }`.

> **Nota de diseño:** el `fsStorage` original hardcodea `process.cwd()/public/chunks` y un puerto de desarrollo. Una librería no puede asumir la estructura de directorios del consumidor, así que `root` y `baseOrigin` pasan a ser **parámetros obligatorios**. `backstage-web` le pasará sus valores actuales en la Task 10.

- [ ] **Step 1: Escribir el test que falla**

`src/__tests__/fs.test.ts`:
```ts
import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fsStorage } from "../fs";
import { StorageError } from "../types";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(path.join(tmpdir(), "storage-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("fsStorage", () => {
  it("escribe los archivos bajo root/prefix y devuelve la baseUrl", async () => {
    const root = tmp();
    const res = await fsStorage(root, "http://localhost:3999/chunks").putMany("app/1.0.0", [
      { path: "app.bundle", data: new Uint8Array([1, 2, 3]) },
    ]);
    expect(res.baseUrl).toBe("http://localhost:3999/chunks/app/1.0.0");
    expect([...readFileSync(path.join(root, "app/1.0.0/app.bundle"))]).toEqual([1, 2, 3]);
  });

  it("crea subdirectorios anidados", async () => {
    const root = tmp();
    await fsStorage(root, "http://x").putMany("app/1.0.0", [
      { path: "ios/app.bundle", data: new Uint8Array([9]) },
    ]);
    expect(existsSync(path.join(root, "app/1.0.0/ios/app.bundle"))).toBe(true);
  });

  it("deletePrefix borra el árbol y no falla si no existe", async () => {
    const root = tmp();
    const s = fsStorage(root, "http://x");
    await s.putMany("app/1.0.0", [{ path: "a.bundle", data: new Uint8Array([1]) }]);
    await s.deletePrefix("app/1.0.0");
    expect(existsSync(path.join(root, "app/1.0.0"))).toBe(false);
    await expect(s.deletePrefix("no/existe")).resolves.toBeUndefined();
  });

  it("tira StorageError si no hay archivos", async () => {
    await expect(fsStorage(tmp(), "http://x").putMany("p", [])).rejects.toThrow(StorageError);
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm --filter @dentvega/miniapp-storage test`
Expected: FAIL — `Cannot find module '../fs'`.

- [ ] **Step 3: Implementar `src/fs.ts` y `src/mock.ts`**

`src/fs.ts`:
```ts
import { promises as fs } from "node:fs";
import path from "node:path";
import { StorageError, type ChunkStorage } from "./types";

/**
 * Storage en disco, para desarrollo. NO sirve en serverless (el fs es efímero).
 * `root` es el directorio donde se escribe; `baseOrigin`, la URL desde la que se sirve.
 */
export function fsStorage(root: string, baseOrigin: string): ChunkStorage {
  const origin = baseOrigin.replace(/\/+$/, "");
  return {
    async putMany(prefix, files) {
      if (files.length === 0) throw new StorageError("no files to upload");
      const dest = path.join(root, prefix);
      await fs.mkdir(dest, { recursive: true });
      for (const file of files) {
        const target = path.join(dest, file.path);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, file.data);
      }
      return { baseUrl: `${origin}/${prefix}` };
    },
    async deletePrefix(prefix) {
      await fs.rm(path.join(root, prefix), { recursive: true, force: true });
    },
  };
}
```

`src/mock.ts`:
```ts
import type { ChunkStorage, PutCall } from "./types";

/** Storage en memoria para tests: registra uploads y deletes, baseUrl determinística. */
export function mockStorage(): ChunkStorage & { puts: PutCall[]; deletes: string[] } {
  const puts: PutCall[] = [];
  const deletes: string[] = [];
  return {
    puts,
    deletes,
    async putMany(prefix, files) {
      puts.push({ prefix, files: [...files] });
      return { baseUrl: `https://mock.storage/${prefix}` };
    },
    async deletePrefix(prefix) {
      deletes.push(prefix);
    },
  };
}
```

- [ ] **Step 4: Correr los tests para verlos pasar**

Run: `pnpm --filter @dentvega/miniapp-storage test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(storage): adapters fs y mock"
```

---

### Task 8: `blobStorage` por subpath export

**Files:**
- Create: `repack-miniapps/packages/miniapp-storage/src/vercel-blob.ts`
- Test: `repack-miniapps/packages/miniapp-storage/src/__tests__/vercel-blob.test.ts`

**Interfaces:**
- Consumes: `ChunkStorage`, `StorageError` (Task 4).
- Produces: `blobStorage(token?: string, deps?: BlobDeps): ChunkStorage`, `type BlobDeps`. Importable **solo** desde `@dentvega/miniapp-storage/vercel-blob`.

> **Por qué va aparte:** `@vercel/blob` es peer opcional. Si `blobStorage` viviera en el entry principal, cualquiera que importe la librería sin tener `@vercel/blob` instalado rompería al resolver el import. El subpath lo aísla. Además `deps` se inyecta para poder testear sin el package real.

- [ ] **Step 1: Escribir el test que falla**

`src/__tests__/vercel-blob.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { blobStorage } from "../vercel-blob";
import { StorageError } from "../types";

function fakeDeps() {
  const puts: { path: string; opts: Record<string, unknown> }[] = [];
  const dels: string[][] = [];
  return {
    puts,
    dels,
    deps: {
      put: async (p: string, _body: Buffer, opts: Record<string, unknown>) => {
        puts.push({ path: p, opts });
        return { url: `https://blob.example.com/${p}` };
      },
      list: async () => ({ blobs: [{ url: "https://blob.example.com/app/1.0.0/a.bundle" }] }),
      del: async (urls: string[]) => {
        dels.push(urls);
      },
    },
  };
}

describe("blobStorage", () => {
  it("sube cada archivo y deriva la baseUrl del prefijo", async () => {
    const { puts, deps } = fakeDeps();
    const res = await blobStorage("tok", deps).putMany("app/1.0.0", [
      { path: "a.bundle", data: new Uint8Array([1]) },
    ]);
    expect(puts[0]!.path).toBe("app/1.0.0/a.bundle");
    // Debe sobreescribir: republicar la misma versión no puede dar 409.
    expect(puts[0]!.opts.allowOverwrite).toBe(true);
    expect(puts[0]!.opts.addRandomSuffix).toBe(false);
    expect(res.baseUrl).toBe("https://blob.example.com/app/1.0.0");
  });

  it("deletePrefix borra las URLs listadas", async () => {
    const { dels, deps } = fakeDeps();
    await blobStorage("tok", deps).deletePrefix("app/1.0.0");
    expect(dels[0]).toEqual(["https://blob.example.com/app/1.0.0/a.bundle"]);
  });

  it("tira StorageError si no hay archivos", async () => {
    const { deps } = fakeDeps();
    await expect(blobStorage("tok", deps).putMany("p", [])).rejects.toThrow(StorageError);
  });
});
```

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `pnpm --filter @dentvega/miniapp-storage test`
Expected: FAIL — `Cannot find module '../vercel-blob'`.

- [ ] **Step 3: Implementar `src/vercel-blob.ts`**

```ts
import { StorageError, type ChunkStorage } from "./types";

/** Las tres funciones de @vercel/blob que usamos. Inyectables para testear sin el package. */
export interface BlobDeps {
  put(
    path: string,
    body: Buffer,
    opts: Record<string, unknown>,
  ): Promise<{ url: string }>;
  list(opts: Record<string, unknown>): Promise<{ blobs: { url: string }[] }>;
  del(urls: string[], opts: Record<string, unknown>): Promise<void>;
}

async function realDeps(): Promise<BlobDeps> {
  const mod = await import("@vercel/blob");
  return mod as unknown as BlobDeps;
}

/** Vercel Blob. Requiere el peer opcional `@vercel/blob` instalado. */
export function blobStorage(token?: string, deps?: BlobDeps): ChunkStorage {
  const get = async (): Promise<BlobDeps> => deps ?? (await realDeps());
  return {
    async putMany(prefix, files) {
      if (files.length === 0) throw new StorageError("no files to upload");
      const { put } = await get();
      try {
        let baseUrl = "";
        for (const file of files) {
          const { url } = await put(`${prefix}/${file.path}`, Buffer.from(file.data), {
            access: "public",
            addRandomSuffix: false,
            // Republicar la misma <id>/<version> debe sobreescribir, no 409ear.
            allowOverwrite: true,
            token,
          });
          if (baseUrl === "") baseUrl = url.slice(0, url.length - file.path.length - 1);
        }
        return { baseUrl };
      } catch (err) {
        if (err instanceof StorageError) throw err;
        throw new StorageError(err instanceof Error ? err.message : "blob upload failed");
      }
    },
    async deletePrefix(prefix) {
      const { list, del } = await get();
      const { blobs } = await list({ prefix: `${prefix}/`, token });
      if (blobs.length > 0) await del(blobs.map((b) => b.url), { token });
    },
  };
}
```

- [ ] **Step 4: Correr los tests para verlos pasar**

Run: `pnpm --filter @dentvega/miniapp-storage test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat(storage): blobStorage por subpath export (peer opcional)"
```

---

### Task 9: Selección de provider (funciones puras) + `index.ts`

**Files:**
- Create: `repack-miniapps/packages/miniapp-storage/src/provider.ts`
- Create: `repack-miniapps/packages/miniapp-storage/src/index.ts`
- Test: `repack-miniapps/packages/miniapp-storage/src/__tests__/provider.test.ts`

**Interfaces:**
- Consumes: `r2ConfigFromEnv` (Task 6).
- Produces: `type StorageProvider = "s3" | "r2" | "gcs" | "azure" | "blob" | "fs"`, `isStorageProvider(v): v is StorageProvider`, `availableProviders(env): StorageProvider[]`, `selectStorage(available, preference, override): StorageProvider`. `index.ts` reexporta todo salvo `vercel-blob`.

> **Nota:** en esta fase `availableProviders` solo detecta `r2`, `blob` y `fs` — los providers nuevos se suman en la fase 3. El tipo `StorageProvider` ya los incluye para no cambiarlo dos veces.

- [ ] **Step 1: Escribir los tests que fallan**

`src/__tests__/provider.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { availableProviders, selectStorage, isStorageProvider } from "../provider";

const r2Env = {
  R2_ACCOUNT_ID: "a",
  R2_ACCESS_KEY_ID: "b",
  R2_SECRET_ACCESS_KEY: "c",
  R2_BUCKET: "d",
  R2_PUBLIC_BASE_URL: "e",
};

describe("isStorageProvider", () => {
  it("acepta los válidos y rechaza el resto", () => {
    expect(isStorageProvider("r2")).toBe(true);
    expect(isStorageProvider("azure")).toBe(true);
    expect(isStorageProvider("dropbox")).toBe(false);
    expect(isStorageProvider(null)).toBe(false);
  });
});

describe("availableProviders", () => {
  it("fs siempre está disponible", () => {
    expect(availableProviders({})).toEqual(["fs"]);
  });
  it("r2 si están las 5 vars, en precedencia sobre blob", () => {
    expect(availableProviders({ ...r2Env, BLOB_READ_WRITE_TOKEN: "t" })).toEqual([
      "r2",
      "blob",
      "fs",
    ]);
  });
  it("blob si está su token", () => {
    expect(availableProviders({ BLOB_READ_WRITE_TOKEN: "t" })).toEqual(["blob", "fs"]);
  });
});

describe("selectStorage", () => {
  const available = ["r2", "blob", "fs"] as const;
  it("sin preferencia ni override, el primero del env-order", () => {
    expect(selectStorage(available, null, null)).toBe("r2");
  });
  it("la preferencia gana sobre el env-order", () => {
    expect(selectStorage(available, "blob", null)).toBe("blob");
  });
  it("el override de la miniapp gana sobre la preferencia", () => {
    expect(selectStorage(available, "blob", "fs")).toBe("fs");
  });
  it("ignora una preferencia no disponible y cae al env-order", () => {
    expect(selectStorage(available, "azure", null)).toBe("r2");
  });
  it("ignora un override no disponible y cae a la preferencia", () => {
    expect(selectStorage(available, "blob", "azure")).toBe("blob");
  });
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `pnpm --filter @dentvega/miniapp-storage test`
Expected: FAIL — `Cannot find module '../provider'`.

- [ ] **Step 3: Implementar `src/provider.ts`**

```ts
import { r2ConfigFromEnv } from "./r2";

export type StorageProvider = "s3" | "r2" | "gcs" | "azure" | "blob" | "fs";

const ALL: readonly StorageProvider[] = ["s3", "r2", "gcs", "azure", "blob", "fs"];

export function isStorageProvider(v: unknown): v is StorageProvider {
  return typeof v === "string" && (ALL as readonly string[]).includes(v);
}

/** Providers configurados por env, en orden de precedencia. `fs` siempre está. */
export function availableProviders(env: Record<string, string | undefined>): StorageProvider[] {
  const out: StorageProvider[] = [];
  if (r2ConfigFromEnv(env) !== null) out.push("r2");
  if (env.BLOB_READ_WRITE_TOKEN) out.push("blob");
  out.push("fs");
  return out;
}

/**
 * Provider efectivo: override de la miniapp → preferencia global → primero del env-order.
 * Un valor que no esté en `available` se ignora (nunca deja al consumidor sin storage).
 */
export function selectStorage(
  available: readonly StorageProvider[],
  preference: StorageProvider | null,
  override: StorageProvider | null,
): StorageProvider {
  if (override !== null && available.includes(override)) return override;
  if (preference !== null && available.includes(preference)) return preference;
  return available[0]!;
}
```

- [ ] **Step 4: Escribir `src/index.ts`**

```ts
export type {
  ChunkStorage,
  StorageFile,
  SignedFetch,
  PlainFetch,
  FetchInit,
  FetchResponse,
  PutCall,
} from "./types";
export { StorageError } from "./types";
export { s3Compatible, contentType, signedFetchFor, type S3CompatConfig } from "./s3compat";
export { r2Storage, r2ConfigFromEnv, type R2Config } from "./r2";
export { fsStorage } from "./fs";
export { mockStorage } from "./mock";
export {
  availableProviders,
  selectStorage,
  isStorageProvider,
  type StorageProvider,
} from "./provider";
// blobStorage NO se exporta acá: vive en "@dentvega/miniapp-storage/vercel-blob"
// porque @vercel/blob es un peer opcional.
```

- [ ] **Step 5: Correr tests, typecheck y build**

Run: `pnpm --filter @dentvega/miniapp-storage test && pnpm --filter @dentvega/miniapp-storage typecheck && pnpm --filter @dentvega/miniapp-storage build`
Expected: todo PASS, y `dist/index.js` + `dist/vercel-blob.js` existen.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(storage): selección de provider (pura) + entry point"
```

---

### Task 10: Publicar 0.1.0 y migrar `backstage-web`

**Files:**
- Modify: `backstage-web/package.json`
- Modify: `backstage-web/lib/storage/index.ts`
- Delete: `backstage-web/lib/storage/{types,r2,blob,fs,mock,provider}.ts`
- Delete: `backstage-web/lib/storage/__tests__/{r2,storage,provider}.test.ts`
- Keep: `backstage-web/lib/storage/preference.ts` (acoplado a Upstash KV — no viaja)

**Interfaces:**
- Consumes: `@dentvega/miniapp-storage@^0.1.0` (Tasks 4-9).
- Produces: `getStorage()`, `getStorageProviderState()`, `getMiniappStorageState()` con **las mismas firmas de hoy**, para que los ~19 consumidores no cambien.

- [ ] **Step 1: Publicar el package**

```bash
cd /Volumes/SSDExterno/prodproyects/repack-miniapps
pnpm --filter @dentvega/miniapp-storage pack
tar -tzf dentvega-miniapp-storage-0.1.0.tgz   # verificar: solo package/dist y package.json
pnpm --filter @dentvega/miniapp-storage publish --no-git-checks
```
Expected: publicado y público en npm.

- [ ] **Step 2: Instalarlo en `backstage-web` y borrar los archivos extraídos**

```bash
cd /Volumes/SSDExterno/prodproyects/backstage-web
pnpm add @dentvega/miniapp-storage@^0.1.0
rm lib/storage/types.ts lib/storage/r2.ts lib/storage/blob.ts lib/storage/fs.ts \
   lib/storage/mock.ts lib/storage/provider.ts
rm lib/storage/__tests__/r2.test.ts lib/storage/__tests__/storage.test.ts \
   lib/storage/__tests__/provider.test.ts
```

- [ ] **Step 3: Reescribir `lib/storage/index.ts` como capa fina**

```ts
import {
  availableProviders,
  selectStorage,
  r2ConfigFromEnv,
  r2Storage,
  fsStorage,
  type ChunkStorage,
  type StorageProvider,
} from "@dentvega/miniapp-storage";
import { blobStorage } from "@dentvega/miniapp-storage/vercel-blob";
import path from "node:path";
import { getStoragePreferenceStore } from "./preference";

function buildStorage(p: StorageProvider): ChunkStorage {
  if (p === "r2") {
    const cfg = r2ConfigFromEnv(process.env);
    if (cfg === null) throw new Error("R2 selected but not configured");
    return r2Storage(cfg);
  }
  if (p === "blob") return blobStorage(process.env.BLOB_READ_WRITE_TOKEN);
  // El fs adapter de la librería no asume estructura de directorios: se la pasamos nosotros.
  return fsStorage(
    path.join(process.cwd(), "public", "chunks"),
    `${process.env.BACKSTAGE_PUBLIC_URL ?? "http://localhost:3999"}/chunks`,
  );
}

/** Provider activo + si vino de la preferencia guardada o del env-order. */
export async function getStorageProviderState(): Promise<{
  available: StorageProvider[];
  active: StorageProvider;
  source: "preference" | "env";
}> {
  const pref = await getStoragePreferenceStore().load();
  const available = availableProviders(process.env);
  const active = selectStorage(available, pref, null);
  return { available, active, source: pref !== null && available.includes(pref) ? "preference" : "env" };
}

/** Estado por-miniapp: override vs default global, con el provider efectivo. */
export async function getMiniappStorageState(
  miniappOverride: StorageProvider | null,
): Promise<{
  available: StorageProvider[];
  override: StorageProvider | null;
  defaultProvider: StorageProvider;
  effective: StorageProvider;
  source: "miniapp" | "preference" | "env";
}> {
  const global = await getStorageProviderState();
  const useOverride = miniappOverride !== null && global.available.includes(miniappOverride);
  return {
    available: global.available,
    override: miniappOverride,
    defaultProvider: global.active,
    effective: useOverride ? miniappOverride : global.active,
    source: useOverride ? "miniapp" : global.source,
  };
}

/** Storage para un publish: override de la miniapp → default global → env-order. */
export async function getStorage(
  miniappOverride: StorageProvider | null = null,
): Promise<ChunkStorage> {
  const { effective } = await getMiniappStorageState(miniappOverride);
  return buildStorage(effective);
}

export type { ChunkStorage, StorageProvider };
```

- [ ] **Step 4: Migrar los llamadores de `mockStorage` (CAMBIA LA FIRMA, no solo la ruta)**

El `mockStorage` viejo recibía los sinks por parámetro (`mockStorage(sink?, deletes?)`); el de la
librería no recibe nada y **expone** `puts` y `deletes` como propiedades. Hay dos llamadores:

`app/api/__tests__/upload-route.test.ts:50-51` — solo cambia el import:
```ts
  const { mockStorage } = await import("@dentvega/miniapp-storage");
  return { getStorage: () => mockStorage() };
```

`lib/registry/__tests__/prune.test.ts:52` — usa la firma vieja y **hay que reescribirlo**:
```ts
  it("borra un prefijo por versión a prunear", async () => {
    const storage = mockStorage();
    await pruneChunks(storage, "acc", ["0.1.0", "0.2.0"] as never);
    expect(storage.deletes.sort()).toEqual(["acc/0.1.0", "acc/0.2.0"]);
  });
```
con el import cambiado a `import { mockStorage } from "@dentvega/miniapp-storage";`.

> Ojo: este test **compila igual** si se deja `mockStorage(undefined, deletes)` — TypeScript no
> se queja de argumentos de más en algunas configuraciones, y el array `deletes` simplemente
> queda vacío, haciendo pasar el `expect` sobre un array vacío por casualidad. Verificá que el
> test siga siendo significativo, no solo que pase.

- [ ] **Step 5: Arreglar los imports rotos en el resto del repo**

Run: `pnpm typecheck`
Expected: errores en los archivos que importaban `@/lib/storage/types`, `@/lib/storage/mock` o `@/lib/storage/provider`. Cambiar cada uno a importar de `@dentvega/miniapp-storage` (o de `@/lib/storage`, que reexporta los tipos). Repetir hasta que `typecheck` pase.

- [ ] **Step 6: Correr la suite completa — criterio de aceptación de la fase 2**

Run: `pnpm test`
Expected: **toda** la suite verde. Los tests que quedan de storage (`select.test.ts`, `preference.test.ts`) siguen pasando; los de adapters ahora viven en la librería.

- [ ] **Step 7: Verificar el build y un publish real**

Run: `pnpm build`
Expected: build de Next exitoso.
Luego, con las credenciales de R2 en el entorno, publicar una versión de prueba de una miniapp y confirmar que el chunk llega al bucket y la miniapp resuelve. **Sin esta verificación manual la fase no está cerrada.**

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(storage): consumir @dentvega/miniapp-storage (extracción a paridad)"
```

---

# FASE 3 — Providers nuevos

### Task 11: `s3Storage` (AWS)

**Files:**
- Create: `repack-miniapps/packages/miniapp-storage/src/s3.ts`
- Test: `repack-miniapps/packages/miniapp-storage/src/__tests__/s3.test.ts`
- Modify: `repack-miniapps/packages/miniapp-storage/src/index.ts`
- Modify: `repack-miniapps/packages/miniapp-storage/src/provider.ts`

**Interfaces:**
- Consumes: `s3Compatible` (Task 5), `availableProviders` (Task 9).
- Produces: `s3Storage(config: S3Config, fetchImpl?: SignedFetch): ChunkStorage`, `s3ConfigFromEnv(env): S3Config | null`, `type S3Config`.

- [ ] **Step 1: Escribir los tests que fallan**

`src/__tests__/s3.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { s3Storage, s3ConfigFromEnv } from "../s3";
import { availableProviders } from "../provider";
import type { FetchInit, SignedFetch } from "../types";

describe("s3ConfigFromEnv", () => {
  it("null si falta alguna var", () => {
    expect(s3ConfigFromEnv({ AWS_S3_BUCKET: "b" })).toBeNull();
  });
  it("usa el public base explícito si está", () => {
    expect(
      s3ConfigFromEnv({
        AWS_S3_BUCKET: "b",
        AWS_REGION: "us-east-1",
        AWS_ACCESS_KEY_ID: "ak",
        AWS_SECRET_ACCESS_KEY: "sk",
        AWS_S3_PUBLIC_BASE_URL: "https://cdn.example.com",
      })!.publicBaseUrl,
    ).toBe("https://cdn.example.com");
  });
  it("sin public base explícito, cae a la URL del bucket", () => {
    expect(
      s3ConfigFromEnv({
        AWS_S3_BUCKET: "b",
        AWS_REGION: "us-east-1",
        AWS_ACCESS_KEY_ID: "ak",
        AWS_SECRET_ACCESS_KEY: "sk",
      })!.publicBaseUrl,
    ).toBe("https://b.s3.us-east-1.amazonaws.com");
  });
});

describe("s3Storage", () => {
  it("escribe al endpoint virtual-hosted de la región, sin pinear content-length", async () => {
    const calls: { url: string; init: FetchInit }[] = [];
    const fake: SignedFetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => "" };
    };
    await s3Storage(
      {
        bucket: "my-bucket",
        region: "eu-west-1",
        accessKeyId: "ak",
        secretAccessKey: "sk",
        publicBaseUrl: "https://cdn.example.com",
      },
      fake,
    ).putMany("app/1.0.0", [{ path: "a.bundle", data: new Uint8Array([1]) }]);
    expect(calls[0]!.url).toBe(
      "https://my-bucket.s3.eu-west-1.amazonaws.com/app/1.0.0/a.bundle",
    );
    // AWS acepta chunked: pinear content-length es un workaround de R2, no va acá.
    expect(calls[0]!.init.headers!["content-length"]).toBeUndefined();
  });
});

describe("availableProviders con S3", () => {
  it("detecta s3 y lo pone antes que fs", () => {
    expect(
      availableProviders({
        AWS_S3_BUCKET: "b",
        AWS_REGION: "us-east-1",
        AWS_ACCESS_KEY_ID: "ak",
        AWS_SECRET_ACCESS_KEY: "sk",
      }),
    ).toEqual(["s3", "fs"]);
  });
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `pnpm --filter @dentvega/miniapp-storage test`
Expected: FAIL — `Cannot find module '../s3'`.

- [ ] **Step 3: Implementar `src/s3.ts`**

```ts
import { s3Compatible } from "./s3compat";
import type { ChunkStorage, SignedFetch } from "./types";

export interface S3Config {
  readonly bucket: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** De dónde lee el host: el bucket público, o un CloudFront delante. */
  readonly publicBaseUrl: string;
}

/** Config de AWS S3 desde un env; null si falta alguna de las 4 obligatorias. */
export function s3ConfigFromEnv(env: Record<string, string | undefined>): S3Config | null {
  const bucket = env.AWS_S3_BUCKET;
  const region = env.AWS_REGION;
  const accessKeyId = env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = env.AWS_SECRET_ACCESS_KEY;
  if (!bucket || !region || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    region,
    accessKeyId,
    secretAccessKey,
    // Sin CDN explícito, se lee del propio bucket (requiere que sea público).
    publicBaseUrl: env.AWS_S3_PUBLIC_BASE_URL ?? `https://${bucket}.s3.${region}.amazonaws.com`,
  };
}

/** AWS S3, endpoint virtual-hosted. No necesita el pin de content-length que pide R2. */
export function s3Storage(config: S3Config, fetchImpl?: SignedFetch): ChunkStorage {
  return s3Compatible(
    {
      endpoint: `https://${config.bucket}.s3.${config.region}.amazonaws.com`,
      region: config.region,
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      publicBaseUrl: config.publicBaseUrl,
    },
    fetchImpl,
  );
}
```

- [ ] **Step 4: Registrar el provider**

En `src/provider.ts`, agregar el import `import { s3ConfigFromEnv } from "./s3";` y, como **primera** línea del cuerpo de `availableProviders`:
```ts
  if (s3ConfigFromEnv(env) !== null) out.push("s3");
```
En `src/index.ts`, agregar:
```ts
export { s3Storage, s3ConfigFromEnv, type S3Config } from "./s3";
```

- [ ] **Step 5: Correr los tests para verlos pasar**

Run: `pnpm --filter @dentvega/miniapp-storage test`
Expected: PASS, incluidos los de `provider.test.ts` que ya existían.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(storage): adapter de AWS S3"
```

---

### Task 12: `gcsStorage` (Google Cloud Storage)

**Files:**
- Create: `repack-miniapps/packages/miniapp-storage/src/gcs.ts`
- Test: `repack-miniapps/packages/miniapp-storage/src/__tests__/gcs.test.ts`
- Modify: `repack-miniapps/packages/miniapp-storage/src/index.ts`
- Modify: `repack-miniapps/packages/miniapp-storage/src/provider.ts`

**Interfaces:**
- Consumes: `s3Compatible` (Task 5).
- Produces: `gcsStorage(config: GcsConfig, fetchImpl?: SignedFetch): ChunkStorage`, `gcsConfigFromEnv(env): GcsConfig | null`, `type GcsConfig`.

> **Modo de auth:** XML API en modo interoperabilidad, con claves HMAC. Es SigV4 igual que S3, por eso entra por el mismo motor. La limitación (claves estáticas, algunas organizaciones las prohíben) está documentada en el spec.

- [ ] **Step 1: Escribir los tests que fallan**

`src/__tests__/gcs.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { gcsStorage, gcsConfigFromEnv } from "../gcs";
import { availableProviders } from "../provider";
import type { FetchInit, SignedFetch } from "../types";

const env = {
  GCS_BUCKET: "my-bucket",
  GCS_HMAC_ACCESS_KEY_ID: "GOOG1EXAMPLE",
  GCS_HMAC_SECRET: "sk",
};

describe("gcsConfigFromEnv", () => {
  it("null si falta alguna var", () => {
    expect(gcsConfigFromEnv({ GCS_BUCKET: "b" })).toBeNull();
  });
  it("sin public base explícito, cae a la URL pública de GCS", () => {
    expect(gcsConfigFromEnv(env)!.publicBaseUrl).toBe(
      "https://storage.googleapis.com/my-bucket",
    );
  });
});

describe("gcsStorage", () => {
  it("escribe al endpoint XML de GCS con region auto", async () => {
    const calls: { url: string; init: FetchInit }[] = [];
    const fake: SignedFetch = async (url, init) => {
      calls.push({ url, init });
      return { ok: true, status: 200, text: async () => "" };
    };
    const res = await gcsStorage(
      {
        bucket: "my-bucket",
        accessKeyId: "GOOG1EXAMPLE",
        secretAccessKey: "sk",
        publicBaseUrl: "https://storage.googleapis.com/my-bucket",
      },
      fake,
    ).putMany("app/1.0.0", [{ path: "a.bundle", data: new Uint8Array([1]) }]);
    expect(calls[0]!.url).toBe(
      "https://storage.googleapis.com/my-bucket/app/1.0.0/a.bundle",
    );
    expect(res.baseUrl).toBe("https://storage.googleapis.com/my-bucket/app/1.0.0");
  });
});

describe("availableProviders con GCS", () => {
  it("detecta gcs", () => {
    expect(availableProviders(env)).toEqual(["gcs", "fs"]);
  });
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `pnpm --filter @dentvega/miniapp-storage test`
Expected: FAIL — `Cannot find module '../gcs'`.

- [ ] **Step 3: Implementar `src/gcs.ts`**

```ts
import { s3Compatible } from "./s3compat";
import type { ChunkStorage, SignedFetch } from "./types";

export interface GcsConfig {
  readonly bucket: string;
  /** Access key HMAC de interoperabilidad (empieza con "GOOG"). */
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly publicBaseUrl: string;
}

/** Config de GCS desde un env; null si falta alguna de las 3 obligatorias. */
export function gcsConfigFromEnv(env: Record<string, string | undefined>): GcsConfig | null {
  const bucket = env.GCS_BUCKET;
  const accessKeyId = env.GCS_HMAC_ACCESS_KEY_ID;
  const secretAccessKey = env.GCS_HMAC_SECRET;
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  return {
    bucket,
    accessKeyId,
    secretAccessKey,
    publicBaseUrl: env.GCS_PUBLIC_BASE_URL ?? `https://storage.googleapis.com/${bucket}`,
  };
}

/**
 * Google Cloud Storage vía su XML API en modo interoperabilidad: habla SigV4 con claves
 * HMAC, así que reusa el mismo motor que S3 y R2. Limitación conocida: las claves HMAC son
 * estáticas — organizaciones que exijan workload identity necesitan un adapter nativo.
 */
export function gcsStorage(config: GcsConfig, fetchImpl?: SignedFetch): ChunkStorage {
  return s3Compatible(
    {
      endpoint: `https://storage.googleapis.com/${config.bucket}`,
      region: "auto",
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      publicBaseUrl: config.publicBaseUrl,
    },
    fetchImpl,
  );
}
```

- [ ] **Step 4: Registrar el provider**

En `src/provider.ts`, `import { gcsConfigFromEnv } from "./gcs";` y agregar después del chequeo de `r2`:
```ts
  if (gcsConfigFromEnv(env) !== null) out.push("gcs");
```
En `src/index.ts`:
```ts
export { gcsStorage, gcsConfigFromEnv, type GcsConfig } from "./gcs";
```

- [ ] **Step 5: Correr los tests para verlos pasar**

Run: `pnpm --filter @dentvega/miniapp-storage test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(storage): adapter de Google Cloud Storage (XML API, HMAC)"
```

---

### Task 13: `azureStorage` (Azure Blob Storage)

**Files:**
- Create: `repack-miniapps/packages/miniapp-storage/src/azure.ts`
- Test: `repack-miniapps/packages/miniapp-storage/src/__tests__/azure.test.ts`
- Modify: `repack-miniapps/packages/miniapp-storage/src/index.ts`
- Modify: `repack-miniapps/packages/miniapp-storage/src/provider.ts`

**Interfaces:**
- Consumes: `ChunkStorage`, `StorageError`, `PlainFetch` (Task 4), `contentType` (Task 5).
- Produces: `azureStorage(config: AzureConfig, fetchImpl?: PlainFetch): ChunkStorage`, `azureConfigFromEnv(env): AzureConfig | null`, `type AzureConfig`.

> **Es el único adapter que no reusa el motor:** Azure no es S3-compatible. Autentica con un SAS token en la querystring (cero código de firma), marca los blobs con `x-ms-blob-type: BlockBlob`, y su XML de listado usa `<Name>` en vez de `<Key>`.

- [ ] **Step 1: Escribir los tests que fallan**

`src/__tests__/azure.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { azureStorage, azureConfigFromEnv } from "../azure";
import { availableProviders } from "../provider";
import { StorageError } from "../types";
import type { FetchInit, PlainFetch } from "../types";

const config = {
  account: "myaccount",
  container: "chunks",
  sasToken: "sv=2024-01-01&sig=abc",
  publicBaseUrl: "https://myaccount.blob.core.windows.net/chunks",
};

function recorder(listXml?: string) {
  const calls: { url: string; init: FetchInit }[] = [];
  const fake: PlainFetch = async (url, init) => {
    calls.push({ url, init });
    if (init.method === "GET") {
      return { ok: true, status: 200, text: async () => listXml ?? "" };
    }
    return { ok: true, status: 200, text: async () => "" };
  };
  return { calls, fake };
}

describe("azureConfigFromEnv", () => {
  it("null si falta alguna var", () => {
    expect(azureConfigFromEnv({ AZURE_STORAGE_ACCOUNT: "a" })).toBeNull();
  });
  it("arma el public base por defecto", () => {
    expect(
      azureConfigFromEnv({
        AZURE_STORAGE_ACCOUNT: "myaccount",
        AZURE_STORAGE_CONTAINER: "chunks",
        AZURE_STORAGE_SAS_TOKEN: "sv=x",
      })!.publicBaseUrl,
    ).toBe("https://myaccount.blob.core.windows.net/chunks");
  });
  it("acepta el SAS con '?' adelante y lo normaliza", () => {
    expect(
      azureConfigFromEnv({
        AZURE_STORAGE_ACCOUNT: "a",
        AZURE_STORAGE_CONTAINER: "c",
        AZURE_STORAGE_SAS_TOKEN: "?sv=x",
      })!.sasToken,
    ).toBe("sv=x");
  });
});

describe("azureStorage.putMany", () => {
  it("PUTea con x-ms-blob-type y el SAS en la querystring", async () => {
    const { calls, fake } = recorder();
    const res = await azureStorage(config, fake).putMany("app/1.0.0", [
      { path: "a.bundle", data: new Uint8Array([1, 2]) },
    ]);
    expect(calls[0]!.url).toBe(
      "https://myaccount.blob.core.windows.net/chunks/app/1.0.0/a.bundle?sv=2024-01-01&sig=abc",
    );
    expect(calls[0]!.init.method).toBe("PUT");
    expect(calls[0]!.init.headers!["x-ms-blob-type"]).toBe("BlockBlob");
    expect(calls[0]!.init.headers!["content-type"]).toBe("application/javascript");
    expect(res.baseUrl).toBe("https://myaccount.blob.core.windows.net/chunks/app/1.0.0");
  });

  it("tira StorageError si no hay archivos", async () => {
    const { fake } = recorder();
    await expect(azureStorage(config, fake).putMany("p", [])).rejects.toThrow(StorageError);
  });

  it("tira StorageError si el PUT devuelve no-ok", async () => {
    const fake: PlainFetch = async () => ({ ok: false, status: 403, text: async () => "" });
    await expect(
      azureStorage(config, fake).putMany("p", [{ path: "a", data: new Uint8Array([1]) }]),
    ).rejects.toThrow(/403/);
  });
});

describe("azureStorage.deletePrefix", () => {
  it("lista el container por prefijo y borra cada blob por su Name", async () => {
    const xml =
      "<EnumerationResults><Blobs>" +
      "<Blob><Name>app/1.0.0/a.bundle</Name></Blob>" +
      "<Blob><Name>app/1.0.0/b.bundle</Name></Blob>" +
      "</Blobs></EnumerationResults>";
    const { calls, fake } = recorder(xml);
    await azureStorage(config, fake).deletePrefix("app/1.0.0");
    expect(calls[0]!.url).toContain("restype=container&comp=list");
    expect(calls[0]!.url).toContain(encodeURIComponent("app/1.0.0/"));
    const deletes = calls.filter((c) => c.init.method === "DELETE").map((c) => c.url);
    expect(deletes).toEqual([
      "https://myaccount.blob.core.windows.net/chunks/app/1.0.0/a.bundle?sv=2024-01-01&sig=abc",
      "https://myaccount.blob.core.windows.net/chunks/app/1.0.0/b.bundle?sv=2024-01-01&sig=abc",
    ]);
  });

  it("no borra nada si el listado falla (best-effort)", async () => {
    const methods: string[] = [];
    const fake: PlainFetch = async (_url, init) => {
      methods.push(init.method);
      return { ok: false, status: 500, text: async () => "" };
    };
    await azureStorage(config, fake).deletePrefix("p");
    expect(methods).toEqual(["GET"]);
  });
});

describe("availableProviders con Azure", () => {
  it("detecta azure", () => {
    expect(
      availableProviders({
        AZURE_STORAGE_ACCOUNT: "a",
        AZURE_STORAGE_CONTAINER: "c",
        AZURE_STORAGE_SAS_TOKEN: "sv=x",
      }),
    ).toEqual(["azure", "fs"]);
  });
});
```

- [ ] **Step 2: Correr los tests para verlos fallar**

Run: `pnpm --filter @dentvega/miniapp-storage test`
Expected: FAIL — `Cannot find module '../azure'`.

- [ ] **Step 3: Implementar `src/azure.ts`**

```ts
import { contentType } from "./s3compat";
import { StorageError, type ChunkStorage, type PlainFetch } from "./types";

export interface AzureConfig {
  readonly account: string;
  readonly container: string;
  /** SAS token SIN el "?" inicial. Es lo que autentica cada request. */
  readonly sasToken: string;
  readonly publicBaseUrl: string;
}

/** Config de Azure desde un env; null si falta alguna de las 3 obligatorias. */
export function azureConfigFromEnv(
  env: Record<string, string | undefined>,
): AzureConfig | null {
  const account = env.AZURE_STORAGE_ACCOUNT;
  const container = env.AZURE_STORAGE_CONTAINER;
  const raw = env.AZURE_STORAGE_SAS_TOKEN;
  if (!account || !container || !raw) return null;
  return {
    account,
    container,
    sasToken: raw.replace(/^\?/, ""),
    publicBaseUrl:
      env.AZURE_STORAGE_PUBLIC_BASE_URL ??
      `https://${account}.blob.core.windows.net/${container}`,
  };
}

/**
 * Azure Blob Storage. NO es S3-compatible, así que no reusa el motor s3Compatible:
 * autentica por SAS token en la querystring (sin firmar nada), marca cada blob con
 * `x-ms-blob-type: BlockBlob`, y su XML de listado usa <Name> en vez de <Key>.
 */
export function azureStorage(config: AzureConfig, fetchImpl?: PlainFetch): ChunkStorage {
  const doFetch: PlainFetch =
    fetchImpl ??
    (async (url, init) => {
      const res = await fetch(url, init as RequestInit);
      return { ok: res.ok, status: res.status, text: () => res.text() };
    });
  const base = `https://${config.account}.blob.core.windows.net/${config.container}`;
  const publicBase = config.publicBaseUrl.replace(/\/+$/, "");
  const sas = config.sasToken;
  return {
    async putMany(prefix, files): Promise<{ baseUrl: string }> {
      if (files.length === 0) throw new StorageError("no files to upload");
      try {
        for (const file of files) {
          const res = await doFetch(`${base}/${prefix}/${file.path}?${sas}`, {
            method: "PUT",
            body: file.data,
            headers: {
              "x-ms-blob-type": "BlockBlob",
              "content-type": contentType(file.path),
              "content-length": String(file.data.byteLength),
            },
          });
          if (!res.ok) throw new StorageError(`Azure PUT failed: HTTP ${res.status}`);
        }
      } catch (err) {
        if (err instanceof StorageError) throw err;
        throw new StorageError(err instanceof Error ? err.message : "Azure upload failed");
      }
      return { baseUrl: `${publicBase}/${prefix}` };
    },
    async deletePrefix(prefix): Promise<void> {
      // Listado del container por prefijo → DELETE por blob. Best-effort, igual que S3.
      const listUrl =
        `${base}?restype=container&comp=list` +
        `&prefix=${encodeURIComponent(`${prefix}/`)}&${sas}`;
      const listRes = await doFetch(listUrl, { method: "GET" });
      if (!listRes.ok) return;
      const xml = await listRes.text();
      const names = [...xml.matchAll(/<Name>([^<]+)<\/Name>/g)].map((m) => m[1]!);
      for (const name of names) {
        await doFetch(`${base}/${name}?${sas}`, { method: "DELETE" });
      }
    },
  };
}
```

- [ ] **Step 4: Registrar el provider**

En `src/provider.ts`, `import { azureConfigFromEnv } from "./azure";` y agregar después del chequeo de `gcs`:
```ts
  if (azureConfigFromEnv(env) !== null) out.push("azure");
```
En `src/index.ts`:
```ts
export { azureStorage, azureConfigFromEnv, type AzureConfig } from "./azure";
```

- [ ] **Step 5: Correr los tests para verlos pasar**

Run: `pnpm --filter @dentvega/miniapp-storage test && pnpm --filter @dentvega/miniapp-storage typecheck`
Expected: PASS.

- [ ] **Step 6: Publicar 0.2.0 y commitear**

```bash
# subir "version" a 0.2.0 en packages/miniapp-storage/package.json
pnpm --filter @dentvega/miniapp-storage publish --no-git-checks
git add -A
git commit -m "feat(storage): adapter de Azure Blob Storage (SAS) + release 0.2.0"
```

---

### Task 14: Wiring de los providers nuevos en `backstage-web`

**Files:**
- Modify: `backstage-web/package.json` (bump a `^0.2.0`)
- Modify: `backstage-web/lib/storage/index.ts` (buildStorage)
- Modify: `backstage-web/docs/SETUP.md` (env vars de los providers nuevos)
- Test: `backstage-web/lib/storage/__tests__/select.test.ts`

**Interfaces:**
- Consumes: `s3Storage`, `gcsStorage`, `azureStorage` y sus `*ConfigFromEnv` (Tasks 11-13).
- Produces: `buildStorage` soportando los seis providers. La UI del selector no cambia — lee `available` de `getStorageProviderState()`, que ya los expone solo.

- [ ] **Step 1: Escribir el test que falla**

Agregar a `backstage-web/lib/storage/__tests__/select.test.ts`:
```ts
describe("getStorage — providers nuevos", () => {
  it("construye Azure cuando es el activo", async () => {
    process.env.AZURE_STORAGE_ACCOUNT = "a";
    process.env.AZURE_STORAGE_CONTAINER = "c";
    process.env.AZURE_STORAGE_SAS_TOKEN = "sv=x";
    const s = await getStorage(null);
    expect(kind(s)).toBe("azure");
  });
});
```
y sumar los mocks correspondientes arriba del archivo, junto a los que ya existen:
```ts
vi.mock("@dentvega/miniapp-storage", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  azureStorage: () => ({ __kind: "azure" }),
  s3Storage: () => ({ __kind: "s3" }),
  gcsStorage: () => ({ __kind: "gcs" }),
}));
```
Agregar también el cleanup de esas tres env vars en el `afterEach` que ya existe.

- [ ] **Step 2: Correr el test para verlo fallar**

Run: `cd backstage-web && pnpm test lib/storage`
Expected: FAIL — `buildStorage` no conoce `"azure"` y cae al branch de `fs`.

- [ ] **Step 3: Extender `buildStorage`**

En `lib/storage/index.ts`, agregar los imports y los branches antes del `return fsStorage(...)`:
```ts
  if (p === "s3") {
    const cfg = s3ConfigFromEnv(process.env);
    if (cfg === null) throw new Error("S3 selected but not configured");
    return s3Storage(cfg);
  }
  if (p === "gcs") {
    const cfg = gcsConfigFromEnv(process.env);
    if (cfg === null) throw new Error("GCS selected but not configured");
    return gcsStorage(cfg);
  }
  if (p === "azure") {
    const cfg = azureConfigFromEnv(process.env);
    if (cfg === null) throw new Error("Azure selected but not configured");
    return azureStorage(cfg);
  }
```

- [ ] **Step 4: Correr la suite completa**

Run: `pnpm test && pnpm typecheck && pnpm build`
Expected: todo verde.

- [ ] **Step 5: Documentar las env vars**

Agregar a `docs/SETUP.md` una sección por provider con sus variables — usando placeholders, nunca valores reales:

| Provider | Variables |
|---|---|
| AWS S3 | `AWS_S3_BUCKET`, `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_PUBLIC_BASE_URL` (opcional) |
| GCS | `GCS_BUCKET`, `GCS_HMAC_ACCESS_KEY_ID`, `GCS_HMAC_SECRET`, `GCS_PUBLIC_BASE_URL` (opcional) |
| Azure | `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_CONTAINER`, `AZURE_STORAGE_SAS_TOKEN`, `AZURE_STORAGE_PUBLIC_BASE_URL` (opcional) |

- [ ] **Step 6: Validación manual contra buckets reales**

Por cada provider que vayas a usar: configurar sus env vars, elegirlo en el selector de storage, publicar una versión de prueba, y confirmar que (a) el chunk llega al bucket, (b) la miniapp resuelve y monta en el host, (c) el prune borra al superar `PRUNE_KEEP`. **Los tests unitarios cubren el protocolo, no que el proveedor acepte las escrituras — esto no es opcional.**

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(storage): soporte de AWS S3, GCS y Azure en el control-plane"
```

---

## Verificación final

- [ ] `@dentvega/miniapp-contract` y `@dentvega/miniapp-storage` son públicos en npm, MIT.
- [ ] El repo público no contiene URLs internas, buckets reales, tokens ni referencias a clientes.
- [ ] `pnpm test` verde en `repack-miniapps` y en `backstage-web`.
- [ ] `pnpm build` verde en `backstage-web`.
- [ ] Un publish real sigue funcionando sobre R2 (no hubo regresión en la extracción).
- [ ] Al menos un provider nuevo validado end-to-end contra un bucket real.
