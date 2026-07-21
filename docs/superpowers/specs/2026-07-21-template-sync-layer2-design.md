# Capa 2 — Sync de template hacia miniapps (anti-drift)

**Fecha:** 2026-07-21
**Estado:** Diseño aprobado — listo para plan de implementación
**Owner:** DentVega (usuario GitHub, no org)

---

## 1. Contexto y objetivo

Las miniapps se scaffoldean desde `DentVega/miniapp-template` y a partir de ahí
evolucionan solas (pantallas propias, deps nuevas, features). Cuando el template
cambia algo **de infraestructura o core** (bump de React Native, fix de config de
Re.Pack, versión de una librería compartida), esas miniapps quedan **congeladas**
en la versión del template al momento de crearse — *template drift*.

**Capa 1 (ya hecha)** resuelve el drift de **CI**: el build+publish vive en un
workflow reutilizable (`miniapp-template/.github/workflows/publish.yml`,
`workflow_call`) que cada miniapp referencia con un `ci.yml` caller delgado
apuntando a `@main`. Arreglar el reusable arregla el CI de todas a la vez.

**Capa 2 (este spec)** resuelve el drift de **todo lo demás** (código de config,
scaffolding, deps): propaga los cambios NO-workflow del template a las miniapps ya
scaffoldeadas — **sin romper los cambios propios de cada miniapp**.

### Objetivo medible
Poder actualizar una miniapp al estado actual del template desde Backstage, con un
click, y que el resultado:
- aplique los cambios de infra/core del template,
- **conserve** el feature del dev (pantallas, deps, customizaciones),
- pase por un **PR revisable + CI** antes de tocar `main`,
- solo genere conflicto cuando el dev *y* el template editaron la misma línea.

---

## 2. El problema técnico central

### 2.1 Archivos de tres clases, no dos

| Clase | Archivos | Manda | Estrategia |
|---|---|---|---|
| **Template-owned puro** | `babel.config.cjs`, `react-native.config.js`, `tsconfig.json`, `.npmrc`, `.gitignore`, `scripts/publish.mjs`, `.github/workflows/ci.yml`, `.github/workflows/publish.yml` | Template | Merge 3-way (el dev no los edita → normalmente fast-forward) |
| **Miniapp-owned puro** | `src/Screen.tsx`, pantallas/archivos nuevos del dev, `manifest.json`, `README.md`, `README.es.md` | Miniapp | **Ignore-list** — nunca los pisa el template |
| **Mixto** ⚠️ | `package.json`, `rspack.config.mjs`, `src/Entry.tsx` | **Ambos** | **Merge 3-way** — aplica campos del template, conserva los del dev |

El caso difícil es el **mixto**: p. ej. un bump de RN vive en
`package.json` (`devDependencies`/`peerDependencies`) y en `rspack.config.mjs`
(`shared: { 'react-native': { requiredVersion } }`), mientras que las deps que el
dev agregó (`"zod"`) viven en el mismo `package.json`. Un overwrite ciego rompería
el feature. La solución es **merge, no copy**.

### 2.2 La historia rota (ancestry)

`gh repo create --template` y la API `/generate` crean el repo con un *"Initial
commit"* fresco: **sin ancestro git compartido** con el template. Sin merge-base,
`git merge` trataría cada archivo mixto como conflicto total, aunque el template no
lo tocó.

**Solución — marca de base explícita.** Cada miniapp guarda `.template-sync`:

```json
{ "templateRepo": "DentVega/miniapp-template", "baseSha": "<sha>" }
```

`baseSha` = el commit del template del que salió (o del último sync mergeado). Con
ese ancestro explícito, el merge 3-way es determinista aunque las historias no
compartan raíz.

---

## 3. Diseño

### 3.1 Motor de merge — `template-sync.yml`

Un workflow que vive en cada miniapp (heredado del template), `workflow_dispatch`
únicamente (no corre solo). Algoritmo:

1. `checkout` de la miniapp (`main`), fetch profundo.
2. Agregar el template como remote y `git fetch template main` (trae la historia
   completa, incluido `baseSha`).
3. `BASE=$(jq -r .baseSha .template-sync)`; `TEMPLATE_HEAD=$(git rev-parse template/main)`.
4. **No-op si `TEMPLATE_HEAD == BASE`** → nada nuevo → sale limpio, sin PR.
5. Merge 3-way con base explícita:
   `git merge-tree --write-tree --merge-base=$BASE HEAD $TEMPLATE_HEAD`
   (git ≥ 2.38, presente en `ubuntu-latest`). Produce el árbol mergeado; los
   archivos en conflicto llevan marcadores `<<<<<<<`.
6. **Aplicar ignore-list:** para cada ruta en `.templatesyncignore`, restaurar la
   versión de la miniapp (`ours`) sobre el árbol mergeado.
7. **Bump del marcador:** escribir `.template-sync` con `baseSha = TEMPLATE_HEAD`.
8. Commit del árbol en una rama `sync/template-<shortsha>`; `git push`.
9. Abrir PR con `gh pr create` (título: *"Sync desde template @ &lt;shortsha&gt;"*,
   cuerpo: lista de archivos tocados + checklist + aviso si hubo conflictos).

Permisos: `contents: write` + `pull-requests: write`. Usa el `GITHUB_TOKEN`
automático — **sin secrets nuevos**. El template es público → fetch sin auth.

Al mergear el PR, `main` ya trae `.template-sync` con el nuevo `baseSha` → el
próximo sync es incremental.

### 3.2 `.templatesyncignore` (raíz de la miniapp, heredado del template)

```
# Nunca los pisa el template (100% miniapp-owned):
src/Screen.tsx        # feature del dev (el template solo tiene placeholder)
manifest.json         # id / version / capabilities — por-miniapp
README.md
README.es.md
.template-sync        # lo maneja el workflow, no el merge
```

Todo lo demás entra al merge 3-way. Los archivos nuevos del dev (que no existen en
el template) el merge no los toca.

### 3.3 Botón + ruta en Backstage

Reusa el patrón exacto del botón **Deploy** (que hace `dispatchWorkflow` de
`ci.yml`). Sin cambios en `GitProvider`.

- **UI** (`app/miniapp/[id]/page.tsx`): botón **"Actualizar desde template"** junto
  a Deploy, gated por `canScaffold` (sesión allowlisted). Al click → toast
  *"Sync disparado — revisa el PR"* con link a `…/actions`.
- **Ruta** (`app/api/miniapps/[id]/sync-template/route.ts`): clon casi literal de
  `deploy/route.ts`:
  - auth de sesión (`canScaffold` → `ScaffoldForbiddenError` 403),
  - `getMiniappDetail` → `parseRepo(detail.repoUrl)` (400 si inválido, 404 si no
    existe),
  - `dispatchWorkflow({ owner, repo, workflow: "template-sync.yml", ref: "main" })`,
  - responde `202 { dispatched: true, actionsUrl }`.
  - *Refactor sugerido:* extraer el bloque común (auth + detail + parseRepo +
    dispatch) que hoy repiten `deploy` y este, a un helper `dispatchMiniappWorkflow`.

### 3.4 Activación

**Scaffolds nuevos (automático):** agregar `template-sync.yml` +
`.templatesyncignore` al template. `init-template.yml` (que ya corre y commitea en
cada scaffold fresco) además escribe `.template-sync` con
`baseSha = HEAD del template` (lo resuelve vía API:
`GET /repos/DentVega/miniapp-template/commits/main` con el `GITHUB_TOKEN`). Toda
miniapp nueva nace enrolada.

**Repos existentes (backfill una vez, headless con `gh`):** `hello_widget` y
`cards_wallet` ya están **al día** con el template → su `baseSha` = HEAD actual del
template (`d5cc652…` hoy). Para cada uno:
- copiar `template-sync.yml` + `.templatesyncignore`,
- escribir `.template-sync` con el SHA de hoy,
- commit + push.

`account-dashboard` **queda fuera** (fue migrada, no salió del template → linaje
distinto). Se anota como deuda aparte.

---

## 4. Componentes y responsabilidades

| Unidad | Repo | Qué hace | Depende de |
|---|---|---|---|
| `template-sync.yml` | miniapp-template (→ heredado) | motor de merge 3-way + PR | `.template-sync`, `.templatesyncignore`, `GITHUB_TOKEN`, git ≥2.38, `gh` |
| `.templatesyncignore` | miniapp-template (→ heredado) | lista de archivos miniapp-owned | — |
| `.template-sync` | cada miniapp | marca de base (`baseSha`) | escrito por init/backfill; actualizado por el workflow |
| `init-template.yml` (edición) | miniapp-template | además escribe `.template-sync` en scaffolds nuevos | API del template, `GITHUB_TOKEN` |
| `sync-template/route.ts` | backstage-web | dispara el workflow (dispatch) | auth de sesión, `dispatchWorkflow`, `parseRepo` |
| Botón UI | backstage-web | trigger + toast | `canScaffold` |
| Backfill script | headless (`gh`) | enrola hello_widget + cards_wallet | `gh` |

---

## 5. Flujo de datos

```
Backstage: [Actualizar desde template]
  → POST /api/miniapps/:id/sync-template (auth sesión)
  → dispatchWorkflow(template-sync.yml @ main)
  → CI de la miniapp:
       fetch template → merge-tree(base=baseSha, HEAD, template/main)
       → aplica ignore-list → bump .template-sync → rama sync/… → PR
  → Dev revisa el PR (diff + CI verde) → merge → main actualizado
```

---

## 6. Manejo de errores y edge cases

- **Template sin cambios** (`TEMPLATE_HEAD == BASE`): no-op, sin PR, log claro.
- **Conflictos de merge**: el PR se abre **con** marcadores de conflicto; el CI del
  PR falla → señal visible. El cuerpo del PR lista los archivos en conflicto y pide
  resolución manual. Nunca se mergea solo.
- **Archivo ignore-listed cambiado en el template**: gana la miniapp (ignorado),
  sin ruido en el PR.
- **`.template-sync` ausente** (repo no enrolado): el workflow falla rápido con
  mensaje que apunta al backfill.
- **PR de sync ya abierto**: reusar/actualizar la rama `sync/template-*` (o abrir
  uno nuevo con sufijo de sha); no duplicar ciegamente.
- **Dispatch sin permiso** (token de Backstage sin acceso): 502/403 propagado por
  `dispatchWorkflow` (mismo comportamiento que Deploy).

---

## 7. Testing

- **Ruta `sync-template`**: test unitario espejo de `deploy-route.test.ts` — verifica
  (a) gate de auth (403 sin sesión allowlisted), (b) `parseRepo` inválido → 400,
  (c) miniapp inexistente → 404, (d) dispatch con `workflow: "template-sync.yml"`.
- **Motor de merge**: check de integración con un dry-run local contra un clon de
  `cards_wallet`: introducir un cambio ficticio en un template de prueba (bump de una
  dep + edición de un archivo mixto), correr la lógica de merge, y **asertar**:
  `src/Screen.tsx` intacto, dep del dev conservada en `package.json`, cambio de
  template aplicado, `.template-sync` bumpeado.
- **No-op**: correr el workflow sin cambios en el template → 0 PRs.

---

## 8. Fuera de alcance (YAGNI)

- Sync automático por schedule o fan-out desde el template (se eligió trigger
  on-demand por botón; los otros quedan como evolución futura, mismo motor).
- Auto-merge del PR (siempre revisión humana).
- Enrolar `account-dashboard` (linaje distinto).
- Detección/badge de "drift disponible" en la UI (futuro: comparar `baseSha` vs HEAD
  del template y mostrar indicador).
- Firma/verificación del template.

---

## 9. Orden de implementación

1. **Template**: `template-sync.yml` + `.templatesyncignore` + editar
   `init-template.yml` para escribir `.template-sync`. Commit + push.
2. **Backfill**: enrolar `hello_widget` y `cards_wallet` (headless `gh`).
3. **Backstage**: ruta `sync-template` (+ helper compartido con deploy) + botón UI +
   test. Commit + push → redeploy Vercel.
4. **Verificación end-to-end**: introducir un cambio de infra en el template (p. ej.
   un comentario/bump menor), click en el botón para una miniapp, revisar que el PR
   se abre correcto (feature intacto), mergear, y confirmar que sigue montando en el
   emulador.
