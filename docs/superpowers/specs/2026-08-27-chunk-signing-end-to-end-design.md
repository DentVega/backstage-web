# Firma de chunks — activación end-to-end (contrato + CI + host)

**Fecha:** 2026-08-27
**Estado:** Diseño aprobado — listo para plan
**Continúa:** `2026-08-26-chunk-signing-design.md` (backend, ya mergeado en backstage-web `main`).
**Roadmap:** ítem #2 — cierra las piezas out-of-band que el backend dejó pendientes.

## Contexto

El backend ya acepta/sirve firmas y el trust bundle (backstage-web, mergeado 2026-08-27).
Faltan las tres piezas para que la firma valga end-to-end: (1) el **contrato** con el campo
`signature`, (2) la **firma en el CI** de cada miniapp, (3) la **verificación en el host**. Este
diseño las cubre + el runbook de activación operacional.

## Deltas respecto del spec original

1. **Activación del host = flag `warn`/`enforce` build-time (NO "enforce directo").** El host
   siempre verifica, pero un flag **pineado en el binario** (patrón `__BACKSTAGE_URL__`) decide
   qué hace ante una firma faltante/ inválida:
   - **warn** (default): monta igual + emite una métrica (razón `invalid-signature`/`unknown-key`).
   - **enforce**: no monta → fallback tipado no-retryable.
   - El flag **no es remoto** a propósito: si lo sirviera el backend, un server comprometido
     podría apagar el enforce y anular la firma (downgrade attack). Flipear = editar el
     constante + release del host (one-way ratchet en la práctica).
   - **`off` implícito:** si no hay `ROOT_PUBLIC_KEY` pineada, la verificación es no-op sin
     importar el modo. Así un host con `warn` pero sin root key = seguro (off) hasta que el
     owner pinee la clave.
2. **Anti-rollback del trust bundle: DIFERIDO.** El host no tiene persistencia (ni AsyncStorage
   ni MMKV). Rechazar un bundle de `version` menor a la más alta vista requiere guardar ese
   valor en disco → dependencia nueva, fuera de alcance de v1. El host **sí** verifica la firma
   root del bundle en cada arranque; solo no recuerda la versión entre sesiones. **Residual:** un
   atacante con control del server podría servir un bundle viejo *válidamente firmado* para
   reinstalar una pubkey vieja/revocada — bajo (las pubkeys casi no rotan). Follow-up.
3. **Librería `@noble/curves` (no `@noble/ed25519`).** El host corre en Hermes (sin WebCrypto).
   `@noble/curves/ed25519` trae su propio sha512 (JS puro, self-contained) → verifica sin
   `subtle`. Mismo formato de claves/firma raw; interopera con lo que firma el backend/CI.

## Qué se firma (recordatorio, confirmado contra el código)

El CI firma el string `` `${id}:${platform}:${integrity}` `` donde `integrity` = `sha256-<hex>`
del **`<id>.container.js.bundle` extraído del zip** (el server hashea ese mismo archivo, no el
zip — confirmado en la ruta de upload). El host reconstruye el mismo mensaje: `id` = `resolved.id`,
`platform` = la que pidió (su `Platform.OS`), `integrity` = `manifest.integrity` de la respuesta
del resolve. Para iOS, el resolve ya inyecta `iosIntegrity`/`iosSignature` en `manifest`, así que
el host usa `id:ios:<iosIntegrity>` sin lógica especial.

## Fase 1 — Contrato (`packages/miniapp-contract`, repo host)

- `Manifest` += `readonly signature?: string` (junto a `integrity?`). `types.ts:37-52`.
- `isManifest` (`guards.ts`): validar `signature` como string si está presente (igual que
  `integrity`).
- Bump **0.3.0 → 0.4.0** (campo opcional aditivo = minor, backward-compatible). Publicar a
  GitHub Packages (`PUBLISHING.md`, double-consume).
- **Consumidores:**
  - Host: consume `src` en el monorepo (workspace) → sin bump manual, ve el campo al toque.
  - backstage-web: dep `@dentvega/miniapp-contract` `^0.3.0` → `^0.4.0`; **sacar el cast local**
    (`as Manifest`) en `resolveMiniapp` ahora que `signature` es del tipo. (Delta 4 del spec
    original.)

## Fase 2 — Firma en el CI (`miniapp-template`)

- **`scripts/publish.mjs`** (template-owned → propaga a la flota vía template-sync):
  - Antes de subir, extrae `${id}.container.js.bundle` del zip (con `fflate.unzipSync`), calcula
    `sha256-<hex>` (node:crypto), arma `msg = ${id}:${platform}:${integrity}`, y firma con
    Ed25519 usando `MINIAPP_SIGN_KEY` (seed raw base64url) → `signature` base64url.
  - Suma `form.set("signature", signature)` en `upload()`.
  - **Degradación segura:** si `MINIAPP_SIGN_KEY` no está seteada → no firma (no manda el campo).
    El server acepta y el host (warn) monta igual. Cero ruptura mientras se despliega.
  - La lógica de firma (seed raw → PKCS8 → `sign`) es la misma que `backstage-web/lib/crypto/
    ed25519.ts` y `scripts/sign-trust-bundle.mjs`; se duplica en JS puro (bootstrap tool, como el
    resto de `scripts/*.mjs`).
  - Dep: agregar `fflate` (ya usado en backstage-web) a `devDependencies`.
- **`.github/workflows/publish.yml`** (reusable `workflow_call`, propaga instant vía `@main`):
  - Declarar `MINIAPP_SIGN_KEY` (opcional, `required: false`) en `on.workflow_call.secrets`.
  - Pasarla como `env: MINIAPP_SIGN_KEY: ${{ secrets.MINIAPP_SIGN_KEY }}` en el step de publish.
  - Los callers usan `secrets: inherit` → sin cambio por-repo; solo hay que setear el secret.

## Fase 3 — Verificación en el host (`packages/host-runtime`)

- **Dep:** `@noble/curves`.
- **`signatureMessage(id, platform, integrity)`** — helper puro, espeja el backend.
- **Trust bundle client** — `httpTrustBundleClient(baseUrl)`: `GET /api/trust-bundle` → verifica
  la firma root contra la `ROOT_PUBLIC_KEY` pineada (`@noble/curves`), devuelve el mapa
  `{miniappId → pubkey}` o `null` (si no hay bundle / firma root inválida / no hay root key).
  Cache in-memory session-lifetime (patrón `cachingResolveClient`).
- **`SignatureVerifier`** — interfaz espejo de `IntegrityVerifier`:
  ```ts
  type SignatureResult = "ok" | "missing" | "invalid" | "unknown-key" | "skip";
  interface SignatureVerifier { verify(resolved: ResolveResponse, platform: string): Promise<SignatureResult>; }
  ```
  - `skip` cuando no hay root key pineada (verificación off) → el host trata como pass sin métrica.
  - `missing` cuando `manifest.signature` está vacío. `unknown-key` cuando la miniapp no está en
    el bundle. `invalid` cuando la firma no verifica. `ok` cuando verifica.
- **Wire en `useMiniapp.ts`** — junto al gate de integridad (líneas 84-96):
  - Correr el signature verify después del integrity check.
  - Modo (`SIGNATURE_MODE`): en **warn**, si el resultado no es `ok`/`skip` → emitir métrica
    (`fallback:invalid-signature` o `:unknown-key`) y **montar igual**. En **enforce** → fallar
    con `failure = { reason: 'invalid-signature' | 'unknown-key' }` y no montar.
  - `missing`/`invalid` → razón `invalid-signature`; `unknown-key` → razón `unknown-key`.
- **`FallbackReason`** (`loaderState.ts`) += `'invalid-signature' | 'unknown-key'`. Ambas
  **no-retryable** (no entran a `RETRYABLE_REASONS`).
- **Config injection** (patrón `__BACKSTAGE_URL__`): `__ROOT_PUBLIC_KEY__` (default `''`) y
  `__SIGNATURE_MODE__` (default `'warn'`) → `globals.d.ts` + `DefinePlugin` en `rspack.config.mjs`
  + exports en `hostProvided.ts`. Vacío en `ROOT_PUBLIC_KEY` ⇒ verifier en `skip` (off).
- **Wiring de clients** (`MiniappScreen.tsx`): construir `httpTrustBundleClient(BACKSTAGE_BASE_URL)`
  + `signatureVerifier(...)` como singletons y pasarlos a `MiniappHost`/`useMiniapp` (como hoy con
  `integrity`). Dev-remotes → verifier en `skip`.
- **Métricas:** reusar el `MetricsClient` existente (fire-and-forget) para emitir la razón de
  fallback en warn.

## Fase 4 — Activación operacional (runbook; owner-run)

Orden obligado (enforce es one-way; el host warn no rompe nada mientras tanto):

1. **Contrato** publicado (Fase 1) + host y backstage-web consumiendo `^0.4.0`.
2. **Template** con `publish.mjs` firmante desplegado (Fase 2): `publish.yml` `@main` (instant) +
   `publish.mjs` propagado por template-sync (lagged, PRs por-repo).
3. **Host** con verificación en **warn** desplegado (Fase 3), pero **sin `ROOT_PUBLIC_KEY`** aún
   ⇒ verificación off. (Se puede shippear seguro en este punto.)
4. **Claves (owner):**
   - `node scripts/keygen.mjs --label root` → guardar la privada offline; setear la pública en
     Vercel `ROOT_PUBLIC_KEY` **y** pinearla en el host (`__ROOT_PUBLIC_KEY__`, requiere rebuild).
   - `node scripts/keygen.mjs` por miniapp → privada al secret `MINIAPP_SIGN_KEY` de cada repo;
     pública registrada con `PUT /api/miniapps/:id/public-key`.
5. **Trust bundle:** `node scripts/sign-trust-bundle.mjs --base <backstage> --key-file root.key`.
6. **Republicar la flota** (push a cada repo o botón Deploy) → las versiones servidas quedan
   firmadas.
7. **Observar** `/metrics`: en warn, confirmar que no hay `fallback:invalid-signature`/`unknown-key`
   para ninguna miniapp de la flota.
8. **Flip a enforce:** cambiar `__SIGNATURE_MODE__` a `'enforce'` + **release del host**.

**Qué hace quién:** yo escribo todo el código (contrato, publish.mjs, host-runtime, tests) + docs
+ tooling. El owner hace: setear `ROOT_PUBLIC_KEY` en Vercel + pinearla en el host, setear los
secrets `MINIAPP_SIGN_KEY`, correr los builds/releases nativos del host, y la verificación en
device.

## Testing

- **Contrato:** `guards` acepta `signature` string / rechaza no-string (test).
- **Template:** test de `publish.mjs` — el core de firma (extraer container → integrity → firmar
  `id:platform:integrity`) produce una firma que el verificador de producción valida
  (`node:test`, como `sign-trust-bundle.test.mjs`).
- **Host:** `signatureMessage` (pura); `httpTrustBundleClient` (verifica/rechaza firma root, mapea
  keys, null en fallos); `signatureVerifier` (ok/missing/invalid/unknown-key/skip); `useMiniapp`
  en warn (monta + métrica) y enforce (fallback no-retryable); `isRetryable` de las razones nuevas.

## Fuera de alcance (follow-ups)

- Anti-rollback persistente del trust bundle (necesita persistencia en el host).
- `scaffoldSecrets` auto-seed de `MINIAPP_SIGN_KEY` para miniapps nuevas (v1: keygen + secret
  manual; el patrón de auto-seed existe para `PUBLISH_TOKEN`).
- Rotación automática de claves.
- Bajar el doble-fetch del chunk (integrity y MF lo bajan por separado — pre-existente, no lo
  toca este trabajo).
