# Test de regresión del merge engine de Capa 2 (#6) — Design

**Fecha:** 2026-08-03
**Estado:** Aprobado (listo para plan)
**Repos afectados:** `miniapp-template` (código + test) + las 3 miniapps (rollout out-of-band)
**Owner:** <owner>
**Roadmap:** #6.

---

## Goal

Tener un **test de regresión automatizado** del motor de 3-way merge de Capa 2 (template-sync), para que un cambio que lo rompa se detecte en CI en vez de al sincronizar una miniapp real. Hoy la lógica vive **inline en `template-sync.yml`** (shell) y no la cubre ningún test.

## Background — el motor actual

El paso "3-way merge" de `miniapp-template/.github/workflows/template-sync.yml` hace, tras fetchear el template:

1. **Short-circuit:** si `baseSha == templateHead` → nada que sincronizar.
2. `git merge-tree --write-tree --merge-base=$BASE HEAD $TEMPLATE_HEAD` → emite el OID del árbol mergeado (1ª línea); **exit ≠0 si hay conflictos** (los archivos conflictuados quedan con marcadores `<<<<<<<`).
3. Materializa el árbol en un branch nuevo (`git switch -c` + `git read-tree -u --reset`).
4. **Ignore-list:** por cada línea de `.templatesyncignore`, restaura la versión de la miniapp (`git checkout HEAD -- <path>`) o la borra si el template la creó (`git rm --ignore-unmatch`).
5. **Bump del marker:** `.template-sync.baseSha` → `templateHead`.
6. `git add -A`; si no hay diff staged → nada. Si hay → commit + push + `gh pr create` (con warning en el body si hubo conflictos).

Los pasos **2-5 + el commit** son puros/determinísticos (git local, sin red). Los pasos **1 (fetch) y push + PR** son side-effects (red / GitHub).

## Approach

**Extraer el núcleo determinístico a `scripts/template-merge.mjs`** (función exportable + CLI) y testearlo con **`node:test`** (fixtures git en tmpdir). El workflow queda fino: fetch (antes) → `node scripts/template-merge.mjs` → push + PR (después). El test corre en el **`tests.yml` que ya construimos (#17)** — así #6 se monta sobre la CI recién agregada. Refactor **behavior-preserving** (mismos comandos git). Después se propaga el workflow refactorizado + el script a las 3 miniapps out-of-band.

Alternativas descartadas:
- **Testear una copia de la lógica** sin extraer: divergiría del motor real → el test dejaría de proteger lo que corre. No.
- **Extraer también push+PR:** esa parte es glue (necesita mockear `gh`/git-push), no el motor. Fuera del núcleo.

## Diseño detallado

### 1. `miniapp-template/scripts/template-merge.mjs`

Función pura testeable + CLI. Opera sobre `cwd` (el repo de la miniapp ya checkouteado, con `template/main` ya fetcheado en el object DB).

```js
/**
 * Núcleo determinístico del 3-way merge de Capa 2 (sin red).
 * Asume: cwd es un repo git con HEAD = main de la miniapp y `templateHead`
 * presente en el object DB (fetcheado). git user.name/email ya configurados.
 * Devuelve el resultado; NO pushea ni abre PR (eso lo hace el workflow).
 */
export function templateMerge({ base, templateHead, cwd = process.cwd() }) {
  // 1. short-circuit
  if (base === templateHead) return { status: "unchanged" };

  const short = git(cwd, `rev-parse --short ${templateHead}`).trim();
  const branch = `sync/template-${short}`;

  // 2. merge-tree (captura tree OID + conflicted por exit code)
  const { stdout, code } = gitAllowFail(cwd, `merge-tree --write-tree --merge-base=${base} HEAD ${templateHead}`);
  const tree = stdout.split("\n")[0];
  const conflicted = code !== 0;

  // 3. materializar en branch
  git(cwd, `switch -c ${branch}`);
  git(cwd, `read-tree -u --reset ${tree}`);

  // 4. ignore-list (restaurar la versión de la miniapp o borrar si la creó el template)
  applyIgnoreList(cwd); // lee .templatesyncignore; por línea: checkout HEAD -- o rm --ignore-unmatch

  // 5. bump del marker
  bumpMarker(cwd, templateHead); // jq-equivalente: .template-sync.baseSha = templateHead

  // 6. detectar cambios + commit local (sin push)
  git(cwd, "add -A");
  const hasChanges = gitAllowFail(cwd, "diff --cached --quiet").code !== 0;
  if (!hasChanges) return { status: "no-changes", branch, short, conflicted };
  git(cwd, `commit -m "sync: template @ ${short}"`);
  return { status: "merged", branch, short, conflicted };
}
```

- **Helpers self-contained:** `git()` (execSync, throw on fail), `gitAllowFail()` (captura stdout + exit code), `applyIgnoreList()`, `bumpMarker()` (usa `JSON.parse`/`stringify`, no depende de `jq`).
- **CLI:** lee `BASE`/`TEMPLATE_HEAD` de env, llama `templateMerge`, y **escribe los outputs a `$GITHUB_OUTPUT`** (`status`, `branch`, `short`, `conflicted`) para que el workflow decida push/PR.
- **Nota:** el marker siempre bumpea cuando `base != head` → en la práctica `hasChanges` es true salvo casos degenerados; el estado `no-changes` se mantiene por completitud/paridad con el shell original.

### 2. `miniapp-template/scripts/__tests__/template-merge.test.mjs` (node:test)

Cada test arma un repo git real en un tmpdir (`fs.mkdtempSync` + `git init` + commits), configura user.name/email, y ejerce `templateMerge`. Helper `setupFixture()` que crea:
- Commit **T0** (base): archivos del template + `.templatesyncignore` (con, p.ej., `manifest.json`).
- Branch **miniapp/main** desde T0: agrega `.template-sync` `{templateRepo, baseSha: T0}` + customización propia (p.ej. `src/Screen.tsx` editado, `manifest.json` propio).
- Branch **template/main** desde T0: cambios del template (archivo nuevo, archivo compartido editado).

Escenarios (asserts):
1. **Merge limpio:** miniapp edita A, template edita B → árbol final tiene ambos; `conflicted=false`, `status=merged`; marker bumpeado a templateHead.
2. **Conflicto:** ambos editan el mismo archivo distinto → `conflicted=true`; el archivo en el branch tiene `<<<<<<<`; `status=merged`.
3. **Ignore-list preserva:** el template edita `manifest.json` (en `.templatesyncignore`) → el árbol final mantiene la versión de la **miniapp**, no la del template.
4. **Ignore-list borra lo creado:** el template **crea** un archivo listado en `.templatesyncignore` → el árbol final **no** lo contiene.
5. **No-op (unchanged):** `base == templateHead` → `status=unchanged`, no se crea branch.
6. **Bump del marker:** tras cualquier merge con cambios, `.template-sync.baseSha == templateHead` en el branch.

Requiere `git >= 2.38` (por `merge-tree --write-tree`); ubuntu-latest (CI) lo tiene. Se documenta como prerequisito del test.

### 3. Refactor de `template-sync.yml` (behavior-preserving)

El paso monolítico se parte en dos:

```yaml
      - name: 3-way merge (explicit base)
        id: merge
        env:
          BASE: ${{ steps.marker.outputs.base }}
          TEMPLATE_HEAD: ${{ steps.fetch.outputs.head }}
        run: |
          set -euo pipefail
          git config user.name "backstage-template-sync"
          git config user.email "template-sync@users.noreply.github.com"
          node scripts/template-merge.mjs   # escribe status/branch/short/conflicted a $GITHUB_OUTPUT

      - name: Push + open PR
        if: steps.merge.outputs.status == 'merged'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          git push -u origin "${{ steps.merge.outputs.branch }}"
          if [ "${{ steps.merge.outputs.conflicted }}" = "true" ]; then
            BODY="⚠️ Merge con **conflictos** — resuélvelos en este branch antes de mergear. Base \`${{ steps.marker.outputs.base }}\` → template \`${{ steps.merge.outputs.short }}\`."
          else
            BODY="Merge 3-way limpio desde el template (\`${{ steps.merge.outputs.short }}\`). Revisa el diff y el CI antes de mergear."
          fi
          gh pr create --title "Sync desde template @ ${{ steps.merge.outputs.short }}" --body "$BODY" --base main --head "${{ steps.merge.outputs.branch }}"
```

Los pasos `Read marker` y `Fetch template` no cambian. El `if: ${{ !github.event.repository.is_template }}` del job tampoco.

### 4. Rollout out-of-band a las 3 miniapps

El script y el workflow deben llegar a `hellow_widget`, `cards_wallet`, `account-dashboard`:
- **`scripts/template-merge.mjs`** → push directo (archivo normal, sin muro de workflows).
- **`.github/workflows/template-sync.yml`** (refactorizado) → push directo con el token `workflow` (muro de workflows; ver [[template-sync-no-propaga-workflows]]).
- Los 3 repos admiten push directo del owner: `hellow_widget` sin protección; `cards_wallet`/`account-dashboard` con `enforce_admins=false` → bypass del admin.
- Sin esto, una miniapp con el `template-sync.yml` refactorizado pero sin el script fallaría el sync → se entregan **juntos** (script + workflow) por repo.

## Qué NO cambia

- El comportamiento del sync (refactor behavior-preserving).
- Ningún otro workflow/script.
- El sistema de compat, el registry, Backstage.

## Verificación

1. **Unit (el objetivo):** `node --test scripts/__tests__/template-merge.test.mjs` verde local y en el `tests.yml` del template (PR).
2. **e2e del refactor:** disparar `template-sync` sobre una miniapp con drift real (o forzado) → confirmar que abre el PR de sync igual que antes (merge limpio y/o con conflicto). Se puede provocar drift con un cambio trivial en el template.
3. Confirmar que el `tests.yml` del template ahora incluye el nuevo test (glob `scripts/__tests__/*.test.mjs` ya lo agarra).

## Fuera de alcance

- Testear push/PR (glue con side-effects — se cubre por el e2e manual, no unit).
- Cambiar el algoritmo de merge (es behavior-preserving).
- Migrar los otros workflows a scripts (solo template-sync).

## Archivos afectados

- **Crear:** `miniapp-template/scripts/template-merge.mjs`
- **Crear:** `miniapp-template/scripts/__tests__/template-merge.test.mjs`
- **Modificar:** `miniapp-template/.github/workflows/template-sync.yml` (partir el paso, llamar al script)
- **Rollout:** push de `template-merge.mjs` + `template-sync.yml` a `miniapp-hellow_widget`, `miniapp-cards_wallet`, `miniapp-account-dashboard`.
- **Sin cambios:** el resto.
