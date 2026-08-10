# iOS Vertical Slice (#13) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Montar la miniapp piloto `hellow_widget` en iOS end-to-end (build → publish → registry → resolve → host), sin regresar el flujo Android.

**Architecture:** iOS es **aditivo**. `PublishedVersion` suma `iosUrl?`/`iosIntegrity?`; el chunk iOS se guarda en un subfolder `${id}/${version}/ios/`; el publish de iOS se **adjunta** a la versión de Android existente; `/api/resolve?platform=ios` devuelve el `iosUrl` con la integrity iOS pisada en el manifest; el host manda `Platform.OS`. Android (url/manifest/path/flujo) queda intacto.

**Tech Stack:** Next.js 16 (backstage-web, vitest), React Native 0.76 + Re.Pack + Module Federation (backstagereactnative, jest), Node scripts (miniapp publish, node:test).

## Global Constraints

- **Android intacto:** no tocar `PublishedVersion.url`, `manifest.integrity`, el path `${id}/${version}/`, ni el default de `publishVersion`/`resolveMiniapp`. iOS solo por campos opcionales y ramas `platform === "ios"`.
- **Schema:** `PublishedVersion += iosUrl?: string, iosIntegrity?: string`. Sin migración (records viejos ya tienen `url`).
- **Invariante:** toda versión tiene chunk Android; iOS se adjunta a una versión Android existente.
- **Storage iOS:** subfolder `${id}/${version}/ios/` (evita colisión con Android; el `containerName` es el mismo `${id}.container.js.bundle`).
- **Resolve iOS:** override `manifest.integrity ← iosIntegrity`; si falta `iosUrl` → `NoCompatibleVersionError`.
- **Platform del host:** `Platform.OS === "ios" ? "ios" : "android"` (nunca mandar otros valores).
- **Repos:** backstage-web `/Volumes/SSDExterno/prodproyects/backstage-web` (commits **directo a main**, patrón de la sesión). backstagereactnative `/Volumes/SSDExterno/prodproyects/backstagereactnative` (**vía PR**, branch protection: check `blast-radius` + `test`). miniapp-hellow_widget `/Volumes/SSDExterno/prodproyects/miniapp-hellow_widget`.
- **Contrato:** `ResolveRequest.platform?` vive en el paquete de contrato del host-repo; backstage-web NO depende de ese tipo (lee `?platform=` del querystring) → sin republish cross-repo.

---

### Task 1: backstage-web — schema + `publishVersion` (platform + attach)

**Files:**
- Modify: `lib/registry/types.ts` (`PublishedVersion`)
- Modify: `lib/registry/registry.ts` (`publishVersion`)
- Test: `lib/registry/__tests__/registry.test.ts`

**Interfaces:**
- Produces: `PublishedVersion { …, iosUrl?: string, iosIntegrity?: string }`; `publishVersion(reg, rawId, input: { version: string; url: string; manifest: unknown; platform?: "android" | "ios"; integrity?: string }, now): Registry`.

- [ ] **Step 1: Write failing tests** — append to `lib/registry/__tests__/registry.test.ts` (usa los helpers `manifest`, `seeded`, `now` ya definidos en el archivo):

```ts
describe("publishVersion — iOS attach", () => {
  it("adjunta iOS a una versión Android existente (misma versión)", () => {
    let reg = seeded(); // account_dashboard@0.1.0 (Android)
    reg = publishVersion(
      reg,
      "account_dashboard",
      {
        version: "0.1.0",
        url: "http://h/v010/ios",
        manifest: manifest("account_dashboard", "0.1.0"),
        platform: "ios",
        integrity: "sha256-IOS",
      },
      now,
    );
    const v = reg.account_dashboard!.versions.find((x) => x.version === "0.1.0")!;
    expect(v.url).toBe("http://h/v010");          // Android intacto
    expect(v.iosUrl).toBe("http://h/v010/ios");   // iOS adjuntado
    expect(v.iosIntegrity).toBe("sha256-IOS");
    expect(reg.account_dashboard!.versions).toHaveLength(1); // no crea versión nueva
  });

  it("iOS en una versión inexistente → InvalidManifestError", () => {
    const reg = seeded();
    expect(() =>
      publishVersion(
        reg,
        "account_dashboard",
        { version: "9.9.9", url: "http://h/x/ios", manifest: manifest("account_dashboard", "9.9.9"), platform: "ios", integrity: "sha256-X" },
        now,
      ),
    ).toThrow(InvalidManifestError);
  });

  it("iOS dos veces en la misma versión → VersionExistsError", () => {
    let reg = seeded();
    reg = publishVersion(reg, "account_dashboard", { version: "0.1.0", url: "http://h/v010/ios", manifest: manifest("account_dashboard", "0.1.0"), platform: "ios", integrity: "sha256-IOS" }, now);
    expect(() =>
      publishVersion(reg, "account_dashboard", { version: "0.1.0", url: "http://h/v010/ios2", manifest: manifest("account_dashboard", "0.1.0"), platform: "ios", integrity: "sha256-IOS2" }, now),
    ).toThrow(VersionExistsError);
  });

  it("Android (default) sigue creando versión y con VERSION_EXISTS", () => {
    let reg = seeded();
    reg = publishVersion(reg, "account_dashboard", { version: "0.2.0", url: "http://h/v020", manifest: manifest("account_dashboard", "0.2.0") }, now);
    expect(reg.account_dashboard!.versions).toHaveLength(2);
    expect(() =>
      publishVersion(reg, "account_dashboard", { version: "0.2.0", url: "http://h/v020b", manifest: manifest("account_dashboard", "0.2.0") }, now),
    ).toThrow(VersionExistsError);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run lib/registry/__tests__/registry.test.ts -t "iOS attach"`
Expected: FAIL (iosUrl undefined / no throw).

- [ ] **Step 3: Add the fields** — in `lib/registry/types.ts`, inside `PublishedVersion` (after `publishedAt`):

```ts
  /** URL del chunk iOS (opcional; aditivo — Android sigue en `url`). */
  readonly iosUrl?: string;
  /** sha256 del chunk iOS ("sha256-…"); el resolve iOS lo pisa en manifest.integrity. */
  readonly iosIntegrity?: string;
```

- [ ] **Step 4: Rewrite `publishVersion`** — in `lib/registry/registry.ts`, replace the current function body from the `const published: PublishedVersion = {` block. Full new function:

```ts
export function publishVersion(
  reg: Registry,
  rawId: string,
  input: {
    version: string;
    url: string;
    manifest: unknown;
    platform?: "android" | "ios";
    integrity?: string;
  },
  now: string,
): Registry {
  const id = parseMiniappId(rawId);
  if (id === null) throw new InvalidManifestError(`bad miniapp id "${rawId}"`);

  const record = reg[id];
  if (record === undefined) throw new MiniappNotFoundError(id);

  const version = parseSemVer(input.version);
  if (version === null) throw new InvalidManifestError(`bad semver "${input.version}"`);

  if (!isManifest(input.manifest)) {
    throw new InvalidManifestError("does not satisfy the contract shape");
  }
  const manifest: Manifest = input.manifest;
  if (manifest.id !== id) {
    throw new InvalidManifestError(`manifest.id "${manifest.id}" !== "${id}"`);
  }
  if (manifest.version !== version) {
    throw new InvalidManifestError(`manifest.version "${manifest.version}" !== "${version}"`);
  }
  if (typeof input.url !== "string" || input.url.length === 0) {
    throw new InvalidManifestError("missing chunk url");
  }

  const platform = input.platform ?? "android";
  const existing = record.versions.find((v) => v.version === version);

  if (platform === "ios") {
    // iOS se ADJUNTA a la versión de Android existente (no crea versión nueva).
    if (existing === undefined) {
      throw new InvalidManifestError(`publicá Android primero para la versión ${version}`);
    }
    if (existing.iosUrl !== undefined) {
      throw new VersionExistsError(id, `${version} (ios)`);
    }
    const attached: PublishedVersion = {
      ...existing,
      iosUrl: input.url,
      iosIntegrity: input.integrity,
    };
    const updated: MiniappRecord = {
      ...record,
      versions: record.versions.map((v) => (v.version === version ? attached : v)),
    };
    return { ...reg, [id]: updated };
  }

  // Android (default) — comportamiento histórico.
  if (existing !== undefined) {
    throw new VersionExistsError(id, version);
  }
  const published: PublishedVersion = {
    version,
    url: input.url,
    manifest,
    publishedAt: now,
  };
  const updated: MiniappRecord = {
    ...record,
    versions: [...record.versions, published],
  };
  return { ...reg, [id]: updated };
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run lib/registry/__tests__/registry.test.ts`
Expected: PASS (todos, incluidos los existentes).

- [ ] **Step 6: Commit**

```bash
git add lib/registry/types.ts lib/registry/registry.ts lib/registry/__tests__/registry.test.ts
git commit -m "feat(registry): PublishedVersion iosUrl/iosIntegrity + publishVersion attach por-plataforma (#13)"
```

---

### Task 2: backstage-web — `resolveMiniapp` platform override

**Files:**
- Modify: `lib/registry/registry.ts` (`ResolveOptions`, `resolveMiniapp` return)
- Test: `lib/registry/__tests__/registry.test.ts`

**Interfaces:**
- Consumes: `PublishedVersion.iosUrl/iosIntegrity` (Task 1).
- Produces: `ResolveOptions { version?; range?; platform?: "android" | "ios" }`; `resolveMiniapp(reg, id, { platform: "ios" })` devuelve `{ url: iosUrl, manifest: { …, integrity: iosIntegrity } }`.

- [ ] **Step 1: Write failing tests** — append to `registry.test.ts`:

```ts
describe("resolveMiniapp — platform", () => {
  function withIos(): Registry {
    let reg = seeded(); // account_dashboard@0.1.0 android
    reg = publishVersion(reg, "account_dashboard", { version: "0.1.0", url: "http://h/v010/ios", manifest: manifest("account_dashboard", "0.1.0"), platform: "ios", integrity: "sha256-IOS" }, now);
    return reg;
  }

  it("platform ios → devuelve iosUrl + integrity iOS pisada", () => {
    const r = resolveMiniapp(withIos(), "account_dashboard", { platform: "ios" });
    expect(r.url).toBe("http://h/v010/ios");
    expect(r.manifest.integrity).toBe("sha256-IOS");
  });

  it("sin platform (android) → intacto (url + manifest Android)", () => {
    const r = resolveMiniapp(withIos(), "account_dashboard", {});
    expect(r.url).toBe("http://h/v010");
    expect(r.manifest.integrity).toBeUndefined(); // el manifest del fixture no trae integrity
  });

  it("platform ios cuando la versión no tiene iOS → NoCompatibleVersionError", () => {
    expect(() => resolveMiniapp(seeded(), "account_dashboard", { platform: "ios" })).toThrow(
      NoCompatibleVersionError,
    );
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run lib/registry/__tests__/registry.test.ts -t "resolveMiniapp — platform"`
Expected: FAIL (`platform` no existe en ResolveOptions / no override).

- [ ] **Step 3: Extend `ResolveOptions`** — in `lib/registry/registry.ts`:

```ts
export interface ResolveOptions {
  /** Exact version to resolve. */
  version?: string;
  /** Semver range the host requires (host provides this compatibility window). */
  range?: string;
  /** Plataforma del host; "ios" sirve el chunk iOS. Default/ausente = Android. */
  platform?: "android" | "ios";
}
```

- [ ] **Step 4: Override en el return de `resolveMiniapp`** — reemplazar el bloque final (desde `const version = chosen as PublishedVersion;` hasta el `return { … };`) por:

```ts
  // selectLatest returns non-null here (versions.length > 0 checked above).
  const version = chosen as PublishedVersion;

  if (opts.platform === "ios") {
    if (version.iosUrl === undefined) {
      throw new NoCompatibleVersionError(id, `iOS no publicado para la versión ${version.version}`);
    }
    return {
      id,
      version: version.version,
      url: version.iosUrl,
      manifest: { ...version.manifest, integrity: version.iosIntegrity },
    };
  }

  return {
    id,
    version: version.version,
    url: version.url,
    manifest: version.manifest,
  };
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run lib/registry/__tests__/registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/registry/registry.ts lib/registry/__tests__/registry.test.ts
git commit -m "feat(registry): resolveMiniapp platform=ios (iosUrl + integrity override) (#13)"
```

---

### Task 3: backstage-web — `/upload` lee `platform`

**Files:**
- Modify: `app/api/miniapps/[id]/upload/route.ts`
- Test: `app/api/__tests__/upload-route.test.ts`

**Interfaces:**
- Consumes: `publishVersion(…, { platform, integrity })` (Task 1).
- Produces: el form-field `platform` ("android" default | "ios"); iOS → chunk en `${id}/${version}/ios/`, integrity → `iosIntegrity`, respuesta incluye `platform`.

- [ ] **Step 1: Write failing test** — agregar dentro del `describe("POST /api/miniapps/:id/upload", …)` de `app/api/__tests__/upload-route.test.ts`. Usa los helpers ya definidos en el archivo (`uploadReq`, `buildZip`, `manifest`, `params`, `state.reg`) y el `mockStorage()` que devuelve `baseUrl = https://mock.blob/<prefix>`:

```ts
it("platform=ios adjunta el chunk iOS a la versión Android existente (misma versión)", async () => {
  // 1) publicar Android @0.2.0 (crea la versión).
  await POST(uploadReq({ token: "secret" }), params);
  // 2) publicar iOS @0.2.0 (mismo version, platform=ios) → se adjunta.
  const form = new FormData();
  form.set("file", new Blob([buildZip() as unknown as BlobPart]), "build.zip");
  form.set("version", "0.2.0");
  form.set("platform", "ios");
  form.set("manifest", JSON.stringify({ ...manifest, version: "0.2.0" }));
  const req = new Request("http://x/api/miniapps/account_dashboard/upload", {
    method: "POST",
    headers: { authorization: "Bearer secret" },
    body: form,
  });

  const res = await POST(req, params);

  expect(res.status).toBe(201);
  expect((await res.json()).platform).toBe("ios");
  expect(state.reg.account_dashboard.versions).toHaveLength(1); // NO crea versión nueva
  const v = state.reg.account_dashboard.versions.find((x) => x.version === "0.2.0")!;
  expect(v.iosUrl).toBe(
    "https://mock.blob/account_dashboard/0.2.0/ios/account_dashboard.container.js.bundle",
  );
  expect(v.iosIntegrity).toMatch(/^sha256-[0-9a-f]{64}$/);
  // Android intacto (path SIN /ios/, integrity en el manifest canónico).
  expect(v.url).toBe(
    "https://mock.blob/account_dashboard/0.2.0/account_dashboard.container.js.bundle",
  );
  expect(v.manifest.integrity).toMatch(/^sha256-[0-9a-f]{64}$/);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/api/__tests__/upload-route.test.ts -t "platform=ios"`
Expected: FAIL (hoy ignora `platform`, tira VERSION_EXISTS o guarda sin iosUrl).

- [ ] **Step 3: Leer `platform` y computar integrity una vez** — in `app/api/miniapps/[id]/upload/route.ts`. Reemplazar el bloque que hoy setea `manifest.integrity` (líneas ~84-88):

```ts
    // Plataforma del chunk subido (default android → backward-compat con el publish.mjs viejo).
    const platform = form.get("platform") === "ios" ? "ios" : "android";
    // Integrity de los bytes REALES del chunk (nunca un valor del cliente).
    const integrity = sha256Integrity(container.data);
    // Android es el manifest canónico (lleva su integrity). iOS NO pisa el manifest —
    // su integrity viaja aparte y el resolve la inyecta.
    if (platform === "android") {
      manifest = {
        ...(manifest as Record<string, unknown>),
        integrity,
      };
    }
```

- [ ] **Step 4: Path por-plataforma + pasar platform/integrity a publishVersion** — reemplazar (líneas ~158-163):

```ts
    const reg = await getStore().load();
    const storage = await getStorage(reg[id]?.storageProvider ?? null);
    const prefix = platform === "ios" ? `${id}/${version}/ios` : `${id}/${version}`;
    const { baseUrl } = await storage.putMany(prefix, files);
    const url = `${baseUrl}/${containerName}`;

    const next = publishVersion(
      reg,
      id,
      { version, url, manifest, platform, integrity },
      new Date().toISOString(),
    );
    await getStore().save(next);
```

- [ ] **Step 5: Incluir platform en la respuesta** — reemplazar el `return NextResponse.json({ id, version, url }, { status: 201 });` por:

```ts
    return NextResponse.json({ id, version, url, platform }, { status: 201 });
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run app/api/__tests__/upload-route.test.ts`
Expected: PASS (nuevo + existentes).

- [ ] **Step 7: Commit**

```bash
git add app/api/miniapps/\[id\]/upload/route.ts app/api/__tests__/upload-route.test.ts
git commit -m "feat(upload): form-field platform → chunk iOS en subfolder + iosIntegrity (#13)"
```

---

### Task 4: backstage-web — `/api/resolve?platform=`

**Files:**
- Modify: `app/api/resolve/route.ts`
- Test (create): `app/api/__tests__/resolve-route.test.ts`

**Interfaces:**
- Consumes: `resolveMiniapp(reg, id, { version, range, platform })` (Task 2).
- Produces: `GET /api/resolve?platform=ios` → resuelve el chunk iOS.

- [ ] **Step 1: Write failing test** — create `app/api/__tests__/resolve-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ reg: {} as Record<string, unknown> }));
vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({ load: async () => state.reg }),
}));

import { GET } from "@/app/api/resolve/route";

const req = (qs: string) => new Request(`http://x/api/resolve?${qs}`);

beforeEach(() => {
  state.reg = {
    acc: {
      id: "acc",
      name: "Acc",
      owner: "o",
      versions: [
        {
          version: "0.1.0",
          url: "http://h/v010",
          manifest: { id: "acc", version: "0.1.0", entry: "./Entry", shared: [], capabilities: [], integrity: "sha256-AND" },
          publishedAt: "2026-01-01T00:00:00.000Z",
          iosUrl: "http://h/v010/ios",
          iosIntegrity: "sha256-IOS",
        },
      ],
    },
  };
});
afterEach(() => vi.restoreAllMocks());

describe("GET /api/resolve — platform", () => {
  it("platform=ios → iosUrl + integrity iOS", async () => {
    const res = await GET(req("id=acc&platform=ios"));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.url).toBe("http://h/v010/ios");
    expect(body.manifest.integrity).toBe("sha256-IOS");
  });

  it("sin platform → Android intacto", async () => {
    const res = await GET(req("id=acc"));
    const body = await res.json();
    expect(body.url).toBe("http://h/v010");
    expect(body.manifest.integrity).toBe("sha256-AND");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run app/api/__tests__/resolve-route.test.ts`
Expected: FAIL (hoy ignora `platform` → devuelve Android en ambos).

- [ ] **Step 3: Leer `?platform=`** — in `app/api/resolve/route.ts`, después de `const range = …`:

```ts
    const platform = url.searchParams.get("platform") === "ios" ? "ios" : undefined;

    const reg = await getStore().load();
    const resolved = resolveMiniapp(reg, id, { version, range, platform });
```

(reemplaza la línea `const resolved = resolveMiniapp(reg, id, { version, range });`)

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run app/api/__tests__/resolve-route.test.ts`
Expected: PASS.

- [ ] **Step 5: Full suite + typecheck (no-regresión backstage-web)**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc limpio; toda la suite verde.

- [ ] **Step 6: Commit**

```bash
git add app/api/resolve/route.ts app/api/__tests__/resolve-route.test.ts
git commit -m "feat(resolve): /api/resolve?platform=ios (#13)"
```

> **Deploy:** el push a `main` de backstage-web redeploya Vercel. Antes de seguir, verificá no-regresión Android en prod: `GET https://backstage-web-blond.vercel.app/api/resolve?id=hellow_widget` sigue devolviendo el chunk Android igual que antes.

---

### Task 5: backstagereactnative (host) — mandar `Platform.OS` (vía PR)

**Files:**
- Modify: `packages/miniapp-contract/src/types.ts` (`ResolveRequest`)
- Modify: `packages/host-runtime/src/ResolveClient.ts` (`httpResolveClient`)
- Modify: `packages/host-runtime/src/devResolveClient.ts` (línea 39)
- Modify: `packages/host-runtime/src/useMiniapp.ts` (construcción del request, línea ~75)
- Test (create): `packages/host-runtime/src/__tests__/ResolveClient.test.ts`
- Test (modify): `packages/host-runtime/src/__tests__/devResolveClient.test.ts`

**Interfaces:**
- Produces: `ResolveRequest { …, platform?: "ios" | "android" }`; `httpResolveClient` agrega `&platform=` cuando está; `devResolveClient` usa `request.platform ?? "android"`; `useMiniapp` inyecta `Platform.OS === "ios" ? "ios" : "android"`.

- [ ] **Step 0: Crear branch**

```bash
cd /Volumes/SSDExterno/prodproyects/backstagereactnative
git checkout -b feat/ios-resolve-platform
```

- [ ] **Step 1: Write failing test** — create `packages/host-runtime/src/__tests__/ResolveClient.test.ts`. **Estilo jest** (globals `describe/it/expect/afterEach`, `jest.fn` — NO importar de vitest; este paquete corre con `jest`):

```ts
import {httpResolveClient} from '../ResolveClient';
import type {MiniappId} from '@dentvega/miniapp-contract';

afterEach(() => jest.restoreAllMocks());

function captureFetch(): string[] {
  const calls: string[] = [];
  (globalThis as unknown as {fetch: unknown}).fetch = jest.fn(async (url: string) => {
    calls.push(String(url));
    return {ok: true, json: async () => ({id: 'x', version: '0.0.0', url: 'u', manifest: {}})};
  });
  return calls;
}

describe('httpResolveClient — platform', () => {
  it('incluye &platform cuando el request lo trae', async () => {
    const calls = captureFetch();
    await httpResolveClient('http://b').resolve({id: 'x' as MiniappId, platform: 'ios'});
    expect(calls[0]).toContain('platform=ios');
  });

  it('omite platform cuando no viene', async () => {
    const calls = captureFetch();
    await httpResolveClient('http://b').resolve({id: 'x' as MiniappId});
    expect(calls[0]).not.toContain('platform=');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run (desde `/Volumes/SSDExterno/prodproyects/backstagereactnative`): `pnpm --filter @dentvega/host-runtime test ResolveClient`
Expected: FAIL (no incluye platform) o error de tipo (`platform` no existe en ResolveRequest).

- [ ] **Step 3: `ResolveRequest += platform`** — in `packages/miniapp-contract/src/types.ts`, dentro de `ResolveRequest` (después de `version?`):

```ts
  /** Plataforma del host ("ios"/"android") — el registry sirve el chunk correcto. */
  readonly platform?: "ios" | "android";
```

- [ ] **Step 4: `httpResolveClient` agrega el param** — in `packages/host-runtime/src/ResolveClient.ts`, después del bloque de `version`:

```ts
      if (request.platform !== undefined) {
        params.push(`platform=${encodeURIComponent(request.platform)}`);
      }
```

- [ ] **Step 5: `devResolveClient` usa la plataforma del request** — in `packages/host-runtime/src/devResolveClient.ts:39`, reemplazar:

```ts
        url: `${devUrl.replace(/\/+$/, '')}/${id}.container.js.bundle?platform=${request.platform ?? 'android'}`,
```

- [ ] **Step 6: `useMiniapp` inyecta `Platform.OS`** — in `packages/host-runtime/src/useMiniapp.ts`:
  - Agregar import arriba: `import { Platform } from "react-native";`
  - Reemplazar la línea 75 (`const resolved = await resolveClient.resolve({ id, version: deps.resolveVersion as SemVer | undefined });`) por:

```ts
          const resolved = await resolveClient.resolve({
            id,
            version: deps.resolveVersion as SemVer | undefined,
            platform: Platform.OS === "ios" ? "ios" : "android",
          });
```

- [ ] **Step 7: Actualizar `devResolveClient.test.ts`** — el/los caso(s) que hoy asumen `?platform=android` en la dev url ahora dependen de `request.platform`. Agregar `import type {MiniappId} from '@dentvega/miniapp-contract';` si no está, y dos asserts (estilo jest, single-quotes como el archivo):

```ts
  it('usa la plataforma del request en la dev url', async () => {
    const r = await devResolveClient('http://b', {hellow: 'http://dev:9000'}).resolve({
      id: 'hellow' as MiniappId,
      platform: 'ios',
    });
    expect(r.url).toContain('?platform=ios');
  });

  it('default android cuando el request no trae platform', async () => {
    const r = await devResolveClient('http://b', {hellow: 'http://dev:9000'}).resolve({
      id: 'hellow' as MiniappId,
    });
    expect(r.url).toContain('?platform=android');
  });
```

Si algún assert existente esperaba `?platform=android` sin pasar `platform`, sigue verde por el default.

- [ ] **Step 8: Run host-runtime tests + typecheck**

Run: `pnpm --filter @dentvega/host-runtime test` y `pnpm --filter @dentvega/host-runtime typecheck` (o `pnpm build:packages && pnpm typecheck` según el repo).
Expected: PASS + tsc limpio.

- [ ] **Step 9: Commit + push + PR**

```bash
git add packages/miniapp-contract/src/types.ts packages/host-runtime/src/ResolveClient.ts packages/host-runtime/src/devResolveClient.ts packages/host-runtime/src/useMiniapp.ts packages/host-runtime/src/__tests__/ResolveClient.test.ts packages/host-runtime/src/__tests__/devResolveClient.test.ts
git commit -m "feat(host): resolve manda Platform.OS; dev usa la plataforma del request (#13, cierra #18)"
git push -u origin feat/ios-resolve-platform
gh pr create --fill --title "feat(host): resolve por plataforma (#13, cierra #18)"
```

Esperar los checks required (`blast-radius` + `test`) verdes y mergear el PR.

---

### Task 6: miniapp-hellow_widget — `bundle:ios` + publish de ambos chunks

**Files:**
- Modify: `package.json` (script `bundle:ios`)
- Modify: `scripts/publish.mjs` (segundo zip opcional + `platform`)

**Interfaces:**
- Consumes: `/upload` con `platform` (Task 3); backstage-web ya deployado.
- Produces: `bundle:ios` → `build/ios/hellow_widget.container.js.bundle`; `node scripts/publish.mjs <android.zip> [ios.zip]` publica ambos a la **misma** versión (una sola computación de `nextVersion`).

- [ ] **Step 1: Agregar `bundle:ios`** — in `package.json`, junto a `bundle:android` (output a un dir separado para no pisar el de Android):

```json
    "bundle:ios": "react-native webpack-bundle --platform ios --entry-file src/Entry.tsx --bundle-output build/ios/hellow_widget.container.js.bundle --dev false",
```

- [ ] **Step 2: `publish.mjs` publica ambos a la misma versión** — reemplazar el bloque desde `const zipPath = process.argv[2];` … hasta el final por:

```js
const androidZip = process.argv[2];
const iosZip = process.argv[3]; // opcional
if (!androidZip) {
  console.error("usage: node scripts/publish.mjs <android.zip> [ios.zip]");
  process.exit(1);
}

const backstageUrl = process.env.BACKSTAGE_URL;
const token = process.env.PUBLISH_TOKEN;
if (!backstageUrl || !token) {
  console.error("BACKSTAGE_URL and PUBLISH_TOKEN must be set");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const id = manifest.id;
const want = manifest.version ?? pkg.version;

let latest = null;
try {
  const res = await fetch(`${backstageUrl}/api/miniapps`);
  if (res.ok) {
    const body = await res.json();
    const found = (body.miniapps ?? []).find((m) => m.id === id);
    latest = found?.latestVersion ?? null;
  } else {
    console.warn(`catalog lookup failed: HTTP ${res.status} — falling back to manifest version`);
  }
} catch (err) {
  console.warn(`catalog lookup error (${err instanceof Error ? err.message : err}) — falling back to manifest version`);
}

// La versión se computa UNA sola vez; ambos chunks (android + ios) se publican a ELLA.
const version = nextVersion(latest, want);

async function upload(zipPath, platform) {
  const form = new FormData();
  form.set("file", new Blob([readFileSync(zipPath)]), "build.zip");
  form.set("version", String(version));
  form.set("manifest", JSON.stringify({ ...manifest, version }));
  form.set("platform", platform);
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
  console.log(`published ${id}@${version} [${platform}] (latest was ${latest ?? "none"}): ${body}`);
}

await upload(androidZip, "android");
if (iosZip) await upload(iosZip, "ios");
```

- [ ] **Step 3: Verificar que `version.mjs` (tested) sigue verde**

Run: `node --test scripts/*.test.mjs scripts/__tests__/*.test.mjs`
Expected: PASS (no tocamos `nextVersion`).

- [ ] **Step 4: Commit**

```bash
git add package.json scripts/publish.mjs
git commit -m "feat(publish): bundle:ios + publish android+ios a la misma version (#13)"
```

> **CI (out-of-band, no bloqueante para el piloto):** actualizar `.github/workflows/publish.yml` para buildear iOS (`pnpm bundle:ios`), zippear `build/ios/`, y llamar `node scripts/publish.mjs android.zip ios.zip`. Requiere token con scope `workflow` (muro de permisos). El piloto se valida con el publish **manual** de la Task 7.

---

### Task 7: Publicar el chunk iOS piloto + Simulador + iPhone (manual)

**Files:** ninguno (verificación operacional). Requiere: Xcode + Simulador + iPhone + cuenta Apple; `BACKSTAGE_URL` (prod) + `PUBLISH_TOKEN` en el entorno.

- [ ] **Step 1: Buildear ambos chunks localmente**

```bash
cd /Volumes/SSDExterno/prodproyects/miniapp-hellow_widget
pnpm bundle:android && (cd build && zip -j android.zip hellow_widget.container.js.bundle)
pnpm bundle:ios && (cd build/ios && zip -j ../ios.zip hellow_widget.container.js.bundle)
```

- [ ] **Step 2: Publicar ambos a una nueva versión (misma V)**

```bash
BACKSTAGE_URL=https://backstage-web-blond.vercel.app PUBLISH_TOKEN=<token> \
  node scripts/publish.mjs build/android.zip build/ios.zip
```

Expected: dos líneas `published hellow_widget@X.Y.Z [android]` y `[ios]` a la MISMA `X.Y.Z`.

- [ ] **Step 3: Verificar el resolve iOS en prod**

```bash
curl -s "https://backstage-web-blond.vercel.app/api/resolve?id=hellow_widget&platform=ios" | jq '{url, integrity: .manifest.integrity}'
```

Expected: `url` termina en `/ios/hellow_widget.container.js.bundle`; `integrity` presente. Y sin `platform` → el chunk Android (no-regresión).

- [ ] **Step 4: Firma en Xcode**

```bash
cd /Volumes/SSDExterno/prodproyects/backstagereactnative/apps/host/ios && pod install
open host.xcworkspace
```

En Xcode: target `host` → Signing & Capabilities → seleccionar **Team** (tu cuenta Apple) + Bundle Identifier único.

- [ ] **Step 5: Simulador (sin firma) — valida el pipeline**

```bash
cd /Volumes/SSDExterno/prodproyects/backstagereactnative/apps/host && pnpm ios
```

Expected: la app arranca en el Simulador iOS; abrir `hellow_widget` → **monta** (resuelve el chunk iOS, verifica integrity iOS, renderiza).

- [ ] **Step 6: iPhone real (device)**

En Xcode seleccionar el iPhone conectado → Run (o `pnpm ios --device "<nombre>"`). ATS ya OK (R2/Vercel HTTPS).
Expected: `hellow_widget` monta en el device físico → **#13 cerrado**.

- [ ] **Step 7: Actualizar la memoria del roadmap** — marcar #13 como DONE (y #18 cerrado de paso por la Task 5) en `platform-roadmap.md`, con: piloto hellow_widget iOS end-to-end, schema aditivo `iosUrl?/iosIntegrity?`, subfolder `ios/`, `Platform.OS` en el resolve. Nota: falta propagar iOS al resto de la flota (fuera de alcance).

---

## Notas de ejecución

- **Tasks 1-4** son backstage-web (directo a main); al terminar la 4, deploy + chequeo de no-regresión Android antes de seguir.
- **Task 5** es el host, vía PR (esperar checks). No depende del deploy de backstage-web para compilar/testear, pero el e2e (Task 7) sí necesita backstage-web deployado.
- **Task 6** prepara el publish; **Task 7** lo ejecuta manualmente y cierra el device.
- Orden recomendado: 1 → 2 → 3 → 4 → (deploy) → 5 → 6 → 7.
