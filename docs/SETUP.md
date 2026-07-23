# Levantar la plataforma en una empresa nueva

> Guía única para poner en marcha, **desde cero**, todo el ecosistema
> "Spotify-for-miniapps": el control-plane web (**Backstage**, este repo) y el
> host móvil (**backstagereactnative**, React Native + Re.Pack). Consolida y
> referencia los docs existentes en vez de duplicarlos — léelos si necesitas el
> detalle fino de cada pieza:
>
> - [`DEPLOY.md`](../DEPLOY.md) — deploy de Backstage a Vercel.
> - [`docs/miniapps-guide.md`](./miniapps-guide.md) — ciclo de vida completo de una miniapp (crear → publicar → montar).
> - [`README.md`](../README.md) (este repo) y el `README.md` de `backstagereactnative` — arquitectura y stack.
> - `backstagereactnative/packages/PUBLISHING.md` — publicar los paquetes `@scope/*` a GitHub Packages.
> - `backstagereactnative/docs/mounting-miniapps.md` — montar una miniapp en cualquier punto del host.
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
java -version        # ver §7 — necesitas OpenJDK 17 para Android, NO Zulu
```
- **Android**: Android Studio + SDK, un emulador o dispositivo físico
  (`adb devices` debe listarlo), y **OpenJDK 17** (no Zulu — ver
  [Gotchas](#7-gotchas-conocidos)).
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
- **Authorization callback URL**: `http://localhost:3999/api/auth/callback/github` (dev) — nota: el repo usa el puerto **3999** en dev, no el 3000 por defecto de Next, porque el host móvil espera Backstage en `:3999`. Corre el dev server con `PORT=3999 pnpm dev` (o `pnpm exec next dev -p 3999`).
- Para prod: `https://<tu-proyecto>.vercel.app/api/auth/callback/github`.

### 4.3 Provisionar servicios en Vercel

```bash
vercel link                # desde backstage-web/
```
Desde el Dashboard de Vercel → Storage, añade (Marketplace):
- **Vercel Blob** → setea `BLOB_READ_WRITE_TOKEN` automáticamente.
- **Upstash Redis** (Marketplace) → setea `KV_REST_API_URL` + `KV_REST_API_TOKEN` automáticamente.

La selección de storage es **automática por env** — no hay flag manual:
- `getStore()` (registro/catálogo): **Upstash KV** si están `KV_REST_API_URL` +
  `KV_REST_API_TOKEN`; si no, `jsonStore` (fs, dev) sobre `data/registry.json`.
- `getStorage()` (chunks): **Vercel Blob** si está `BLOB_READ_WRITE_TOKEN`; si
  no, `fsStorage` (fs, dev) sirviendo desde `public/chunks/`.

### 4.4 Variables de entorno de Backstage

```bash
vercel env add AUTH_SECRET
vercel env add AUTH_GITHUB_ID
vercel env add AUTH_GITHUB_SECRET
vercel env add SCAFFOLD_ALLOWED_LOGINS
vercel env add MINIAPP_TEMPLATE_REPO
vercel env add GITHUB_TOKEN
vercel env add PUBLISH_TOKEN
vercel env add BACKSTAGE_URL
vercel env add BACKSTAGE_PUBLIC_URL   # opcional en prod — ver tabla de referencia (§6)
vercel env add CI_STATUS_ENABLED      # opcional
```
Ver la tabla completa (nombre, propósito, notas) en **§6 — Referencia de
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
# JDK 17 — ver Gotchas (§7): usa OpenJDK, NO Azul Zulu
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

```bash
cd apps/host/ios
pod install          # requiere un Ruby con CocoaPods (2.7.6 o 3.3.5)
cd ..
pnpm ios
```

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
reutilizable): construye el chunk estático, lo empaqueta y publica a
Backstage con `PUBLISH_TOKEN`. El script `scripts/publish.mjs` lee la
`latestVersion` del registro y **auto-bump-ea** el patch siguiente — evita el
409 al reintentar un deploy sin cambiar la versión a mano.

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
curl "https://<tu-proyecto>.vercel.app/api/resolve?id=<id>"   # → {url, manifest}
```

### 6.3 Verla montada en el host

Con el host apuntando a tu Backstage (§5.2) y la miniapp publicada, móntala
con `<MiniappHost id="<id>" .../>` (§5.5). En dev con dispositivo físico,
recuerda `adb reverse tcp:3999 tcp:3999` para que el device llegue a tu
Backstage local; en prod, el chunk vive en una URL pública (Blob/CDN), sin
`adb reverse`.

---

## 7. Referencia de variables de entorno

### Backstage (`backstage-web`, en Vercel)

| Variable | Para qué | Notas |
|---|---|---|
| `AUTH_SECRET` | Firma de sesión de Auth.js | `openssl rand -base64 32` |
| `AUTH_GITHUB_ID` / `AUTH_GITHUB_SECRET` | GitHub OAuth App (login) | Callback `/api/auth/callback/github` |
| `SCAFFOLD_ALLOWED_LOGINS` | CSV de logins de GitHub autorizados a crear miniapps y a disparar deploy/sync-template | Vacío = nadie puede (**fail-closed**). Case-insensitive |
| `MINIAPP_TEMPLATE_REPO` | Repo template a clonar, ej. `Acme/miniapp-template` | Debe estar marcado **"Template repository"** en GitHub |
| `GITHUB_TOKEN` | PAT para crear repos desde el template + admin de Actions (permisos y secrets) del repo generado | Scope `repo` (classic PAT); si el mismo token también instala `@scope/miniapp-contract` en el build, súmale `read:packages` |
| `PUBLISH_TOKEN` | Token de servicio que validan los endpoints `/publish` y `/upload` | Mismo valor se siembra como secret `PUBLISH_TOKEN` en cada miniapp scaffoldeada |
| `BACKSTAGE_URL` | URL prod de este Backstage | Se siembra como secret en las miniapps nuevas (su CI publica de vuelta acá); también es el valor que debes pasar como `BACKSTAGE_URL` al buildear el host (§5.2) |
| `BACKSTAGE_PUBLIC_URL` | Origen base para `fsStorage` (chunks servidos por Backstage mismo, modo dev/fs) | Solo relevante si NO hay `BLOB_READ_WRITE_TOKEN` (fs, no crítico en prod con Blob real) — ver discrepancia abajo |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Upstash Redis — registro/catálogo en prod | Provisionado vía Vercel Marketplace |
| `BLOB_READ_WRITE_TOKEN` | Vercel Blob — CDN de chunks en prod | Provisionado vía Vercel Marketplace |
| `CI_STATUS_ENABLED` | Habilita el badge de estado de CI por miniapp (consulta GitHub Actions) | Opcional; `"false"` fuerza `unknown` sin llamar a GitHub |

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

## 8. Gotchas conocidos

| Gotcha | Detalle / fix |
|---|---|
| **JDK de Android** | Usa **OpenJDK 17** (`brew install openjdk@17`, `JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home`). **Azul Zulu 17** causa un `MissingValueException` en `assembleDebug` que no es de este proyecto — persiste incluso en un RN 0.76 vanilla (ver `memory-bank/operations/activation-checklist.md` en el repo móvil). |
| **`@module-federation/enhanced` pinneado a `0.9.0`** | No lo subas de versión junto con Re.Pack 5.2.5 (Module Federation v2) — combinación verificada; una versión distinta puede romper la carga de remotes. |
| **Selección de storage por env, sin flag manual** | KV/Blob se activan solo por la **presencia** de sus env vars; en local sin esas vars cae a `jsonStore`/`fsStorage` automáticamente — no necesitas "modo dev" explícito. |
| **Scope de paquetes debe ser público** | `@scope/miniapp-contract` y `@scope/ui-kit` deben quedar **públicos** en GitHub Packages; si no, el `GITHUB_TOKEN` automático de Actions en la CI de cada miniapp no podrá leerlos (fallaría el `pnpm install`). |
| **Template repo debe estar marcado "Template repository"** | Sin eso, `POST /repos/{template}/generate` del scaffolder devuelve error (`GITHUB generate failed`). |
| **`SCAFFOLD_ALLOWED_LOGINS` vacío = fail-closed** | Nadie puede crear miniapps ni disparar `deploy`/`sync-template` hasta que agregues logins. Intencional para no dejar un demo público abierto a crear repos. |
| **Puerto 3999 en dev, no 3000** | El host móvil espera Backstage en `:3999` por convención del proyecto (`PORT=3999 pnpm dev`); el callback de la OAuth App de dev debe coincidir. |
| **Build estático, no dev server, para publicar un chunk** | `pnpm bundle:android` / `bundle:ios` — el dev server de webpack (`webpack-start`) exige `?platform` en la URL y rompe la carga como remote. |
| **`useTheme must be used within a <ThemeProvider>`** | `@scope/ui-kit` no está en `shared` como `singleton` en el host **y** en la miniapp — deben coincidir exactamente (framework libs + libs con estado/contexto). |
| **`resolve` → `NO_COMPATIBLE_VERSION`** | La miniapp existe en el catálogo pero no tiene ninguna versión publicada todavía. |

---

## 9. Checklist final — "todo levantado"

- [ ] `@scope/miniapp-contract` y `@scope/ui-kit` publicados en GitHub
      Packages, visibilidad **pública**.
- [ ] Repo `miniapp-template` creado, **público**, marcado **"Template
      repository"**, con el rename de scope/owner aplicado en `package.json`,
      `rspack.config.mjs`, `.npmrc`, `ci.yml` e `init-template.yml`.
- [ ] GitHub OAuth App creada (dev y/o prod) con el callback correcto.
- [ ] Backstage enlazado a Vercel (`vercel link`), con Blob + Upstash Redis
      provisionados desde Marketplace.
- [ ] Todas las env vars de la tabla de Backstage (§6) seteadas en Vercel —
      incluyendo **ambas** `BACKSTAGE_URL` y `BACKSTAGE_PUBLIC_URL`.
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
