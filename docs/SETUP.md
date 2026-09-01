# Levantar la plataforma en una empresa nueva

> Guía única para poner en marcha, **desde cero**, todo el ecosistema
> "Spotify-for-miniapps": el control-plane web (**Backstage**, este repo) y el
> host móvil (**backstagereactnative**, React Native + Re.Pack). Consolida y
> referencia los docs existentes en vez de duplicarlos — léelos si necesitas el
> detalle fino de cada pieza:
>
> - [`DEPLOY.md`](../DEPLOY.md) — deploy de Backstage a Vercel.
> - [`docs/miniapps-guide.md`](./miniapps-guide.md) — ciclo de vida completo de una miniapp (crear → publicar → montar).
> - [`docs/activar-compat-gates.md`](./activar-compat-gates.md) — encender los gates de compatibilidad de dependencias (warn → enforce). Ver **Parte E**.
> - [`docs/rotar-publish-token.md`](./rotar-publish-token.md) — rotar el `PUBLISH_TOKEN` sin downtime. Ver **Parte E**.
> - [`README.md`](../README.md) (este repo) y el `README.md` de `backstagereactnative` — arquitectura y stack.
> - `backstagereactnative/packages/PUBLISHING.md` — publicar los paquetes `@scope/*` a GitHub Packages.
> - `backstagereactnative/docs/mounting-miniapps.md` — montar una miniapp en cualquier punto del host.
>
> **Novedades desde la v1 de esta guía** (todo cubierto abajo): storage en
> **Cloudflare R2** (además de Vercel Blob) con selección de provider **desde la
> UI** y override **por miniapp** (§4.3, Parte E); **gates de compatibilidad de
> dependencias** en enforce (Parte E); **contract package** con semver real
> (§3.2); **borrar miniapp + repo** desde Backstage (Parte E); **rotación del
> `PUBLISH_TOKEN`** (Parte E).
>
> Esta guía asume un ingeniero competente que es nuevo **en esta plataforma**,
> no en su stack (Next.js, React Native, GitHub Actions, Vercel).

---

## 1. Panorama y arquitectura

Tres planos, un único acoplamiento (el contrato versionado):

```
Backstage (web, control-plane)        Repos de miniapp              Host móvil (RN + Re.Pack)
  - Registry (catálogo)                 - código + ./Entry            - resuelve por id (GET /api/resolve)
  - Scaffolder (crear repo)             - CI: build → publish         - descarga el chunk (Module Federation)
  - Distribution API (/resolve)                                       - monta <MiniappHost/>
```

- **Backstage Web** (este repo, Next.js 16): registro de miniapps (versiones,
  chunks, manifest, owner), scaffolder ("crear miniapp" desde un template) y
  API de distribución (`/api/resolve`).
- **Host móvil** (`backstagereactnative`): app RN + Re.Pack (Module Federation
  v2) que resuelve, descarga y monta miniapps en tiempo de ejecución — sin
  rebuild del host para actualizar una miniapp.
- **Repos de miniapp**: uno por miniapp, generado desde `miniapp-template`
  (repo GitHub **template**, público), con su propia CI que construye el
  chunk y lo publica a Backstage.
- **Acoplamiento único**: el contrato de tipos versionado `@scope/miniapp-contract`
  (manifest, forma de `/resolve`, capabilities, resolución de versiones).

Diagramas más detallados (Mermaid) están en el `README.md` de cada repo.

---

## 2. Prerrequisitos

### Cuentas
- **GitHub**: una cuenta o, preferible, una **organización** que actuará como
  owner de los repos (`backstage-web`, `backstagereactnative`, `miniapp-template`
  y cada `miniapp-*`). El proyecto original usa un **usuario** GitHub
  (`DentVega`) como owner — funciona igual con una org; usa lo que prefieras,
  simplemente sé consistente en todos los env vars y workflows (ver §3).
- **Vercel**: cuenta con acceso a **Marketplace** (para Upstash Redis y Vercel
  Blob) y a **Vercel KV/Storage**.

### Herramientas locales
```bash
node -v     # Node 20+
corepack enable && corepack prepare pnpm@10 --activate   # pnpm 10 (pinneado como packageManager)
gh --version        # GitHub CLI (crear/repos, secrets, permisos)
npm i -g vercel && vercel --version   # Vercel CLI
java -version        # ver §9 — necesitas OpenJDK 17 para Android, NO Zulu
```
- **Android**: Android Studio + SDK, un emulador o dispositivo físico
  (`adb devices` debe listarlo), y **OpenJDK 17** (no Zulu — ver
  [Gotchas](#9-gotchas-conocidos)).
- **iOS** (opcional, solo macOS): Xcode + CocoaPods (`pod install` necesita un
  Ruby con CocoaPods 2.7.6 o 3.3.5 instalado).

### Autenticación
```bash
gh auth login
vercel login
```

---

## 3. Parte A — Paquetes compartidos + template

Objetivo: publicar `@scope/miniapp-contract` y `@scope/ui-kit` a **GitHub
Packages** (públicos) y dejar listo el repo `miniapp-template` (público +
marcado como **Template repository**) con su CI reutilizable.

### 3.1 Elegir el scope y el owner

El proyecto de referencia usa el scope npm `@dentvega` y el owner GitHub
`DentVega`. Una empresa nueva **debe reemplazar ambos** — hay un script que lo
hace en un comando, en cada repo (corre desde la raíz del repo copiado):

```bash
# 1) preview (dry-run — no escribe nada):
node scripts/bootstrap.mjs --scope @acme --owner Acme

# 2) aplicar:
node scripts/bootstrap.mjs --scope @acme --owner Acme --yes

# 3) regenerar el lockfile con los nuevos nombres de paquete:
pnpm install
```

- `--scope` es tu scope npm (debe empezar con `@`); `--owner` tu usuario/org de
  GitHub. `--login` es opcional (default: el owner en minúscula) y solo afecta
  fixtures de test.
- Reemplaza `@dentvega`→tu scope, `DentVega`→tu owner y `dentvega`→tu login en
  `package.json`, `.npmrc`, `rspack.config.mjs`, `.github/workflows/*`, `src`,
  `docs`, etc. Excluye lockfiles (por eso el `pnpm install`) y sus propios
  archivos.
- Tiene un **guard**: se niega a escribir si detecta que corres sobre los repos
  origen (`DentVega/*`); usá `--force` solo si sabés lo que hacés.

> `docs/miniapps-guide.md` usa `@org/...` como placeholder genérico (ya pensado
> para sustituirse). Lo **literal** que el bootstrap renombra es `@dentvega` /
> `DentVega`.

### 3.2 Publicar `miniapp-contract` y `ui-kit` (repo `backstagereactnative`)

Sigue `packages/PUBLISHING.md` al pie de la letra (patrón de doble consumo —
ADR-010: en el monorepo se consumen como fuente, `publishConfig` de pnpm
sobreescribe a `dist` al publicar):

```bash
cd backstagereactnative

# 1) build
pnpm --filter @acme/ui-kit build
pnpm --filter @acme/miniapp-contract build

# 2) verificar el tarball
pnpm --filter @acme/ui-kit pack
pnpm --filter @acme/miniapp-contract pack

# 3) publicar — requiere GITHUB_TOKEN con scope write:packages en el entorno
pnpm --filter @acme/miniapp-contract publish --no-git-checks
pnpm --filter @acme/ui-kit publish --no-git-checks
```

Ambos paquetes deben quedar **públicos** en GitHub Packages (Settings del
paquete → Change visibility → Public). Es lo que permite que la CI de cada
miniapp los lea con el `GITHUB_TOKEN` automático de Actions, sin secreto extra
(ver `publish.yml` reutilizable, §3.4).

El `.npmrc` de cada repo consumidor debe mapear el scope:
```
@acme:registry=https://npm.pkg.github.com
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```
(Ya está así en `backstage-web/.npmrc`, `backstagereactnative/.npmrc` y
`miniapp-template/.npmrc` — solo cambia `@dentvega` → tu scope, como en §3.1.)

### 3.3 Crear el repo `miniapp-template`

1. Crea un repo nuevo **público** llamado `miniapp-template` bajo tu owner
   (`gh repo create <owner>/miniapp-template --public --template`, o desde la
   UI marcando **"Template repository"** en Settings — es un requisito duro:
   sin eso, `POST /repos/{template}/generate` del scaffolder falla).
2. Copia el contenido del `miniapp-template` de referencia (`package.json`,
   `manifest.json`, `rspack.config.mjs`, `src/Entry.tsx`, `.github/workflows/*`,
   `.npmrc`, `.templatesyncignore`, `babel.config.cjs`, `tsconfig.json`,
   `react-native.config.js`).
3. Aplica el rename de §3.1 (`@dentvega`→tu scope, `DentVega`→tu owner) en:
   - `package.json` (`name: "@acme/miniapp-__MINIAPP_ID__"`, deps `@acme/miniapp-contract`/`@acme/ui-kit`)
   - `rspack.config.mjs` (entrada `shared['@acme/ui-kit']`)
   - `.npmrc`
   - `.github/workflows/ci.yml` (línea `uses: <Owner>/miniapp-template/.github/workflows/publish.yml@main`)
   - `.github/workflows/init-template.yml` (dos líneas: `gh api repos/<Owner>/miniapp-template/commits/main` y el JSON `"templateRepo": "<Owner>/miniapp-template"`)
4. Empuja a `main`. Verifica en Settings → General que **"Template repository"**
   quede marcado (se puede resetear al recrear el repo).

Piezas del template que **no** hay que tocar (son genéricas por diseño):
- `.github/workflows/publish.yml`: workflow **reutilizable** — la CI real de
  build+publish vive aquí; cada miniapp solo tiene un `ci.yml` que lo invoca
  (`uses: <owner>/miniapp-template/...@main`). Arreglarlo aquí arregla la CI
  de todas las miniapps a la vez, sin tocar repo por repo (Capa 1 anti-drift).
- `.github/workflows/init-template.yml`: workflow **one-shot** que corre en el
  primer push de un repo generado — sustituye los placeholders
  `__MINIAPP_ID__`/`__MINIAPP_NAME__`/`__MINIAPP_OWNER__` según el nombre del
  repo (`miniapp-<id>`), escribe el marcador `.template-sync` y se
  autoelimina. Se salta si `is_template` (o sea, nunca corre sobre el propio
  template).
- `.github/workflows/template-sync.yml`: PR de 3-way merge bajo demanda (botón
  **"Actualizar desde template"** en Backstage) — lee el `templateRepo` del
  marcador `.template-sync`, así que no tiene el owner hardcodeado (Capa 2
  anti-drift).

---

## 4. Parte B — Backstage (control-plane)

### 4.1 Clonar y correr en local

```bash
git clone https://github.com/<owner>/backstage-web.git
cd backstage-web
pnpm install
```

Crea `.env.local` (git-ignored) con, mínimo, lo necesario para login:
```bash
AUTH_SECRET=$(openssl rand -base64 32)
AUTH_GITHUB_ID=<client id de la OAuth App>
AUTH_GITHUB_SECRET=<client secret de la OAuth App>
CI_STATUS_ENABLED=false   # los badges de CI muestran "unknown" sin pegarle a GitHub
```

### 4.2 Crear la GitHub OAuth App (login)

GitHub → Settings → Developer settings → **OAuth Apps** → New OAuth App:
- **Homepage URL**: `http://localhost:3999` (dev) o tu URL de Vercel (prod) — puedes crear una app por entorno o una sola con ambos callbacks si GitHub lo permite; lo más simple es **una app de dev** y **una de prod**.
- **Authorization callback URL**: `http://localhost:3999/api/auth/callback/github` (dev) — nota: por convención el host móvil espera Backstage en `:3999` (no el 3000 por defecto de Next). El script `dev` es `next dev` pelado, así que corré el dev server con `PORT=3999 pnpm dev` (o `pnpm exec next dev -p 3999`).
- Para prod: `https://<tu-proyecto>.vercel.app/api/auth/callback/github`.

### 4.3 Provisionar servicios (registro + storage de chunks)

```bash
vercel link                # desde backstage-web/
```

**Registro/catálogo (`getStore()`)** — Upstash Redis (KV):
- Vercel Dashboard → Storage → **Upstash Redis** (Marketplace) → setea
  `KV_REST_API_URL` + `KV_REST_API_TOKEN` automáticamente.
- Selección automática por env: KV si están esas dos vars; si no, `jsonStore`
  (fs, dev) sobre `data/registry.json`.

**Storage de chunks (`getStorage()`)** — soporta **tres backends**, elegidos por
env en este orden de precedencia: **R2 → Blob → fs**.

- **Cloudflare R2 (recomendado, primario):** S3-compatible, sin el límite de
  operaciones del free tier de Blob. Setup en Cloudflare:
  1. Crear un bucket R2 (ej. `miniapp-chunks`).
  2. **Habilitar acceso público** → te da la URL `https://pub-xxxxx.r2.dev`.
  3. Crear un token **S3 API** (Object Read & Write) → Access Key + Secret.
  4. Anotar el **Account ID**.

  Setear las 5 vars en Vercel: `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`,
  `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, `R2_PUBLIC_BASE_URL`. Con las 5 presentes,
  R2 es el activo.
- **Vercel Blob (fallback):** Marketplace → setea `BLOB_READ_WRITE_TOKEN`. Se usa
  si R2 no está configurado. (Ojo: su free tier se agota — 2000 ops/mes — y el
  store se **suspende**; por eso R2 es el primario.)
- **fs (dev):** si no hay R2 ni Blob, sirve desde `public/chunks/`
  (`BACKSTAGE_PUBLIC_URL` como origen). Solo para local.

**Selección desde la UI (opcional):** un admin puede fijar el provider activo
desde el **catálogo** (strip "Storage") y **por miniapp** desde el detalle
("Almacenamiento") — la preferencia vive en KV y `getStorage()` la respeta, con
fallback seguro al orden por env si el provider elegido no tiene creds. Ver
Parte E. Sin preferencia guardada, manda el orden por env (R2 → Blob → fs).

**Chunks por plataforma (Android + iOS):** cada versión puede tener un chunk
Android y uno iOS. El chunk Android se guarda en `${id}/${version}/` (como
siempre); el iOS va a un subfolder `${id}/${version}/ios/` — mismo nombre de
container (`${id}.container.js.bundle}`) en ambos, distintos bytes. El
`PublishedVersion` del registro guarda `url`+`manifest.integrity` para Android
y, si se publicó, `iosUrl`+`iosIntegrity` para iOS (integrity **por
plataforma**, porque los bytes del chunk difieren). `GET /api/resolve` acepta
`?platform=ios` y devuelve `iosUrl` con la integridad de iOS pisada en el
manifest; sin ese parámetro (o `platform=android`) resuelve el chunk Android,
igual que antes.

> [!TIP]
> **R2 y el 411:** el PUT a R2 fija `Content-Length` explícito. R2 rechaza
> uploads *chunked* (HTTP 411) y el `fetch` parcheado de Next.js puede streamear
> el body; el adapter lo evita. (Solo relevante si tocás `lib/storage/r2.ts`.)

### 4.4 Variables de entorno de Backstage

```bash
# --- login + scaffolding (mínimo para arrancar) ---
vercel env add AUTH_SECRET
vercel env add AUTH_GITHUB_ID
vercel env add AUTH_GITHUB_SECRET
vercel env add SCAFFOLD_ALLOWED_LOGINS
vercel env add MINIAPP_TEMPLATE_REPO
vercel env add GITHUB_TOKEN            # scopes: repo, workflow, delete_repo, read:packages (ver tabla §8)
vercel env add PUBLISH_TOKEN
vercel env add BACKSTAGE_URL
vercel env add BACKSTAGE_PUBLIC_URL

# --- storage R2 (recomendado; si no, Blob por Marketplace) ---
vercel env add R2_ACCOUNT_ID
vercel env add R2_ACCESS_KEY_ID
vercel env add R2_SECRET_ACCESS_KEY
vercel env add R2_BUCKET
vercel env add R2_PUBLIC_BASE_URL

# --- gates de compatibilidad (Parte E; se pueden dejar para después) ---
vercel env add HOST_CONTRACT_TOKEN    # token dedicado para publicar el host contract
vercel env add HOST_REPO              # ej. Acme/backstagereactnative (capability requests)
# COMPAT_ENFORCE se agrega recién al pasar a enforce (Parte E)
# CI_STATUS_ENABLED — opcional (badge de CI)

# --- firma de chunks (opcional; ver docs/API-REFERENCE.md §5.7) ---
vercel env add ROOT_PUBLIC_KEY        # pubkey root (base64url); habilita el sanity-verify de PUT /api/trust-bundle
```
Ver la tabla completa (nombre, propósito, notas) en **§8 — Referencia de
variables de entorno**.

### 4.5 Deploy

```bash
vercel deploy --prod   # → https://<tu-proyecto>.vercel.app
```

### 4.6 Seed del catálogo (una vez)

```bash
curl -X POST https://<tu-proyecto>.vercel.app/api/seed \
  -H "authorization: Bearer $PUBLISH_TOKEN"
```

### 4.7 Smoke test

```bash
curl https://<tu-proyecto>.vercel.app/catalog
curl "https://<tu-proyecto>.vercel.app/api/resolve?id=account_dashboard"
curl -X POST https://<tu-proyecto>.vercel.app/api/miniapps/x/upload   # → 401 (sin token, esperado)
```

Detalle completo de este flujo (incluyendo conectar la CI de cada miniapp y el
host) en [`DEPLOY.md`](../DEPLOY.md).

---

## 5. Parte C — Host móvil

### 5.1 Clonar y bootstrapear el monorepo

```bash
git clone https://github.com/<owner>/backstagereactnative.git
cd backstagereactnative
pnpm install
pnpm build:packages   # build de packages/miniapp-contract, host-runtime, ui-kit
```

Layout relevante:
```
apps/host/                 host RN + Re.Pack (Module Federation v2)
packages/
  miniapp-contract/        contrato: manifest, forma de resolve, capabilities
  host-runtime/             loader: resolve → verify → mount → fallback
  ui-kit/                    primitivas de UI compartidas (ThemeProvider, tokens)
```

### 5.2 Apuntar el host a tu Backstage

El host inyecta la URL de Backstage en build-time vía `DefinePlugin` en
`apps/host/rspack.config.mjs`:
```js
new rspack.DefinePlugin({
  __BACKSTAGE_URL__: JSON.stringify(
    process.env.BACKSTAGE_URL ?? 'http://localhost:3999',
  ),
}),
```
`src/hostProvided.ts` lee `__BACKSTAGE_URL__`. Para apuntar a tu prod:
```bash
BACKSTAGE_URL=https://<tu-proyecto>.vercel.app pnpm --filter @app/host bundle:android
```
En dev, sin setear `BACKSTAGE_URL`, cae a `http://localhost:3999`.

### 5.3 Correr en Android

```bash
# JDK 17 — ver Gotchas (§9): usa OpenJDK, NO Azul Zulu
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home

adb devices   # confirma un emulador/dispositivo conectado

cd apps/host
pnpm start          # Metro/Re.Pack dev server en :8081
pnpm android         # en otra terminal: react-native run-android
```
Si usas un dispositivo físico (no emulador), mapea los puertos:
```bash
adb reverse tcp:8081 tcp:8081     # dev server del host
adb reverse tcp:3999 tcp:3999     # Backstage (dev) — /resolve + /chunks
```

### 5.4 Correr en iOS (macOS)

**Simulador:**
```bash
cd apps/host/ios
pod install          # requiere un Ruby con CocoaPods (2.7.6 o 3.3.5)
cd ..
pnpm ios
```

**iPhone real:** abrí `apps/host/ios/host.xcworkspace` en Xcode, seteá tu
**Team** de firma (Signing & Capabilities) y corré (▶) apuntando al
dispositivo. ATS (App Transport Security) ya viene resuelto — R2 y Vercel
sirven por HTTPS, así que no hace falta ninguna excepción de ATS.

### 5.5 Montar una miniapp en el host

`MiniappHost` hace todo el ciclo `resolve → verify → download → mount →
fallback` y se puede montar en **cualquier punto** del árbol (tab, sección,
modal, inline) — el loader es genérico, no requiere tocar `rspack.config.mjs`
por miniapp:

```tsx
import {MiniappHost, createScopedGrant, httpResolveClient} from '@acme/host-runtime';
import {repackChunkLoader} from '../chunkLoader';
import {HOST_PROVIDED, BACKSTAGE_BASE_URL} from '../hostProvided';

const resolveClient = httpResolveClient(BACKSTAGE_BASE_URL);

<MiniappHost
  id={'cards_wallet' as MiniappId}
  resolveClient={resolveClient}
  chunkLoader={repackChunkLoader}
  hostProvided={HOST_PROVIDED}
  capabilities={grant}   // inyecta SOLO las capabilities que la miniapp necesita
/>
```

Guía completa (playbook + troubleshooting) en
`backstagereactnative/docs/mounting-miniapps.md`.

---

## 6. Parte D — Crear la primera miniapp

Flujo real end-to-end: crear repo → publicar versión → verla montada en el
host. Detalle completo en [`docs/miniapps-guide.md`](./miniapps-guide.md); acá
el resumen operativo.

### 6.1 Crear (scaffold) desde Backstage

1. Añade tu login de GitHub a `SCAFFOLD_ALLOWED_LOGINS` (si no lo hiciste en §4.4).
2. Logueado, abre `https://<tu-proyecto>.vercel.app/create` (o `:3999/create` en dev).
3. Rellena **id** (minúsculas + guion bajo, ej. `cards_wallet`), **name**, **owner**.
4. Enviar → crea `github.com/<owner>/miniapp-<id>` (privado, desde el template) y lo registra en el catálogo.

Equivalente por API:
```bash
curl -X POST https://<tu-proyecto>.vercel.app/api/scaffold \
  -H "content-type: application/json" -b <cookie-de-sesión> \
  -d '{"id":"cards_wallet","name":"Cards Wallet","owner":"<owner>"}'
```

**Lo que el scaffolder hace automáticamente al crear el repo** (sin pasos
manuales por miniapp):
- Genera el repo desde `MINIAPP_TEMPLATE_REPO`.
- Habilita el permiso de Actions **"Allow GitHub Actions to create pull
  requests"** (`can_approve_pull_request_reviews`) — necesario para que
  `template-sync.yml` pueda abrir su PR con el `GITHUB_TOKEN` automático.
- Siembra los **secrets de Actions** `BACKSTAGE_URL` y `PUBLISH_TOKEN` en el
  nuevo repo (a partir de los mismos env vars de Backstage) — así su CI puede
  publicar desde el primer push, sin tocar nada a mano.

Ambos pasos son **best-effort**: si fallan, no abortan el scaffold (el repo
igual queda creado y registrado) — solo quedan pendientes de reaplicar. Para
un repo existente o creado a mano, replícalos manualmente:
```bash
gh secret set BACKSTAGE_URL --repo <owner>/miniapp-<id> --body "https://<tu-proyecto>.vercel.app"
gh secret set PUBLISH_TOKEN --repo <owner>/miniapp-<id> --body "<PUBLISH_TOKEN>"
gh api -X PUT repos/<owner>/miniapp-<id>/actions/permissions/workflow \
  -F can_approve_pull_request_reviews=true
```

El primer push a `main` del repo generado dispara `init-template.yml`, que
sustituye los placeholders `__MINIAPP_ID__`/`__MINIAPP_NAME__`/`__MINIAPP_OWNER__`
según el nombre del repo, escribe el marcador `.template-sync` y se
autoelimina (workflow one-shot).

### 6.2 Publicar una versión

Vía CI (automático en cada push a `main`, gracias al `ci.yml` → `publish.yml`
reutilizable): construye los chunks estáticos de **Android e iOS**, los
empaqueta y publica ambos a Backstage con `PUBLISH_TOKEN`, en la misma
versión. El script `scripts/publish.mjs android.zip [ios.zip]` calcula la
versión **una sola vez** y **auto-bump-ea** el patch siguiente a partir de la
`latestVersion` del registro — evita el 409 al reintentar un deploy sin
cambiar la versión a mano. El 2° upload (iOS) se manda con `platform=ios` y
queda **adjuntado** a la misma versión que el de Android; con un solo zip
publica solo Android (compatible hacia atrás). El build de **iOS es
best-effort**: si falla, no bloquea el publish de Android.

También puedes disparar la build/publish bajo demanda con el botón
**"Deploy"** de Backstage (`POST /api/miniapps/:id/deploy`, dispara
`ci.yml` vía `workflow_dispatch`), o publicar manualmente:
```bash
curl -X POST https://<tu-proyecto>.vercel.app/api/miniapps/<id>/upload \
  -H "Authorization: Bearer $PUBLISH_TOKEN" \
  -F "version=0.1.0" -F "capabilities=accounts:read" \
  -F "file=@/tmp/<id>.zip;type=application/zip"
```

Verifica:
```bash
curl "https://<tu-proyecto>.vercel.app/api/resolve?id=<id>"                 # → {url, manifest} (Android)
curl "https://<tu-proyecto>.vercel.app/api/resolve?id=<id>&platform=ios"    # → {url, manifest} con el chunk iOS, si se publicó
```

### 6.3 Verla montada en el host

Con el host apuntando a tu Backstage (§5.2) y la miniapp publicada, móntala
con `<MiniappHost id="<id>" .../>` (§5.5). En dev con dispositivo físico,
recuerda `adb reverse tcp:3999 tcp:3999` para que el device llegue a tu
Backstage local; en prod, el chunk vive en una URL pública (Blob/CDN), sin
`adb reverse`.

---

## 7. Parte E — Endurecimiento de producción y operación

Todo lo de arriba te deja la plataforma **funcionando**. Esta parte la endurece
y cubre las operaciones de día a día. Cada ítem es independiente — hacelos cuando
los necesites.

### 7.1 Gates de compatibilidad de dependencias (anti-drift)

Impide que un cambio de deps de una miniapp (bump de React Native, lib nueva o
nativa) rompa el host o a otras miniapps. Es un sistema de 4 fases (host contract
+ gate al publicar + detección nativa + pedido automatizado + gobernanza del
host) que arranca en **modo warn** (loguea, no bloquea) y se pasa a **enforce**
cuando validás que nadie queda incompatible.

- Requisitos: `HOST_CONTRACT_TOKEN` + `HOST_REPO` en Vercel; el repo del host con
  los secrets `BACKSTAGE_URL` + `HOST_CONTRACT_TOKEN`.
- Runbook completo (los 6 pasos, warn → enforce, con rollback): **[`docs/activar-compat-gates.md`](./activar-compat-gates.md)**.
- **Enforce** = 3 capas: `COMPAT_ENFORCE=1` como repo var en cada miniapp (gate
  del CI) + branch protection del check `blast-radius` en el host + `COMPAT_ENFORCE=1`
  en Vercel (backstop server-side del `/upload` → 422). Todo reversible.
- Diseño: `docs/superpowers/specs/2026-07-29-dependency-compatibility-design.md`.

### 7.2 Selector de storage provider (UI)

Con R2 y Blob ambos configurados, un admin elige el provider activo **sin tocar
env ni redeploy**:
- **Default global:** strip "Storage" arriba del catálogo (solo admin).
- **Override por miniapp:** sección "Almacenamiento" en el detalle de cada
  miniapp — pinnea un provider distinto al default para esa miniapp.
- Precedencia al publicar: override de la miniapp → default global → orden por
  env (R2 → Blob → fs), con fallback seguro en cada nivel.
- Endpoints admin: `GET/PUT /api/storage-provider`, `PUT /api/miniapps/:id/storage-provider`.
- No migra chunks ya publicados; cada re-publish usa el provider activo.

### 7.3 Borrar una miniapp (+ su repo) desde Backstage

En el detalle de la miniapp → sección **"Zona de peligro"** (solo admin):
- Tipear el id exacto para confirmar (irreversible).
- Checkbox "también borrar el repositorio de GitHub" (default ON).
- Endpoint: `DELETE /api/miniapps/:id?repo=true` (orden repo→registry, fail-safe:
  si el borrado del repo falla, no toca el registry).
- **Requiere** que el `GITHUB_TOKEN` de Vercel tenga el scope **`delete_repo`**
  (ojo: `delete_repo`, NO `delete:packages`). Sin él, el borrado del registry
  anda pero el del repo devuelve 403 con mensaje claro. No borra los chunks del
  CDN (quedan huérfanos).

### 7.4 Rotar el `PUBLISH_TOKEN`

El token de servicio que cada miniapp usa para publicar. El server soporta
**dual-token** (`PUBLISH_TOKEN` + `PUBLISH_TOKENS_OLD` CSV) para rotar sin
downtime; el endpoint `POST /api/admin/reseed-secrets` (sesión admin) resiembra
el token nuevo en todos los repos del registry.
- Runbook: **[`docs/rotar-publish-token.md`](./rotar-publish-token.md)**.
- Reseed rápido (logueado en Backstage, consola del browser):
  ```js
  await fetch('/api/admin/reseed-secrets', { method: 'POST' }).then(r => r.json())
  ```
  Espera `{ reseeded: [...], failed: [...] }`. Verificá con un publish real antes
  de sacar el token viejo.
- Si el `PUBLISH_TOKEN` está marcado **Sensitive** en Vercel, su valor es
  irrecuperable → hacé la rotación directa (pisar + reseed sin publishes en el
  medio) en vez del dual-token.

### 7.5 Firma de chunks (trust bundle)

Sobre la integridad sha256, la plataforma **firma** los chunks (Ed25519) para probar
**autenticidad**, no solo integridad. Ver [API Reference](/docs/api-reference)
§5.7 y [Platform Overview](/docs/platform-overview) §6.

**Estado: live y validado en producción.** Las 3 miniapps publican firmado y verifican
contra el trust bundle root-firmado (v1); el host verifica en **warn** por default y pasa
a **enforce** vía el flag build-time `SIGNATURE_MODE` (rechazo probado end-to-end). El
runbook de abajo es el que se corrió — y el que repetís para **onboardear una miniapp
nueva** (keygen + secret + registrar pubkey + re-firmar el bundle) o **rotar** una clave.

**Runbook (alta de claves / rotación):**
1. **Generar la clave root** (una vez, en tu máquina — la privada **nunca** va a Vercel):
   ```bash
   node scripts/keygen.mjs --label root   # → { publicKey, privateKey }
   ```
   Guardá `privateKey` en un archivo local (ej. `root.key`, git-ignored). Seteá la
   pública en Vercel como `ROOT_PUBLIC_KEY` (habilita el sanity-verify del server) y
   pineala en el host.
2. **Generar y registrar la pubkey de cada miniapp:** `node scripts/keygen.mjs` por
   miniapp → privada al secret `MINIAPP_SIGN_KEY` del repo, pública registrada con
   `PUT /api/miniapps/:id/public-key` (sesión admin o maintainer).
3. **Firmar y publicar el trust bundle:**
   ```bash
   node scripts/sign-trust-bundle.mjs --base https://<tu-backstage> --key-file ./root.key
   ```
   Lee las pubkeys del catálogo, arma la tabla, la firma con el root y hace
   `PUT /api/trust-bundle`. Bumpea `version` (monotónico → anti-rollback).
4. **Republicar la(s) miniapp(s)** para que su versión servida quede firmada. El host en
   **warn** (default) la monta y, si algo no firma, lo cuenta en `/metrics`
   (`invalid-signature`/`unknown-key`) sin romper. Cuando `/metrics` está limpio, el host
   pasa a **enforce** (`SIGNATURE_MODE=enforce`, build-time → rebuild/release) y rechaza lo
   que no tenga firma válida.

### 7.6 Registry sin control de concurrencia (deuda a saldar)

El registry es un **blob único** en KV (`lib/registry/kv.ts` — `kvStore` hace
`load → modifica → save` de todo el objeto bajo una sola key, **sin CAS/lock**). Publishes
**encimados** (o publish + pin/prune concurrentes) hacen *read-modify-write* sobre el mismo
blob → se **pisan** (lost update). **Incidente real:** cards_wallet corrió 3 publishes juntos
(2026-08-31); el CI publicó el iOS de 0.1.13 y toda la 0.1.14, pero el registry perdió esos
writes → la miniapp quedó sin chunk iOS. **Workaround:** republicar 1 vez sin encimar.
**Fix de fondo (pendiente):** optimistic locking / compare-and-swap en `kvStore.save`, o
keys por-miniapp en vez de un blob único.

### 7.7 Contract package con semver real (deuda a saldar)

El gate de `/upload` usa `satisfiesShared`/`checkCompatibility` de
`@scope/miniapp-contract`. Publicá el package (§3.2) y mantené la dep de
`backstage-web` apuntando a la última (`^0.3.0`+) para que use el semver real —
si no, cae a una copia local. El build de Vercel instala el package privado, así
que el `GITHUB_TOKEN` de Vercel necesita `read:packages`.

### 7.8 Maintainers por-miniapp

Delega la gestión de una miniapp (publish/deploy/pin/borrar/maintainers) a
gente que no es platform-admin, sin ampliar `SCAFFOLD_ALLOWED_LOGINS`:

- **Dos niveles de autorización:** `SCAFFOLD_ALLOWED_LOGINS` son los
  **platform-admins** (gestionan cualquier miniapp). Cada miniapp puede además
  tener sus propios **maintainers** (logins de GitHub, campo
  `MiniappRecord.maintainers`) — gestionan **esa** miniapp. `canManageMiniapp`
  autoriza si el login está en cualquiera de los dos conjuntos (admin ∪
  maintainer).
- **Se setean desde el detalle de la miniapp en Backstage** — un control que
  solo puede tocar quien ya puede gestionar esa miniapp (admin o maintainer
  actual).
- **Seguridad — solo collaborators del repo:** no se puede poner de
  maintainer a cualquier login; tiene que ser alguien con acceso al repo de
  GitHub de esa miniapp. El control autocompleta desde
  `GET /api/miniapps/:id/collaborators` (lista los collaborators del repo) y el
  server **valida** en `PUT /api/miniapps/:id/maintainers` — rechaza con `400`
  cualquier login que no sea collaborator, y con `400` si la miniapp no tiene
  `repoUrl` todavía y la lista que mandás no está vacía.
- Una lista vacía borra los maintainers de esa miniapp (vuelve a depender
  solo de los platform-admins).

---

## 8. Referencia de variables de entorno

### Backstage (`backstage-web`, en Vercel)

| Variable | Para qué | Notas |
|---|---|---|
| `AUTH_SECRET` | Firma de sesión de Auth.js | `openssl rand -base64 32` |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub OAuth App (login) | Callback `/api/auth/callback/github` |
| `SCAFFOLD_ALLOWED_LOGINS` | CSV de logins de GitHub autorizados a **crear** miniapps y son **platform-admins** (pueden gestionar — publish/deploy/pin/borrar/maintainers — cualquier miniapp) | Vacío = nadie puede (**fail-closed**). Case-insensitive. Gestionar una miniapp puntual también lo puede un **maintainer** de esa miniapp (admin ∪ maintainer) — ver §7.8 |
| `MINIAPP_TEMPLATE_REPO` | Repo template a clonar, ej. `Acme/miniapp-template` | Debe estar marcado **"Template repository"** en GitHub |
| `GITHUB_TOKEN` | PAT del server: crear repos desde el template, admin de Actions (permisos+secrets), leer contenidos (drift), crear issues (capability requests), **borrar repos**, e instalar `@scope/miniapp-contract` en el build | Scopes (classic PAT): **`repo`** + **`workflow`** + **`delete_repo`** + **`read:packages`**. `delete_repo` habilita "borrar miniapp+repo" (Parte E). `read:packages` es obligatorio o el build de Vercel se cae al instalar el package privado |
| `PUBLISH_TOKEN` | Token de servicio que validan los endpoints `/publish` y `/upload` | Mismo valor se siembra como secret `PUBLISH_TOKEN` en cada miniapp scaffoldeada. Rotación: Parte E |
| `PUBLISH_TOKENS_OLD` | CSV de tokens de publish viejos aún aceptados durante una rotación (dual-token, cero-downtime) | Opcional; solo durante una rotación. Ver `docs/rotar-publish-token.md` |
| `BACKSTAGE_URL` | URL prod de este Backstage | Se siembra como secret en las miniapps nuevas (su CI publica de vuelta acá); también es el valor que debes pasar como `BACKSTAGE_URL` al buildear el host (§5.2) |
| `BACKSTAGE_PUBLIC_URL` | Origen base para `fsStorage` (chunks servidos por Backstage mismo, modo dev/fs) | Solo relevante si NO hay R2 ni Blob (fs, no crítico en prod) |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis — registro/catálogo + preferencia de storage provider | Provisionado vía Vercel Marketplace |
| `R2_ACCOUNT_ID` / `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_BUCKET` / `R2_PUBLIC_BASE_URL` | Cloudflare R2 — CDN de chunks (primario, recomendado), Android **e iOS** | Las 5 juntas activan R2. `R2_PUBLIC_BASE_URL` = `https://pub-xxxxx.r2.dev` (sin barra final). El chunk iOS va al subfolder `${id}/${version}/ios/`. Ver §4.3 |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob — CDN de chunks (fallback si no hay R2), Android **e iOS** | Provisionado vía Vercel Marketplace. Free tier se suspende al agotarse |
| `HOST_CONTRACT_TOKEN` | Token dedicado que valida `PUT /api/host-contract` (publicar el contrato del host) | Separado del `PUBLISH_TOKEN`. `openssl rand -hex 32`. Parte E / compat gates |
| `HOST_REPO` | Repo del host, ej. `Acme/backstagereactnative` | Destino de los capability requests (issues) cuando una miniapp pide un nativo |
| `COMPAT_ENFORCE` | `"1"` → el gate de `/upload` rechaza (422) publishes incompatibles | Ausente/`"0"` = warn (default). Solo al pasar a enforce (Parte E) |
| `CI_STATUS_ENABLED` | Habilita el badge de estado de CI por miniapp (consulta GitHub Actions) | Opcional; `"false"` fuerza `unknown` sin llamar a GitHub |
| `PRUNE_KEEP` | Cuántas versiones se retienen al prunear (además de la servida/pinneada) tras un publish | Opcional; default `5` (`lib/config.ts`) |
| `ROOT_PUBLIC_KEY` | Pubkey root (raw base64url) de la firma de chunks. Habilita el sanity-verify de `PUT /api/trust-bundle` (400 `BAD_ROOT_SIGNATURE` si la firma no cuadra) | Opcional; sin ella el server no valida (el host es la autoridad). Ver `docs/API-REFERENCE.md` §5.7 |

> **Discrepancia detectada entre las fuentes:** `DEPLOY.md` solo menciona
> `BACKSTAGE_PUBLIC_URL` en su lista de env vars de prod, pero el código real
> usa **dos variables distintas con roles distintos**: `BACKSTAGE_URL`
> (`lib/config.ts`, `lib/scaffold.ts` — sembrado en secrets de miniapps +
> usado por el `DefinePlugin` del host) y `BACKSTAGE_PUBLIC_URL`
> (`lib/storage/fs.ts` — solo el *fallback* de storage en filesystem). Si solo
> seteas `BACKSTAGE_PUBLIC_URL` como sugiere `DEPLOY.md`, el scaffolder **no
> sembrará** el secret `BACKSTAGE_URL` en las miniapps nuevas (su CI fallaría
> al publicar). Setea **ambas** en prod para evitar sorpresas; esta guía las
> lista por separado con su propósito real verificado en código.

### Host móvil (`backstagereactnative`)

| Variable | Para qué | Notas |
|---|---|---|
| `BACKSTAGE_URL` | URL de Backstage que el host consulta en runtime (`/api/resolve`) | Inyectada en build-time vía `DefinePlugin` (`__BACKSTAGE_URL__`) en `apps/host/rspack.config.mjs`; fallback `http://localhost:3999` |
| `GITHUB_TOKEN` (en CI de `backstagereactnative` / al publicar paquetes) | Publicar `@scope/miniapp-contract` y `@scope/ui-kit` a GitHub Packages | Scope `write:packages` |

### Repo de cada miniapp (Actions secrets)

| Secret | Para qué | Cómo se setea |
|---|---|---|
| `BACKSTAGE_URL` | A dónde publica su CI (`publish.mjs`) | Auto-sembrado por el scaffolder al crear el repo |
| `PUBLISH_TOKEN` | Autoriza el `POST /api/miniapps/:id/upload` | Auto-sembrado por el scaffolder al crear el repo |
| `GITHUB_TOKEN` (automático de Actions) | Instalar `@scope/*` (públicos) + abrir el PR de `template-sync.yml` | No hace falta configurarlo — lo provee Actions; requiere el permiso "create PRs" (también auto-habilitado por el scaffolder) |

---

## 9. Gotchas conocidos

| Gotcha | Detalle / fix |
|---|---|
| **JDK de Android** | Usa **OpenJDK 17** (`brew install openjdk@17`, `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`). **Azul Zulu 17** causa un `MissingValueException` en `assembleDebug` que no es de este proyecto — persiste incluso en un RN 0.76 vanilla (ver `memory-bank/operations/activation-checklist.md` en el repo móvil). |
| **`@module-federation/enhanced` pinneado a `0.9.0`** | No lo subas de versión junto con Re.Pack 5.2.5 (Module Federation v2) — combinación verificada; una versión distinta puede romper la carga de remotes. |
| **Selección de storage: R2 → Blob → fs** | El storage de chunks se elige por **presencia** de env vars, en ese orden (R2 primero si están sus 5 vars, si no Blob, si no fs local). Un admin puede overridear el default y por-miniapp desde la UI (Parte E), con fallback seguro al orden por env. KV (registro) se activa igual por presencia de `KV_REST_API_*`. |
| **R2 rechaza uploads chunked (HTTP 411)** | El adapter R2 fija `Content-Length` explícito porque el `fetch` parcheado de Next.js puede streamear el body (→ `Transfer-Encoding: chunked`) y R2 lo rechaza con 411. Ya resuelto en `lib/storage/r2.ts`; tenelo en cuenta si escribís otro adapter S3. |
| **`GITHUB_TOKEN` de Vercel: 4 scopes** | `repo` + `workflow` + `delete_repo` + `read:packages`. Faltar `read:packages` **rompe el build** (no instala el package privado); faltar `delete_repo` rompe solo "borrar repo" (403 claro). Ojo de no marcar `delete:packages` por error (no sirve). |
| **Rotar un `PUBLISH_TOKEN` marcado "Sensitive"** | Vercel no deja leer los env vars Sensitive → no podés recuperar el token viejo para el dual-token. Hacé la rotación directa (pisar + reseed, sin publishes en el medio). Ver `docs/rotar-publish-token.md`. |
| **Scope de paquetes debe ser público** | `@scope/miniapp-contract` y `@scope/ui-kit` deben quedar **públicos** en GitHub Packages; si no, el `GITHUB_TOKEN` automático de Actions en la CI de cada miniapp no podrá leerlos (fallaría el `pnpm install`). |
| **Template repo debe estar marcado "Template repository"** | Sin eso, `POST /repos/{template}/generate` del scaffolder devuelve error (`GITHUB generate failed`). |
| **`SCAFFOLD_ALLOWED_LOGINS` vacío = fail-closed** | Nadie puede crear miniapps ni disparar `deploy`/`sync-template` hasta que agregues logins. Intencional para no dejar un demo público abierto a crear repos. |
| **Puerto 3999 en dev, no 3000** | El host móvil espera Backstage en `:3999` por convención del proyecto (`PORT=3999 pnpm dev`); el callback de la OAuth App de dev debe coincidir. |
| **Build estático, no dev server, para publicar un chunk** | `pnpm bundle:android` / `bundle:ios` — el dev server de webpack (`webpack-start`) exige `?platform` en la URL y rompe la carga como remote. |
| **`useTheme must be used within a <ThemeProvider>`** | `@scope/ui-kit` no está en `shared` como `singleton` en el host **y** en la miniapp — deben coincidir exactamente (framework libs + libs con estado/contexto). |
| **`resolve` → `NO_COMPATIBLE_VERSION`** | La miniapp existe en el catálogo pero no tiene ninguna versión publicada todavía. |

---

## 10. Checklist final — "todo levantado"

- [ ] `@scope/miniapp-contract` y `@scope/ui-kit` publicados en GitHub
      Packages, visibilidad **pública**.
- [ ] Repo `miniapp-template` creado, **público**, marcado **"Template
      repository"**, con el rename de scope/owner aplicado en `package.json`,
      `rspack.config.mjs`, `.npmrc`, `ci.yml` e `init-template.yml`.
- [ ] GitHub OAuth App creada (dev y/o prod) con el callback correcto.
- [ ] Backstage enlazado a Vercel (`vercel link`), con **Cloudflare R2**
      (bucket + acceso público + token S3) y **Upstash Redis** provisionados.
      Blob opcional como fallback.
- [ ] `GITHUB_TOKEN` de Vercel con los 4 scopes: `repo`, `workflow`,
      `delete_repo`, `read:packages`.
- [ ] Todas las env vars de la tabla de Backstage (§8) seteadas en Vercel —
      incluyendo `BACKSTAGE_URL` + `BACKSTAGE_PUBLIC_URL` y las 5 `R2_*`.
- [ ] `vercel deploy --prod` exitoso; `/api/seed` corrido una vez.
- [ ] Smoke test OK: `/catalog`, `/api/resolve?id=account_dashboard`,
      `/api/miniapps/x/upload` → 401 sin token.
- [ ] Host móvil: `pnpm install` + `pnpm build:packages` sin errores.
- [ ] Host buildea/corre en Android (JDK 17, Metro en `:8081`, emulador o
      device en `adb devices`) apuntando a tu `BACKSTAGE_URL`.
- [ ] (Opcional) Host corre en iOS (`pod install` + `pnpm ios`).
- [ ] Primera miniapp creada desde `/create`, con secrets `BACKSTAGE_URL` +
      `PUBLISH_TOKEN` y el permiso de Actions "create PRs" ya seteados
      automáticamente.
- [ ] Esa miniapp publicó una versión (CI o manual) y `resolve` la devuelve.
- [ ] La miniapp se ve montada en el host (`<MiniappHost id=.../>`).

### Endurecimiento (Parte E — opcional, cuando lo necesites)
- [ ] Contract package publicado y `backstage-web` apuntando a `^0.3.0`+ (semver real).
- [ ] Gates de compatibilidad: host contract publicado, flota sincronizada +
      backfilleada, validado en sombra, y pasado a **enforce** (los 3 puntos).
      Ver [`docs/activar-compat-gates.md`](./activar-compat-gates.md).
- [ ] Selector de storage por UI verificado (default global + override por miniapp).
- [ ] Borrado de miniapp+repo verificado (con `delete_repo` en el token).
- [ ] `PUBLISH_TOKEN` rotado desde el token inicial a uno
      fuerte (`openssl rand -hex 32`). Ver [`docs/rotar-publish-token.md`](./rotar-publish-token.md).
- [ ] Firma de chunks (opcional): clave root generada + `ROOT_PUBLIC_KEY` seteada,
      pubkeys por-miniapp registradas, trust bundle publicado, flota republicada firmada,
      y host en enforce. Ver §7.5.

---

## 11. Próximos pasos

- [Compat gates](/docs/compat-gates) — el runbook completo del ítem de
  Endurecimiento de arriba: encender warn → enforce paso a paso.
- [Rotar PUBLISH_TOKEN](/docs/rotar-publish-token) — el detalle del último
  ítem del checklist, con el mecanismo dual-token para cero downtime.
- [Quickstart](/docs/quickstart) — con todo levantado, el camino más corto
  para crear y publicar tu primera miniapp real (~10 min).
- [Troubleshooting](/docs/troubleshooting) — si algún paso de este setup no
  te cerró, síntomas comunes organizados por área.
