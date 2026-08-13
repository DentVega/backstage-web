# Fan-out de Capa 2 (#16) — Design

**Fecha:** 2026-08-10
**Estado:** Aprobado (listo para plan)
**Repo:** `backstage-web`
**Owner:** <owner>
**Roadmap:** #16.

---

## Goal

Disparar el `template-sync` a **toda la flota** con una acción, en vez de por-miniapp. Un endpoint admin que enumera el registry y dispara `template-sync.yml` en cada repo, best-effort; un botón en el catálogo.

## Background

- Hoy: `POST /api/miniapps/:id/sync-template` → `dispatchMiniappWorkflow(id, "template-sync.yml")` (parsea `repoUrl` → dispatch en `main`). Por-miniapp.
- El patrón de "acción admin sobre toda la flota" ya existe: `POST /api/admin/reseed-secrets` (enumera el registry, best-effort por repo → `{reseeded, failed}`, usa `parseRepo(rec.repoUrl)`).

## Approach

Un `POST /api/admin/sync-all` calcado del reseed (canScaffold, load registry una vez, `dispatchWorkflow` por repo, best-effort) + un botón `SyncAllControl` en el catálogo (admin).

## Diseño detallado

### `app/api/admin/sync-all/route.ts` (nuevo)

```ts
export async function POST(): Promise<NextResponse> {
  try {
    const { auth } = await import("@/auth"); // lazy (patrón reseed)
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) throw new ScaffoldForbiddenError();

    const reg = await getStore().load();
    const provider = githubProvider(githubToken());
    const dispatched: string[] = [];
    const failed: { id: string; error: string }[] = [];
    for (const rec of Object.values(reg)) {
      const repo = parseRepo(rec.repoUrl);
      if (repo === null) { failed.push({ id: rec.id, error: "no repoUrl" }); continue; }
      try {
        await provider.dispatchWorkflow({ owner: repo.owner, repo: repo.repo, workflow: "template-sync.yml", ref: "main" });
        dispatched.push(rec.id);
      } catch (err) {
        failed.push({ id: rec.id, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return NextResponse.json({ dispatched, failed }, { status: 200 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
```
Imports: `parseRepo` (de `lib/git/miniapp-dispatch`), `githubProvider`, `githubToken`, `getStore`, `canScaffold`/`ScaffoldForbiddenError`, `scaffoldAllowedLogins`, `errorBody`/`statusForError`.

### `app/components/SyncAllControl.tsx` (nuevo, client, admin)

Botón "Actualizar toda la flota" → `POST /api/admin/sync-all` → muestra el resultado (`N disparadas` + los `failed` si hay). Estado saving/resultado (espeja el patrón de los otros controls client).

### `app/catalog/page.tsx`

Montar `<SyncAllControl />` en la barra admin (junto al `StorageProviderControl`, guard `canAdmin`).

## Verificación

- **Route (vitest):** dispatch en cada repo con repoUrl → `dispatched` los ids; repoUrl ausente → va a `failed`; un repo que tira → `failed` con el error, el resto sigue; 403 sin admin (no dispara nada). Mock del `githubProvider.dispatchWorkflow` (espeja `reseed-secrets-route.test`).
- **Component (RTL):** el botón postea y muestra el resultado.
- **e2e (opcional):** apretar el botón → cada miniapp abre su Actions run de template-sync (o "nothing to sync").

## Qué NO cambia

- El `template-sync.yml`, el motor de merge, el endpoint por-miniapp — intactos.

## Fuera de alcance

- Elegir un subconjunto de miniapps (hoy = todas).
- Esperar/reportar el resultado de cada sync (solo dispara; el resultado es cada PR).

## Archivos afectados

- **Crear:** `app/api/admin/sync-all/route.ts`, `app/components/SyncAllControl.tsx` + tests.
- **Modificar:** `app/catalog/page.tsx` (montar el botón).
