# Bootstrap de adopción — templatear la plataforma para una empresa nueva

**Fecha:** 2026-07-23
**Estado:** Diseño aprobado — listo para plan de implementación
**Owner:** DentVega

## 1. Contexto y objetivo

Una empresa nueva debe poder adoptar toda la plataforma "Spotify-for-miniapps"
(`backstage-web`, `backstagereactnative`, `miniapp-template`) copiándola vía
**GitHub template repos** y renombrando el scope npm + owner GitHub con **un
comando**, en vez del rename manual (grep/sed) que hoy documenta `SETUP.md §3.1`.

**Restricción dura (verificada en análisis de riesgo):** aditivo. Los repos
vivos **siguen literales** (`@dentvega`, `DentVega`) — no se placeholder-izan
(rompería el build). El bootstrap hace find-replace literal sobre la **copia**
de la empresa. Marcar "Template repository" es un toggle de settings sin impacto
runtime. Los repos ya son públicos y no tienen secretos committeados (historial
limpio), así que templatear no agrega exposición.

## 2. Alcance del rename (inventario verificado)

Tres literales, reemplazo **case-sensitive**:

| Literal | Reemplazo | Ocurrencias (bw / host / template) | Obligatorio |
|---|---|---|---|
| `@dentvega` (scope npm) | `--scope` (ej. `@acme`) | 23 / 51 / 10 | **Sí** (imports/deps reales) |
| `DentVega` (owner GitHub) | `--owner` (ej. `Acme`) | 74 / 29 / 12 | **Sí** (URLs, `uses:`, API) |
| `dentvega` (login minúscula, suelto) | `--login` (default: `owner` en minúscula) | 5 / 0 / 0 | Opcional (fixtures de test en backstage-web) |

No hay otros usos de `dentvega` fuera de esas tres formas.

## 3. El script `scripts/bootstrap.mjs`

Zero-dep, ESM, **idéntico en los 3 repos** (viaja con cada template). Node ≥18.

### 3.1 CLI

```
node scripts/bootstrap.mjs --scope @acme --owner Acme [--login acme] [--yes] [--force]
```
- `--scope <@x>` (**requerido**): nuevo scope npm; **debe empezar con `@`**.
- `--owner <X>` (**requerido**): nuevo owner GitHub.
- `--login <x>` (opcional): default = `owner.toLowerCase()`.
- `--yes`: **único flag que escribe** a disco. Sin él, el script SIEMPRE
  previsualiza (dry-run) y no toca nada. `--dry-run` se acepta como no-op
  explícito (es el comportamiento por defecto).
- `--force`: salta el origin-guard (§3.4). Solo tiene efecto junto con `--yes`.

Sin `--scope`/`--owner`, o con `--scope` que no empiece con `@`: imprime uso y
sale con código 1.

### 3.2 Reemplazo — orden importa

La función pura `renameContent(text, { scope, owner, login })` aplica, **en este
orden** (crítico para no corromperse, porque `@dentvega` contiene `dentvega` y
`DentVega` no):

1. `text.replaceAll("@dentvega", scope)`
2. `.replaceAll("DentVega", owner)`
3. `.replaceAll("dentvega", login)`

Tras los pasos 1–2, el único `dentvega` restante es el login suelto (minúscula),
así que el paso 3 no toca ni el scope ni el owner ya reemplazados. Devuelve el
texto nuevo (o el mismo texto si no hubo cambios).

### 3.3 Selección de archivos

Walk recursivo desde la raíz del repo:
- **Incluye** archivos cuya extensión ∈ `{json, ts, tsx, mjs, js, jsx, yml, yaml, md}` **o** cuyo basename sea `.npmrc`.
- **Excluye directorios:** `node_modules`, `.git`, `build`, `dist`, `.next`, `coverage`, `@mf-types`, `ios/Pods`, `android/.gradle`, `android/build`.
- **Excluye archivos:** `pnpm-lock.yaml`, `package-lock.json`, `yarn.lock` (se regeneran con `pnpm install` — reemplazar sus hashes de integridad rompería la instalación).
- Lee cada archivo como UTF-8; si `renameContent` cambia algo, lo cuenta (dry-run) o lo escribe (`--yes`).

### 3.4 Guardas de seguridad

- **Origin-guard:** `isOriginRepo(remoteUrl)` devuelve `true` si el `git remote
  get-url origin` matchea `github.com[:/]DentVega/` (case-insensitive). Si es el
  repo origen y NO hay `--force`, el script **rehúsa escribir** (imprime aviso y
  sale 1). El **dry-run igual corre** (para previsualizar sin riesgo). Si no hay
  remote (repo copiado sin origin), no bloquea.
- **Dry-run por defecto:** sin `--yes`, solo imprime un resumen (archivos que
  cambiarían + conteo de ocurrencias por literal) y termina 0.
- El script nunca toca `.git`, lockfiles, ni binarios.

### 3.5 Salida

- **Dry-run:** tabla `archivo → #ocurrencias` + totales por literal, y la nota
  "dry-run: nada escrito. Corré con --yes para aplicar."
- **`--yes`:** lista de archivos modificados + totales, y el recordatorio final:
  "Hecho. Ahora corré `pnpm install` para regenerar el lockfile, y revisá
  `SETUP.md` desde §3.2."

## 4. Otros entregables

- **Template repos:** marcar los 3 como template — `gh api -X PATCH
  repos/DentVega/<repo> --field is_template=true` (o Settings → "Template
  repository"). Toggle de settings; no cambia código/CI/deploys/visibilidad.
- **Hardening `.gitignore` (backstagereactnative):** agregar `.env*` (hoy no
  tiene patrón de env; sin fuga actual, pero previene que una empresa nueva
  committee un `.env.local` con secretos). No aplica a `backstage-web` (ya tiene
  `.env*`) ni a `miniapp-template`.
- **`SETUP.md §3.1`:** reemplazar el bloque de rename manual (grep/sed) por las
  instrucciones de `bootstrap.mjs` (dry-run → `--yes` → `pnpm install`), en cada
  uno de los 3 repos.

## 5. Estructura de archivos

Por cada repo (`backstage-web`, `backstagereactnative`, `miniapp-template`):
- `scripts/bootstrap.mjs` (crear): CLI + walk + IO. Importa las funciones puras.
- `scripts/bootstrap-lib.mjs` (crear): funciones puras exportadas
  `renameContent(text, {scope, owner, login})`, `isOriginRepo(remoteUrl)`,
  `shouldProcessFile(relPath)` — sin IO, testeable.
- `scripts/bootstrap.test.mjs` (crear): tests `node:test` de las funciones puras.

(El script es idéntico en los 3 repos; se escribe una vez y se copia.)

## 6. Testing

- **`renameContent`:**
  - `import '@dentvega/ui-kit'` → `import '@acme/ui-kit'`
  - `github.com/DentVega/miniapp-template` → `github.com/Acme/miniapp-template`
  - `uses: DentVega/miniapp-template/.github/workflows/publish.yml@main` → `uses: Acme/...`
  - `const ADMIN = "dentvega"` → `const ADMIN = "acme"` (login)
  - **orden/no-corrupción:** un texto con las tres formas juntas produce exactamente scope+owner+login, sin residuos ni doble-reemplazo.
  - texto sin ninguna forma → devuelto sin cambios.
- **`isOriginRepo`:** `https://github.com/DentVega/backstage-web.git` → true; `git@github.com:DentVega/x.git` → true; `https://github.com/Acme/backstage-web` → false; `""`/undefined → false.
- **`shouldProcessFile`:** `package.json`/`x.ts`/`.npmrc` → true; `pnpm-lock.yaml`/`node_modules/x.js`/`x.png` → false.
- **Self-test dry-run (integración):** correr `node scripts/bootstrap.mjs
  --scope @acme --owner Acme` (sin `--yes`) en nuestro propio repo → NO escribe
  (dry-run), y el conteo de ocurrencias coincide con el inventario del §2 de ese
  repo. Confirmar que un intento con `--yes` (sin `--force`) es **bloqueado** por
  el origin-guard.

## 7. Rollout

1. Escribir `bootstrap-lib.mjs` + `bootstrap.test.mjs` + `bootstrap.mjs` en
   `backstage-web`; correr los tests (`node --test`) + el self-test dry-run;
   commit + push.
2. Copiar los 3 archivos idénticos a `backstagereactnative` y `miniapp-template`;
   correr tests + dry-run self-test en cada uno; commit + push.
3. `.gitignore` de `backstagereactnative`: agregar `.env*`; commit + push.
4. `SETUP.md §3.1`: reescribir a "corré bootstrap"; commit + push.
5. Marcar los 3 repos como template (`gh api PATCH is_template=true`); verificar
   `isTemplate=true`.

## 8. Fuera de alcance (YAGNI)

- Init-workflow automático (se eligió manual; queda como evolución futura).
- Renombrar los nombres de repo (`backstage-web`, etc.) — decisión de la empresa
  en GitHub, no contenido de código.
- Sustituir env vars / valores de deploy (son de Vercel, no del repo).
- Un `create-*` CLI publicado en npm (el script per-repo alcanza).
