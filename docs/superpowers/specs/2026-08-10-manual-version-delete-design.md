# Borrar versión manualmente (#11 follow-up) — Design

**Fecha:** 2026-08-10
**Estado:** Aprobado (listo para plan)
**Repo:** `backstage-web`
**Owner:** <owner>

---

## Goal

Además del prune automático, poder **borrar una versión puntual** a mano (su chunk + su entrada del registry) desde el detalle de la miniapp — **excepto la servida/pinneada** (se está montando).

## Approach

Reusa `storage.deletePrefix` (del prune). `removeVersion` puro (pin-safe) + `DELETE /api/miniapps/:id/versions/:version` + botón 🗑 por versión en `VersionList` (admin, oculto en la servida).

## Diseño detallado

### 1. `lib/registry/registry.ts` — `removeVersion` (pura)
```ts
/** Saca una versión del registry. Rechaza la servida (pinnedVersion ?? latest) y las inexistentes. */
export function removeVersion(reg: Registry, rawId: string, version: string): Registry {
  const id = parseMiniappId(rawId);
  if (id === null) throw new InvalidManifestError(`bad miniapp id "${rawId}"`);
  const record = reg[id];
  if (record === undefined) throw new MiniappNotFoundError(id);
  if (!record.versions.some((v) => v.version === version)) {
    throw new InvalidManifestError(`version ${version} not found for ${id}`);
  }
  const served = record.pinnedVersion ?? selectLatest(record.versions)?.version;
  if (version === served) {
    throw new InvalidManifestError(`no se puede borrar la versión servida (${version})`);
  }
  return { ...reg, [id]: { ...record, versions: record.versions.filter((v) => v.version !== version) } };
}
```

### 2. `app/api/miniapps/[id]/versions/[version]/route.ts` (nuevo)
`DELETE`: auth lazy + canScaffold; `removeVersion(reg, id, version)` (InvalidManifest→400 / NotFound→404); `storage.deletePrefix(`${id}/${version}`)` best-effort; `save`; devuelve `getMiniappDetail(next, id)`.
```ts
const reg = await getStore().load();
const storage = await getStorage(reg[id]?.storageProvider ?? null);
const next = removeVersion(reg, id, version);       // valida (served/existe) ANTES de borrar
try { await storage.deletePrefix(`${id}/${version}`); } catch { /* best-effort */ }
await getStore().save(next);
return NextResponse.json(getMiniappDetail(next, id), { status: 200 });
```

### 3. UI — `app/components/VersionList.tsx`
Props += `miniappId?: string` + `canDelete?: boolean`. Por cada versión, si `canDelete` **y** `version !== servedVersion`, un botón `🗑` → `window.confirm` → `DELETE /api/miniapps/${miniappId}/versions/${version}` → `router.refresh()`. La servida muestra el badge (sin botón). `VersionList` pasa a usar `useRouter` (ya es `"use client"`).

`app/miniapp/[id]/page.tsx`: `<VersionList ... miniappId={id} canDelete={canPublish} />`.

## Verificación

- **`removeVersion`:** saca la versión; **rechaza la servida** (pinned o latest) → InvalidManifest; versión inexistente → InvalidManifest; miniapp inexistente → 404; no muta el original.
- **Route:** DELETE borra chunk (mock `deletes`) + saca del registry (200 + detail); 400 al intentar la servida (no borra chunk); 403 sin admin; 404 miniapp/versión.
- **VersionList:** muestra 🗑 en versiones no-servidas cuando `canDelete`; no en la servida; el click hace el DELETE (confirm mockeado).

## Fuera de alcance

- Borrado en masa desde la UI (el prune automático + este por-versión alcanzan).
- Deshacer (el chunk borrado no se recupera; la versión se puede re-publicar).

## Archivos afectados

- `lib/registry/registry.ts` (+removeVersion); `app/api/miniapps/[id]/versions/[version]/route.ts` (nuevo); `app/components/VersionList.tsx` (+botón); `app/miniapp/[id]/page.tsx` (props) + tests.
