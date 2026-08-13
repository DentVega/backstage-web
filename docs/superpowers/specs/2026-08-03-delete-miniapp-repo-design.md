# Eliminar miniapp + repo desde Backstage — Diseño

**Fecha:** 2026-08-03
**Estado:** Diseño aprobado — listo para plan de implementación
**Owner:** <owner>

## 1. Contexto y objetivo

Hoy `DELETE /api/miniapps/:id` borra solo la entrada del registry (admin, `canScaffold`);
el repo de GitHub se borra a mano (el token del server no tenía `delete_repo`). Esta
feature agrega, desde la UI de Backstage, **eliminar una miniapp y opcionalmente su repo
de GitHub** en un solo flujo, con confirmación fuerte (es irreversible).

## 2. Decisiones tomadas

1. **Borrado del repo = opt-in con checkbox (default ON).** La acción "Eliminar miniapp"
   ofrece un checkbox "también borrar el repositorio de GitHub", marcado por defecto. Se
   puede desmarcar para solo des-listar del catálogo y conservar el repo. El endpoint sin
   el flag mantiene el comportamiento actual (solo registry).
2. **Confirmación tipeando el id.** El botón se habilita solo cuando el user tipea el id
   exacto de la miniapp (estándar para acciones destructivas irreversibles).
3. **Orden repo→registry, fail-safe.** Se borra primero el repo (op externa riesgosa) y
   recién después la entrada del registry; si el repo no se puede borrar (ej. token sin
   scope), se **aborta sin tocar el registry** — nunca queda el catálogo sin entrada y el
   repo vivo por un fallo.

## 3. Componentes

### 3.1 `GitProvider.deleteRepo` — `lib/git/{types,github,mock}.ts`
```ts
// types.ts — sumar al interface GitProvider:
deleteRepo(input: { owner: string; repo: string }): Promise<{ deleted: boolean }>;
```
**github.ts:** `DELETE https://api.github.com/repos/{owner}/{repo}` con los headers de auth
(`Authorization: Bearer <token>`, `Accept: application/vnd.github+json`, la API version que
ya usan los otros métodos).
- **204** → `{ deleted: true }`.
- **404** → `{ deleted: false }` (el repo ya no existe → idempotente, NO es error; deja seguir
  con el borrado del registry).
- **403** → `throw new GitProviderError(...)` con mensaje que menciona que falta `delete_repo`.
- Otro status no-ok → `throw new GitProviderError(...)` con el status.

**mock.ts:** registra la llamada y devuelve `{ deleted: true }` (para tests que no tocan red).

### 3.2 Endpoint — `app/api/miniapps/[id]/route.ts` (extiende el DELETE existente)
Firma nueva: `DELETE /api/miniapps/:id?repo=true`.
- Query param `repo`: `"true"` → también borra el repo; ausente/otro → **comportamiento
  actual** (solo registry). Preserva los tests existentes.
- Guard `canScaffold` (sin cambios).
- Flujo con `repo=true`:
  1. `reg = await getStore().load()`. Si `reg[id] === undefined` → `MiniappNotFoundError` (404).
     (Se chequea leyendo `reg[parseMiniappId(id)]`; si el id es inválido, `removeMiniapp` más
     abajo ya mapea el error — pero para leer el repoUrl necesitamos el record antes, así que
     se valida existencia acá.)
  2. `parseRepo(record.repoUrl)`; si `record.repoUrl` falta o no parsea → `400`
     (`{ error: "miniapp has no valid repo URL to delete" }`).
  3. `deleteRepo({ owner, repo })` **envuelto en try/catch**: si tira `GitProviderError`
     (403 sin scope / otro), el endpoint responde **`403 { error, code: "REPO_DELETE_FAILED" }`**
     (mensaje incluye "delete_repo") y retorna **sin tocar el registry**. Si devuelve
     `{ deleted }` (204 o 404), sigue.
  4. `removeMiniapp(reg, id)` + `save`.
  5. `200 { id, deleted: true, repoDeleted: deleted }`.
- Sin `repo=true`: igual que hoy → `200 { id, deleted: true }` (registry only; `repoDeleted`
  ausente).
- **Status 403 para el fallo de repo:** en vez de dejar propagar el `GitProviderError` al 502
  genérico de `statusForError`, el endpoint lo captura en el paso 3 y devuelve un **403 con
  mensaje claro** (el token no tiene `delete_repo`). No se toca `statusForError`.

### 3.3 UI — `app/components/MiniappDeleteControl.tsx`
Client component. Props: `{ id: string; hasRepo: boolean }`.
- Sección **"Zona de peligro"** (estilos propios `.danger-zone*`, ver §3.4).
- Input de texto: el user tipea el id. Estado `confirmText`.
- Checkbox **"También borrar el repositorio de GitHub"** — `deleteRepo`, default `true`, se
  renderiza solo si `hasRepo` (si la miniapp no tiene repoUrl, no hay repo que borrar).
- Botón **"Eliminar miniapp"** — `disabled` salvo que `confirmText === id`. `deleting` state.
- On click → `fetch('/api/miniapps/'+id+'?repo='+(deleteRepo && hasRepo), { method: 'DELETE' })`.
  - `res.ok` → `router.push('/catalog')` (la miniapp ya no existe).
  - `!res.ok` → mostrar `body.error` (ej. el 403 de `delete_repo`).
- Montaje: en `app/miniapp/[id]/page.tsx`, dentro del bloque `canPublish`, como la última
  `<section>`. `hasRepo = detail.repoUrl !== undefined`.

### 3.4 Estilos — `app/globals.css`
Sección de peligro (rojo tenue): `.danger-zone` (borde/acento rojo), `.danger-zone h2`,
`.danger-input`, `.btn-danger` (fondo rojo, texto claro; disabled atenuado). Reutiliza las
variables existentes donde aplique; define un rojo si no hay var de "danger".

## 4. Data flow

```
Admin en /miniapp/<id> (server) → detail.repoUrl → <MiniappDeleteControl id hasRepo />
Admin tipea el id + (checkbox repo) + Eliminar
  → DELETE /api/miniapps/<id>?repo=<bool>   (canScaffold)
  → [repo=true] deleteRepo(owner,repo)  → [ok/404] removeMiniapp + save
     [repo=false] removeMiniapp + save
  → 200 → router.push('/catalog')
```

## 5. Manejo de errores
- Miniapp inexistente → 404 (`MiniappNotFoundError`).
- `repo=true` pero sin repoUrl parseable → 400.
- Token sin `delete_repo` → `deleteRepo` da 403 → endpoint devuelve **403** con mensaje claro
  ("el token del server no tiene permiso delete_repo") y **el registry queda intacto**
  (repo-first). El user agrega el scope y reintenta.
- Repo ya borrado (404 de GitHub) → no es error; se borra la entrada del registry igual.
- Sin admin → 403 (`ScaffoldForbiddenError`).

## 6. Seguridad
- Guard `canScaffold` (admin allowlist), igual que las otras mutaciones.
- El control UI se renderiza solo en el bloque `canPublish` (admins).
- Confirmación tipeando el id (evita borrados accidentales).
- El repo se borra con el token del server (`githubToken()`), que necesita scope
  `delete_repo` (operacional).

## 7. Operacional (fuera del código)
- Agregar `delete_repo` al `GITHUB_TOKEN` de Vercel (production) + redeploy. Sin eso, el
  borrado de registry funciona pero el de repo da 403 con mensaje claro.

## 8. Testing
- **`deleteRepo` (github, con fetch mockeado):** 204 → `{deleted:true}` (verifica method DELETE
  + URL `/repos/{owner}/{repo}`); 404 → `{deleted:false}`; 403 → throw (mensaje menciona
  delete_repo); 500 → throw.
- **`deleteRepo` (mock):** devuelve `{deleted:true}` y registra la llamada.
- **Endpoint DELETE:**
  - sin `?repo` → registry-only, 200, repo NO tocado (los tests existentes siguen verdes).
  - `?repo=true` → borra repo (mock) + registry; 200 `{repoDeleted:true}`.
  - `?repo=true` con repo ya borrado (mock 404 → deleted:false) → 200 `{repoDeleted:false}`, registry borrado.
  - `?repo=true` y `deleteRepo` falla (mock throw GitProviderError) → **403**, NO borra el registry (sigue presente), mensaje con delete_repo.
  - `?repo=true` sin repoUrl en el record → 400, registry intacto.
  - 404 miniapp inexistente; 403 sin admin.
- **MiniappDeleteControl:** botón deshabilitado hasta tipear el id exacto; checkbox visible solo
  con `hasRepo`; al confirmar hace el DELETE con el query correcto (mock fetch).

## 9. Fuera de alcance (YAGNI)
- **Borrar los chunks de R2/Blob** de la miniapp — quedan huérfanos pero inofensivos; el prune
  de chunks es un item aparte del roadmap.
- **Borrado por-versión** (esto borra la miniapp entera).
- **Cambiar `statusForError`** para un 403 dedicado — el endpoint arma el mensaje claro sin
  tocar el mapeo global.
