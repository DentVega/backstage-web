# Rollback / pin de versión (#10) — Design

**Fecha:** 2026-08-06
**Estado:** Aprobado (listo para plan)
**Repo:** `backstage-web` (control plane)
**Owner:** DentVega
**Roadmap:** #10.

---

## Goal

Que un admin pueda **fijar (pin)** qué versión de una miniapp sirve el host — para **revertir (rollback)** a una versión anterior tras un mal deploy, o **congelar** en una versión conocida. Hoy el host siempre monta la última (`selectLatest`); no hay forma de fijar ni revertir.

## Background

- **Versiones inmutables:** el registry guarda `record.versions[]` (append-only). Rollback = re-apuntar a una versión existente, nunca borrar.
- **`resolveMiniapp(reg, id, {version?, range?})`** ya soporta pedir versión/rango explícito. El "siempre la última" es el branch `else` → `selectLatest(record.versions)`. **Ahí entra el pin.**
- **Efecto inmediato:** el host produce en cada mount un `GET /api/resolve?id=…` (sin versión). Cambiar el pin → el próximo resolve sirve la fijada. Rollback instantáneo, sin re-deploy del host.
- El patrón espeja **storage-provider** (override per-miniapp ya construido): `setMiniappStorageProvider` / `PUT /storage-provider` / `MiniappStorageControl`.

## Approach

Un campo `pinnedVersion?` en el `MiniappRecord`. `resolveMiniapp` lo honra en el branch por defecto. Un `setMiniappPin` (valida existencia), un `PUT /api/miniapps/:id/pin`, y un control en el detalle. **Semántica: freeze** — publicar una versión nueva NO la sirve mientras haya pin; el admin despina (o re-pinnea) explícitamente.

## Diseño detallado

### 1. `lib/registry/types.ts`

`MiniappRecord` gana:
```ts
/** Versión fijada que el host sirve por defecto (rollback/freeze). undefined = última (auto). */
readonly pinnedVersion?: SemVer;
```
`MiniappDetail` gana:
```ts
readonly pinnedVersion?: SemVer;   // el pin actual (undefined = auto)
readonly servedVersion: SemVer | null; // lo que el host sirve HOY: pinnedVersion ?? latest
```

### 2. `lib/registry/registry.ts`

**`resolveMiniapp` — honrar el pin en el branch por defecto:**
```ts
} else {
  chosen =
    record.pinnedVersion !== undefined
      ? (record.versions.find((v) => v.version === record.pinnedVersion) ??
         selectLatest(record.versions)) // fallback defensivo (nunca debería faltar: append-only)
      : selectLatest(record.versions);
}
```
(Los branches `version`/`range` explícitos NO cambian: un pedido explícito del host manda; el pin solo gobierna el default.)

**`setMiniappPin` (espeja `setMiniappStorageProvider`):**
```ts
export function setMiniappPin(reg: Registry, rawId: string, version: string | null): Registry {
  const id = parseMiniappId(rawId);
  if (id === null) throw new InvalidManifestError(`bad miniapp id "${rawId}"`);
  const record = reg[id];
  if (record === undefined) throw new MiniappNotFoundError(id);
  if (version === null) {
    const next = { ...record };
    delete (next as { pinnedVersion?: SemVer }).pinnedVersion;
    return { ...reg, [id]: next };
  }
  if (!record.versions.some((v) => v.version === version)) {
    throw new InvalidManifestError(`version ${version} not published for ${id}`);
  }
  return { ...reg, [id]: { ...record, pinnedVersion: version as SemVer } };
}
```

**`getMiniappDetail` — proyectar el pin + la servida:**
```ts
const served = record.pinnedVersion ?? latest?.version ?? null;
// ... en el objeto devuelto:
pinnedVersion: record.pinnedVersion,
servedVersion: served,
```

**`publishVersion` — NO se toca** (freeze: publicar solo appendea; el pin queda como está).

### 3. `app/api/miniapps/[id]/pin/route.ts` (nuevo, espeja storage-provider)

```ts
export async function PUT(req, { params }) {
  // auth lazy + canScaffold → ScaffoldForbiddenError (403)
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { version?: unknown } | null;
  const version = body?.version ?? null;
  if (version !== null && typeof version !== "string") {
    return NextResponse.json({ error: "version must be a string or null" }, { status: 400 });
  }
  const reg = await getStore().load();
  const next = setMiniappPin(reg, id, version); // InvalidManifestError→400, MiniappNotFoundError→404
  await getStore().save(next);
  return NextResponse.json(getMiniappDetail(next, id), { status: 200 });
}
```

### 4. UI

**`app/components/MiniappVersionControl.tsx` (nuevo, client, admin-only)** — control de la versión servida. Un `<select>` (escala mejor que radios para muchas versiones):
- Opción `Automática (última: vX.Y.Z)` (value = "") + una opción por versión (más nueva primero).
- Selección actual = `pinnedVersion ?? ""`.
- onChange → `PUT /api/miniapps/:id/pin` con `{ version: value || null }` → `router.refresh()`.
- Muestra debajo: **"Sirviendo: vX.Y.Z"** + si `servedVersion !== latest` un aviso ⚠️ *"Estás sirviendo una versión anterior (N más nuevas publicadas)"*.
- Espeja el CSS/estructura de `MiniappStorageControl` (clases `.storage-*` → reusar como `.pin-*` o compartir).

**`VersionList` (existente) — badge "servida":** recibe `servedVersion` y marca la versión servida con un badge `● servida`. Read-only, para todos.

**`app/miniapp/[id]/page.tsx`:** pasar `servedVersion` a `<VersionList>`; montar `<MiniappVersionControl id={id} versions={…} pinnedVersion={…} servedVersion={…} latestVersion={…} />` en la sección admin (guard `canPublish`, junto a StorageControl/DeleteControl).

## Verificación

Tests (vitest, corren en el CI de backstage-web):
- **registry:** `setMiniappPin` (fija / despina / versión inexistente→InvalidManifest / miniapp inexistente→404); `resolveMiniapp` sirve la pinneada en el default; `?version=` explícito **ignora** el pin; `getMiniappDetail` proyecta `pinnedVersion` + `servedVersion`.
- **route:** PUT fija (200 + detail), despina (`version:null`), 400 versión inexistente, 403 no-admin, 404 miniapp inexistente.
- **component:** `MiniappVersionControl` renderiza el select con la opción correcta seleccionada + el aviso cuando served ≠ latest.
- **e2e manual (opcional):** pinnear hellow_widget a una versión anterior → `GET /api/resolve?id=hellow_widget` devuelve la fijada; despin → vuelve a la última.

## Qué NO cambia

- Publicar (`publishVersion`) — sigue appendeando; el pin es independiente.
- El resolve con `version`/`range` explícito.
- El sistema de compat / gates.

## Fuera de alcance

- Botón "rollback a la anterior" de un click (el select ya deja elegir cualquiera; se puede sumar después).
- Pin por-plataforma o por-cohorte de usuarios (hoy es global por miniapp).
- Historial/auditoría de quién pinneó qué (posible follow-up).
- Auto-unpin al publicar (descartado: elegimos freeze).

## Archivos afectados

- **Modificar:** `lib/registry/types.ts` (+`pinnedVersion`, +`servedVersion`)
- **Modificar:** `lib/registry/registry.ts` (+`setMiniappPin`, resolve honra pin, detail proyecta)
- **Crear:** `app/api/miniapps/[id]/pin/route.ts`
- **Crear:** `app/components/MiniappVersionControl.tsx`
- **Modificar:** `app/components/…VersionList` (badge servida) + `app/miniapp/[id]/page.tsx` (montar el control)
- **Tests:** registry + route + component
