# Autocomplete de maintainers = collaborators del repo (#3 follow-up) — Design

**Fecha:** 2026-08-10
**Estado:** Aprobado (listo para plan)
**Repo:** `backstage-web`
**Owner:** DentVega

---

## Goal

Que solo se pueda poner de maintainer a alguien con **acceso al repo de la miniapp** (collaborator de GitHub). El autocomplete sugiere los collaborators, y el servidor **valida al guardar** (barrera real). Solo en el detalle (el create queda sin maintainers; el repo aún no existe).

## Diseño detallado

### 1. `lib/git/types.ts` — `GitProvider` += `listCollaborators`
```ts
listCollaborators(input: { owner: string; repo: string }): Promise<{ login: string }[]>;
```

### 2. `lib/git/github.ts` + `lib/git/mock.ts`
- github: `GET /repos/{owner}/{repo}/collaborators?per_page=100` (token) → `[{login}]`. Si no-ok → `[]` (best-effort).
- mock: `listCollaborators` configurable (default `[]`).

### 3. `lib/git/collaborators.ts` (nuevo)
```ts
/** Logins con acceso al repo de una miniapp (lowercased). [] si no hay repoUrl. */
export async function repoCollaboratorLogins(repoUrl: string | undefined): Promise<string[]> {
  const repo = parseRepo(repoUrl);
  if (repo === null) return [];
  const cols = await githubProvider(githubToken()).listCollaborators(repo);
  return cols.map((c) => c.login.toLowerCase());
}
```

### 4. `GET /api/miniapps/[id]/collaborators` (nuevo)
canManageMiniapp guard; `repoCollaboratorLogins(reg[id]?.repoUrl)` → `{ collaborators: string[] }`.

### 5. Validación en `PUT /api/miniapps/[id]/maintainers`
Antes de `setMaintainers`, si la lista es no-vacía:
```ts
const allowed = await repoCollaboratorLogins(reg[id]?.repoUrl);
const invalid = list.filter((m) => !allowed.includes(m.toLowerCase()));
if (invalid.length > 0) {
  return NextResponse.json(
    { error: `estos no tienen acceso al repo: ${invalid.join(", ")}` },
    { status: 400 },
  );
}
```
Si la miniapp **no tiene repoUrl** y la lista es no-vacía → 400 (no hay repo contra el cual validar acceso). Lista vacía → OK siempre.

### 6. UI — `MaintainersControl`
- Al montar: `GET /api/miniapps/:id/collaborators` → guarda la lista de collaborators.
- El input de "agregar" **solo permite** logins que estén en collaborators (case-insensitive); muestra un `<datalist>` con las sugerencias. Si tipean algo fuera de la lista → no se agrega (aviso "sin acceso al repo").
- Los ya-maintainers se muestran igual (aunque, por la validación, siempre serán collaborators).

## Verificación

- **`repoCollaboratorLogins`:** parsea repoUrl → llama listCollaborators → logins lowercased; sin repoUrl → [].
- **`GET collaborators`:** devuelve los logins (mock provider); 403 sin manage.
- **`PUT maintainers` (validación):** login collaborator → 200; login NO-collaborator → 400 (no persiste); sin repoUrl + lista no-vacía → 400; lista vacía → 200.
- **`MaintainersControl`:** fetchea collaborators; sugiere solo esos; no agrega uno fuera de la lista.

## Qué NO cambia

- El create (sin maintainers).
- El modelo de authz (#3) — esto endurece SOLO quién puede SER maintainer.

## Fuera de alcance

- Autocomplete en el create (el repo no existe aún).
- Paginación de >100 collaborators (raro; per_page=100).
- Agregar collaborators al repo de GitHub desde Backstage (esto solo lee).

## Archivos afectados

- `lib/git/types.ts` (+listCollaborators), `lib/git/github.ts` + `lib/git/mock.ts` (impl), `lib/git/collaborators.ts` (nuevo), `app/api/miniapps/[id]/collaborators/route.ts` (nuevo), `app/api/miniapps/[id]/maintainers/route.ts` (validación), `app/components/MaintainersControl.tsx` (autocomplete) + tests.
