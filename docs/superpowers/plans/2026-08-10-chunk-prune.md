# Prune de chunks viejos (#11) — Plan

> REQUIRED SUB-SKILL: superpowers:executing-plans. Código en el spec `2026-08-10-chunk-prune-design.md`.

**Goal:** Al publicar, prunear versiones fuera de {últimas 5} ∪ {servida}, borrando chunk + entrada. Automático, best-effort.

## Global Constraints

- Todo en **backstage-web** (vitest, push directo a main).
- **La versión servida (pinnedVersion ?? latest) JAMÁS se prunea.**
- Best-effort: el prune nunca rompe el publish (try/catch).
- Env opcional `PRUNE_KEEP` (default 5).

---

### Task 1: Storage — `deletePrefix` en el interface + 4 adapters

**Files:** `lib/storage/types.ts`, `lib/storage/{r2,blob,fs,mock}.ts` + ajustar tests de r2.

- [ ] **Step 1** `types.ts`: `ChunkStorage` += `deletePrefix(prefix: string): Promise<void>`.
- [ ] **Step 2** `r2.ts`: `SignedFetch` → `body?` opcional + return `{ok,status,text():Promise<string>}`; `deletePrefix` = ListObjectsV2 + DELETE por key (código spec §2). Ajustar los fakes de `r2.test.ts` (+`text`).
- [ ] **Step 3** `blob.ts`: `deletePrefix` con `list`+`del` de `@vercel/blob`.
- [ ] **Step 4** `fs.ts`: `deletePrefix` = `fs.rm(root, {recursive,force})`.
- [ ] **Step 5** `mock.ts`: `mockStorage(uploads?, deletes?)` → `deletePrefix` pushea el prefix a `deletes`.
- [ ] **Step 6** Tests: `deletePrefix` r2 (fake SignedFetch con XML de 2 keys → 1 GET + 2 DELETE; list no-ok → nada), fs (tmpdir). tsc + vitest storage verde.

---

### Task 2: Prune logic + config

**Files:** `lib/registry/registry.ts` (+versionsToPrune), `lib/registry/prune.ts` (nuevo), `lib/config.ts` (+pruneKeep) + tests.

- [ ] **Step 1** `registry.ts`: `versionsToPrune(record, keepN)` (código spec §3, usa compareSemVer).
- [ ] **Step 2** `prune.ts`: `pruneMiniapp(reg, storage, id, keepN)` (código spec §4).
- [ ] **Step 3** `config.ts`: `pruneKeep()`.
- [ ] **Step 4** Tests: `versionsToPrune` (7 vers keepN=5 → borra 2 viejas; **pinned viejo se mantiene**; ≤keepN → nada); `pruneMiniapp` (borra prefijos [mock deletes], saca del reg, best-effort en error, no-op sin nada).
- [ ] **Step 5** vitest verde.

---

### Task 3: Disparo en la upload route + verificación total

**Files:** `app/api/miniapps/[id]/upload/route.ts` + su test.

- [ ] **Step 1** Tras `await getStore().save(next)` (L163): `try { const {reg:pr, pruned} = await pruneMiniapp(next, storage, id, pruneKeep()); if (pruned.length) await getStore().save(pr); } catch {}`. Importar `pruneMiniapp`, `pruneKeep`.
- [ ] **Step 2** Test route: publicar la 6ª versión → el reg queda con 5 + el mock storage registró el borrado del prefijo de la 1ª. (Ajustar el test existente de la route al mock con `deletes`.)
- [ ] **Step 3** `npx vitest run` + `npx tsc --noEmit` verde. Commit + push main (Vercel). Verificar que un publish real no rompe (opcional).

---

## Notas
- El prune retroactivo de lo ya acumulado se va dando a medida que cada miniapp publica (no hay backfill; fuera de alcance).
