# Guía: crear, publicar y usar una miniapp

> Ciclo de vida completo de una miniapp federada: **crear** el repo desde
> Backstage → **publicar** una versión (su chunk) → **usarla** montada en el host
> móvil. Refleja el flujo real y verificado end-to-end.

## Panorama — 3 planos

```
Backstage (web, control-plane)        Repos de miniapp            Host móvil (RN + Re.Pack)
  - Registry (catálogo)                 - código + ./Entry          - resuelve por id
  - Scaffolder (crear repo)             - CI: build → publish        - descarga el chunk
  - Distribution API (/resolve)                                      - monta <MiniappHost/>
```

El único acoplamiento web↔móvil es el contrato versionado `@org/miniapp-contract`.

---

## Prerrequisitos (configurar una vez, en `backstage-web/.env.local`)

| Variable | Para qué | Nota |
|---|---|---|
| `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` | Login GitHub (OAuth App) | Callback: `http://localhost:3999/api/auth/callback/github` |
| `SCAFFOLD_ALLOWED_LOGINS` | Quién puede crear (CSV, case-insensitive) | Vacío = nadie (fail-closed). Ej. `DentVega` |
| `GITHUB_TOKEN` | Crear repos desde el template | PAT classic con scope `repo` |
| `MINIAPP_TEMPLATE_REPO` | Repo template a clonar | Debe estar marcado **"Template repository"** en GitHub |
| `PUBLISH_TOKEN` | Publicar desde CI | Solo para el flujo CI (la UI usa la sesión) |
| `BLOB_READ_WRITE_TOKEN`, `KV/Upstash` | Storage de prod | En dev cae a fs (`public/chunks`) + `data/registry.json` |

Dev server de Backstage: `pnpm exec next dev -p 3999` (el host espera `:3999`).

---

## 1. Crear una miniapp

Crea el **repo** (desde el template) y lo **registra** en el catálogo (aún sin versiones).

**Desde la UI:**
1. Logueado, abre **`http://localhost:3999/create`**.
2. Rellena **id** (minúsculas + guion bajo, ej. `cards_wallet`), **name**, **owner** (tu cuenta/org de GitHub).
3. Enviar → crea `github.com/<owner>/miniapp-<id>` (privado) y lo registra.

**Desde la API** (equivalente):
```bash
curl -X POST http://localhost:3999/api/scaffold \
  -H "content-type: application/json" -b <cookie-de-sesión> \
  -d '{"id":"cards_wallet","name":"Cards Wallet","owner":"DentVega"}'
```

Resultado: la miniapp aparece en el catálogo; `GET /api/resolve?id=<id>` responde
`NO_COMPATIBLE_VERSION` hasta publicar una versión.

---

## 2. Publicar una versión

### 2a. Preparar el chunk (en el repo de la miniapp)

- Exponer `./Entry` (firma `MiniappEntryProps`: recibe `{ capabilities }`).
- En `rspack.config.mjs`, la lista `shared` **debe coincidir con la del host** — todos
  `singleton`, incluyendo libs con estado/contexto:
  ```js
  shared: {
    react:                   { singleton: true, eager: false, requiredVersion: '18.3.1' },
    'react-native':          { singleton: true, eager: false, requiredVersion: '0.76.6' },
    '@tanstack/react-query': { singleton: true, requiredVersion: '^5.0.0' },
    '@shopify/flash-list':   { singleton: true, requiredVersion: '^1.7.0' },
    '@org/ui-kit':           { singleton: true, eager: false, requiredVersion: '^0.1.0' },
  }
  ```
- **Build estático** (no el dev server webpack-start, que exige `?platform` y rompe la
  carga como remote):
  ```bash
  pnpm bundle:android    # → build/generated/android/<id>.container.js.bundle + chunks
  ```
- Empaquetar los chunks en un zip (el contenedor y los sub-chunks al **raíz** del zip):
  ```bash
  cd build/generated/android && zip -q /tmp/<id>.zip *.bundle
  ```

### 2b. Publicar (dos caminos)

**Desde la UI** (recomendado para probar):
1. Abre **`http://localhost:3999/miniapp/<id>`** (logueado y en el allowlist).
2. Sección **"Publicar versión"** → **versión** (ej. `0.1.0`), **build (.zip)**, **capabilities** (CSV opcional).
3. Publicar. El server guarda los chunks y arma el manifest por defecto (entry `./Entry`,
   shared del host). No hace falta escribir JSON.

**Desde CI** (automatizable):
```bash
curl -X POST http://localhost:3999/api/miniapps/<id>/upload \
  -H "Authorization: Bearer $PUBLISH_TOKEN" \
  -F "version=0.1.0" -F "capabilities=accounts:read" \
  -F "file=@/tmp/<id>.zip;type=application/zip"
# (opcional) -F 'manifest={...}'  para un manifest explícito
```

Storage: **dev** → servido por Backstage en `/chunks/<id>/<version>/…`; **prod** → Vercel Blob.

**Verificar:**
```bash
curl "http://localhost:3999/api/resolve?id=<id>"   # → { url, manifest } de la versión más alta
```

> Publicar una **nueva versión** de una miniapp ya listada la actualiza **sin recompilar
> el host**: `resolve` devuelve la versión más alta compatible y el host la monta.

---

## 3. Usar la miniapp publicada (en el host)

Montar una miniapp = renderizar `<MiniappHost id=... />` **donde quieras** (tab, sección,
modal, inline). El loader es genérico: sirve para cualquier `id` registrado, sin tocar
`rspack.config` por miniapp.

```tsx
import {MiniappHost, createScopedGrant, httpResolveClient} from '@org/host-runtime';
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

**En dev**, para que el dispositivo alcance el chunk servido por Backstage:
```bash
adb reverse tcp:3999 tcp:3999   # backstage (/resolve + /chunks)
adb reverse tcp:8081 tcp:8081   # metro del host
```
**En prod**, el chunk vive en una URL pública de Blob/CDN → sin `adb reverse`.

**Capabilities:** la miniapp hace gating por su permiso (ej. `accounts:read`). Sin el
grant correcto muestra su pantalla de acceso denegado; con él, renderiza. El host nunca
expone credenciales, solo el grant scoped y revocable.

> Guía detallada del lado host (montar en cualquier lugar + troubleshooting):
> `docs/mounting-miniapps.md` en el repo del host.

---

## Troubleshooting

| Síntoma | Causa / fix |
|---|---|
| Crear falla con `FORBIDDEN` | Tu login no está en `SCAFFOLD_ALLOWED_LOGINS`. |
| Crear falla con `GITHUB generate failed` | El template no está marcado como "Template repository", o `GITHUB_TOKEN` sin scope `repo`. |
| `resolve` → `NO_COMPATIBLE_VERSION` | La miniapp existe pero no tiene versión publicada. |
| Publicar falla `401` | Ni sesión autorizada ni `PUBLISH_TOKEN` válido. |
| La miniapp muestra "Acceso no autorizado" | Falta la capability requerida — inyecta el grant (ej. login → `accounts:read`). |
| `useTheme must be used within a <ThemeProvider>` | `@org/ui-kit` no está en `shared` singleton (host **y** miniapp). |
| El chunk da 404 en el device | Falta `adb reverse tcp:3999` (dev), o el zip no tenía el contenedor al raíz. |
