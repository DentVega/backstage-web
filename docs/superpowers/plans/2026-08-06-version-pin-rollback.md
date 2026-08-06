# Rollback / pin de versión (#10) — Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans.

**Goal:** Implementar el pin/rollback de versión (código completo en el spec `2026-08-06-version-pin-rollback-design.md`).

## Global Constraints

- **Repo:** `backstage-web`, `/Volumes/SSDExterno/prodproyects/backstage-web`. Tests = **vitest**. `main` acepta push directo (dispara redeploy de Vercel).
- **Freeze**: publicar NO despina. `publishVersion` no se toca.
- El pin solo gobierna el branch por defecto de `resolveMiniapp`; `?version=`/`?range=` explícito manda.
- Espeja el patrón de storage-provider (`setMiniappStorageProvider`, `PUT /storage-provider`, `MiniappStorageControl`).
- Versiones inmutables — rollback re-apunta, nunca borra.

---

### Task 1: Registry core + tests

**Files:** Modify `lib/registry/types.ts`, `lib/registry/registry.ts`; Modify `lib/registry/__tests__/registry.test.ts` (o el que cubra registry).

- [ ] **Step 1** `types.ts`: `MiniappRecord` +`pinnedVersion?: SemVer`; `MiniappDetail` +`pinnedVersion?: SemVer` +`servedVersion: SemVer | null`.
- [ ] **Step 2** `registry.ts`: `setMiniappPin(reg, rawId, version|null)` (espeja `setMiniappStorageProvider`, valida `record.versions.some(v.version===version)` → `InvalidManifestError` si no existe). Código en el spec §2.
- [ ] **Step 3** `registry.ts`: `resolveMiniapp` — en el branch `else`, honrar `record.pinnedVersion` (fallback defensivo a `selectLatest`). Código en el spec §2.
- [ ] **Step 4** `registry.ts`: `getMiniappDetail` — proyectar `pinnedVersion` + `servedVersion = record.pinnedVersion ?? latest?.version ?? null`.
- [ ] **Step 5** Tests: `setMiniappPin` (fija/despina/versión inexistente→InvalidManifest/miniapp inexistente→404); `resolveMiniapp` sirve pinneada en default + `?version=` explícito la ignora; `getMiniappDetail` proyecta pin + served.
- [ ] **Step 6** `npx vitest run lib/registry` → verde.

---

### Task 2: API route `PUT /api/miniapps/[id]/pin` + tests

**Files:** Create `app/api/miniapps/[id]/pin/route.ts`; Create `app/api/__tests__/pin-route.test.ts` (espeja `storage-provider-route.test.ts` si existe).

- [ ] **Step 1** Crear la ruta (código en spec §3): auth lazy + canScaffold; body `{version}`; `setMiniappPin`; devuelve `getMiniappDetail(next, id)`. 400 versión no-string, InvalidManifest→400, NotFound→404, Forbidden→403.
- [ ] **Step 2** Tests: PUT fija (200 + detail con pinnedVersion), despina (`version:null`), 400 versión inexistente, 403 no-admin, 404 miniapp inexistente.
- [ ] **Step 3** `npx vitest run app/api/__tests__/pin-route.test.ts` → verde.

---

### Task 3: UI — control + badge + wiring + tests

**Files:** Create `app/components/MiniappVersionControl.tsx`; Modify `app/components/VersionList.tsx` (+badge servida); Modify `app/miniapp/[id]/page.tsx`; Modify/Create component tests.

- [ ] **Step 1** `MiniappVersionControl.tsx` (client): `<select>` con "Automática (última: vX)" (value "") + una opción por versión; value actual = `pinnedVersion ?? ""`; onChange → `PUT /api/miniapps/${id}/pin` `{version: value||null}` → `router.refresh()`; debajo "Sirviendo: vX" + aviso ⚠️ si `servedVersion !== latestVersion`.
- [ ] **Step 2** `VersionList.tsx`: aceptar prop `servedVersion?` y marcar esa versión con un badge `● servida`. Mantener backward-compatible (prop opcional).
- [ ] **Step 3** `app/miniapp/[id]/page.tsx`: pasar `servedVersion` a `<VersionList>`; montar `<MiniappVersionControl>` en la sección admin (guard `canPublish`), pasando id/versions/pinnedVersion/servedVersion/latestVersion.
- [ ] **Step 4** Tests: `MiniappVersionControl` (select con la opción correcta + aviso served≠latest); update `VersionList.test.tsx` para el badge servida.
- [ ] **Step 5** `npx vitest run app/components` → verde.

---

### Task 4: Verificación total + ship

- [ ] **Step 1** `npx vitest run` (toda la suite) + `npx tsc --noEmit` → verde.
- [ ] **Step 2** Commit + `git push origin main` (dispara redeploy Vercel).
- [ ] **Step 3** e2e post-deploy (cuando Vercel esté Ready): pinnear hellow_widget a una versión anterior vía `PUT /api/miniapps/hellow_widget/pin` (browser console admin, o confirmar UI) → `GET /api/resolve?id=hellow_widget` devuelve la fijada → despin → vuelve a la última.

---

## Notas
- Casi calcado de storage-provider (per-miniapp override). Menor riesgo.
- El e2e (Task 4 step 3) puede necesitar sesión admin (browser) para el PUT.
