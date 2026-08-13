# iOS end-to-end para una miniapp (corte vertical, #13) — Design

**Fecha:** 2026-08-10
**Estado:** Aprobado (listo para plan)
**Repos:** `backstage-web` (control-plane) · `backstagereactnative` (host) · `miniapp-hellow_widget` (miniapp piloto)
**Owner:** <owner>

---

## Goal

Montar **una** miniapp (`hellow_widget`) en iOS **end-to-end** — build → publish → registry → resolve → host — primero en Simulador, después en **iPhone real** (firma). Cierra el #13 (nunca verificado) y, de paso, el #18 (dev hardcodea `?platform=android`). El resto de la flota se propaga después (fuera de alcance).

## Por qué es un corte vertical (no un checkeo)

Hoy iOS está bloqueado en 4 capas: el build solo hace `bundle:android`, el CI publica solo Android, el registry guarda **un** `url` sin plataforma, y `/api/resolve` no acepta `?platform=`. Aunque el binario iOS del host arranque, resuelve el bundle de Android → no corre. Hay que tocar las 4 capas.

## Decisiones de fondo

- **Schema mínimo-regresión:** `PublishedVersion` suma `iosUrl?` + `iosIntegrity?`. El `url`/`manifest.integrity` actuales siguen siendo los de **Android** (default). Cero migración: los records existentes ya tienen `url`; los nuevos campos quedan `undefined` hasta publicar iOS. *(Generalizar a un mapa `platforms: {android, ios, …}` es follow-up si aparece una 3ª plataforma.)*
- **Android intacto:** su path de storage (`${id}/${version}/`), su `url`, su integrity y su flujo de publish **no cambian**. iOS es aditivo.
- **Invariante:** toda versión tiene chunk Android; iOS es opcional/adicional. Publicar iOS requiere que la versión (Android) ya exista → se **adjunta**.

---

## Diseño por capa

### Capa 1 — `backstage-web`: schema + storage + publish + resolve

#### 1.1 `lib/registry/types.ts` — `PublishedVersion`
```ts
export interface PublishedVersion {
  readonly version: SemVer;
  readonly url: string;               // chunk Android (legacy/default) — SIN CAMBIOS
  readonly manifest: Manifest;        // manifest canónico (integrity = Android) — SIN CAMBIOS
  readonly publishedAt: string;
  readonly iosUrl?: string;           // NUEVO: chunk iOS
  readonly iosIntegrity?: string;     // NUEVO: sha256 del chunk iOS (formato "sha256-…")
}
```

#### 1.2 Storage path por-plataforma (evita colisión)
En el upload, el prefix pasa a depender de la plataforma:
```ts
const prefix = platform === "ios" ? `${id}/${version}/ios` : `${id}/${version}`;
const { baseUrl } = await storage.putMany(prefix, files);
```
Android sigue en `${id}/${version}/` (no se mueve); iOS va a `${id}/${version}/ios/`. El `containerName` (`${id}.container.js.bundle`) es el mismo. **Prune:** `deletePrefix(`${id}/${version}`)` matchea por prefijo → borra también `.../ios/` (recursivo) sin cambios.

#### 1.3 `lib/registry/registry.ts` — `publishVersion` (platform + attach)
Firma nueva:
```ts
publishVersion(reg, rawId, input: {
  version: string; url: string; manifest: unknown;
  platform?: "android" | "ios";        // default "android"
  integrity?: string;                   // sha256 del chunk (para iOS → iosIntegrity)
}, now): Registry
```
Semántica:
- `platform` default `"android"`.
- **Android** (default): comportamiento actual. Crea la versión (`url`+`manifest`). Si ya existe → `VersionExistsError` (igual que hoy).
- **iOS**:
  - La versión **debe existir** (Android ya publicada). Si no existe → `InvalidManifestError("publicá Android primero para la versión X")`.
  - Si la versión ya tiene `iosUrl` → `VersionExistsError` (dup-guard **por-plataforma**).
  - Si no → **adjunta**: setea `iosUrl = input.url`, `iosIntegrity = input.integrity`. **No** toca `url` ni `manifest` (el manifest canónico queda con la integrity de Android). Valida `id`/`version` del manifest iOS igual que Android, pero descarta el resto.

#### 1.4 `app/api/miniapps/[id]/upload/route.ts` — leer `platform`
- `const platform = (form.get("platform") === "ios" ? "ios" : "android")` (default android → backward-compat con el `publish.mjs` viejo que no manda `platform`).
- El `integrity = sha256Integrity(container.data)` se computa igual (bytes reales del chunk subido).
- **Android:** como hoy — `manifest.integrity = integrity`, `publishVersion({version, url, manifest})`.
- **iOS:** `publishVersion({version, url, manifest, platform:"ios", integrity})` (el integrity va a `iosIntegrity`; el manifest solo se usa para validar id/version).
- El compat-gate corre igual en ambos (mismo manifest shape; redundante en iOS pero inocuo).
- Respuesta: `{ id, version, url, platform }`.

#### 1.5 `lib/registry/registry.ts` — `resolveMiniapp` (platform)
`ResolveOptions += platform?: "android" | "ios"`. Al final, elegida `chosen`:
```ts
if (opts.platform === "ios") {
  if (chosen.iosUrl === undefined) {
    throw new NoCompatibleVersionError(id, `iOS no publicado para la versión ${chosen.version}`);
  }
  return {
    id, version: chosen.version,
    url: chosen.iosUrl,
    manifest: { ...chosen.manifest, integrity: chosen.iosIntegrity },
  };
}
// android/sin platform → intacto: url + manifest (integrity Android)
return { id, version: chosen.version, url: chosen.url, manifest: chosen.manifest };
```

#### 1.6 `app/api/resolve/route.ts` — `?platform=`
```ts
const platform = url.searchParams.get("platform") === "ios" ? "ios" : undefined;
const resolved = resolveMiniapp(reg, id, { version, range, platform });
```
(sin `platform` o `android` → comportamiento actual.)

### Capa 2 — `backstagereactnative` (host): mandar `Platform.OS`

- `packages/miniapp-contract/src/types.ts`: `ResolveRequest += platform?: "ios" | "android"`.
- `packages/host-runtime/src/ResolveClient.ts` (`httpResolveClient`): sumar `platform` al querystring desde el request. El caller (`useMiniapp`/`MiniappHost`) inyecta `Platform.OS`.
- `packages/host-runtime/src/devResolveClient.ts:39`: reemplazar `?platform=android` hardcodeado por `?platform=${Platform.OS}` → **cierra #18**.
- `apps/host/src/screens/MiniappScreen.tsx`: pasar `Platform.OS` (de `react-native`) al resolve client.

*(La `ResolveRequest` vive en el paquete de contrato del propio host-repo; backstage-web lee `?platform=` del querystring y NO depende de ese tipo → sin republish cross-repo del contrato.)*

### Capa 3 — `miniapp-hellow_widget`: buildear + publicar iOS

- `package.json`: sumar `bundle:ios` espejando `bundle:android` (`--platform ios`, output a `build/generated/ios`).
- `scripts/publish.mjs`: computar la versión **una sola vez** (lee latest, patch-bump) y publicar **ambos** chunks a **esa misma V**: `upload(android, V)` luego `upload(ios, V, platform=ios)`. El 2º NO re-bumpea (adjunta).
- `.github/workflows/publish.yml` (build iOS + zip `build/generated/ios` + 2º upload): entrega **out-of-band** (muro de permisos `workflows`). Para el piloto alcanza incluso con un publish manual local del chunk iOS a la versión Android vigente.

### Capa 4 — iOS device (manual, en Xcode)

1. `cd apps/host/ios && pod install` (ya corrido; re-correr si hace falta).
2. Abrir `host.xcworkspace`, seleccionar el target `host` → Signing & Capabilities → setear **Team** (cuenta Apple) + bundle id único.
3. Simulador primero (sin firma): `pnpm ios` → validar que `hellow_widget` monta.
4. iPhone real: conectar, seleccionar el device, Run. ATS ya OK (R2/Vercel son HTTPS).

---

## No-regresión (Android en prod)

- `url`, `manifest`, `manifest.integrity`, path `${id}/${version}/`, `publishVersion` default, `/resolve` sin `platform`: **todo intacto**. iOS es puramente aditivo (campos opcionales + rama `platform==="ios"`).
- Test explícito: resolve sin `platform` de una versión sin iOS → idéntico a hoy.

## Verificación

**Unit (backstage-web):**
- `publishVersion`: iOS se adjunta a V existente (setea iosUrl/iosIntegrity, no toca url/manifest); iOS en V inexistente → InvalidManifest; iOS dos veces misma V → VersionExists; Android sin cambios.
- `resolveMiniapp`: `platform:"ios"` → iosUrl + integrity pisada; iOS ausente → NoCompatibleVersion; sin platform / android → intacto (no-regresión).
- `/api/resolve`: `?platform=ios` propaga; sin él = hoy.
- upload route: `platform=ios` adjunta y computa iosIntegrity de los bytes iOS.

**Host (backstagereactnative):** `httpResolveClient` incluye `platform` en la URL; `devResolveClient` usa `Platform.OS`.

**Manual:** Simulador monta hellow_widget en iOS; luego iPhone real (firma).

## Fuera de alcance

- Propagar iOS al resto de la flota (cards_wallet, account_dashboard) vía Capa 2 / fan-out.
- Generalizar a mapa multi-plataforma (`platforms: {…}`).
- iOS del **host** en CI / Fastlane / TestFlight (esto es build local + device).
- Firmar chunks (#2, diferido).

## Archivos afectados

**backstage-web:** `lib/registry/types.ts`, `lib/registry/registry.ts` (publishVersion + resolveMiniapp + ResolveOptions), `app/api/miniapps/[id]/upload/route.ts`, `app/api/resolve/route.ts` + tests.
**backstagereactnative:** `packages/miniapp-contract/src/types.ts` (ResolveRequest), `packages/host-runtime/src/ResolveClient.ts`, `packages/host-runtime/src/devResolveClient.ts`, `apps/host/src/screens/MiniappScreen.tsx` + tests; `apps/host/ios` (firma, manual).
**miniapp-hellow_widget:** `package.json` (bundle:ios), `scripts/publish.mjs`, `.github/workflows/publish.yml` (out-of-band).
