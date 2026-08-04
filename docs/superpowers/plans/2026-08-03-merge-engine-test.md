# Test de regresión del merge engine de Capa 2 (#6) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Extraer el núcleo determinístico del 3-way merge de `template-sync.yml` a `scripts/template-merge.mjs`, testearlo con `node:test`, refactorizar el workflow para llamarlo, y propagar script+workflow a las 3 miniapps.

**Architecture:** Función pura `templateMerge({base, templateHead, cwd})` (merge-tree → read-tree → ignore-list → bump marker → commit local, sin red) + CLI que escribe outputs a `$GITHUB_OUTPUT`. El workflow queda fino: fetch → node script → push + PR. Test con fixtures git reales en tmpdir. Corre en el `tests.yml` del template (#17).

**Tech Stack:** Node 20 + node:test, git ≥ 2.38 (`merge-tree --write-tree`).

## Global Constraints

- **Repo:** `miniapp-template` en `/Volumes/SSDExterno/prodproyects/miniapp-template`.
- **`miniapp-template/main` está PROTEGIDO** (`test` required, enforce_admins=false) → los cambios del template entran por **PR** (el owner podría bypass, pero usamos PR para dogfoodear el `test` check con el nuevo test).
- **Refactor behavior-preserving:** mismos comandos git que el shell inline. Sin cambiar el algoritmo.
- **`bumpMarker` usa `JSON.parse/stringify`** (no depende de `jq`).
- **Rollout:** script (`scripts/`, archivo normal) + workflow (`template-sync.yml`, muro de workflows → token `workflow`) van JUNTOS a cada miniapp; los 3 repos admiten push directo del owner. Ver [[template-sync-no-propaga-workflows]].

---

### Task 1: `scripts/template-merge.mjs` + test (local green)

**Files:**
- Create: `miniapp-template/scripts/template-merge.mjs`
- Create: `miniapp-template/scripts/__tests__/template-merge.test.mjs`

- [ ] **Step 0: Verificar git ≥ 2.38 local**

Run: `git --version`
Expected: `git version 2.38` o superior (por `merge-tree --write-tree`). Si es menor → PARAR, avisar (el test necesita esa versión; CI ubuntu-latest la tiene).

- [ ] **Step 1: Crear `scripts/template-merge.mjs`**

```js
/**
 * Núcleo determinístico del 3-way merge de Capa 2 (template-sync), sin red.
 * Extraído de template-sync.yml para testearlo (node:test). Asume: cwd = repo git
 * con HEAD = main de la miniapp y `templateHead` en el object DB (fetcheado).
 * git user.name/email configurados. NO pushea ni abre PR — eso lo hace el workflow.
 * Requiere git >= 2.38 (merge-tree --write-tree).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}
function gitAllowFail(cwd, args) {
  try {
    const stdout = execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return { stdout, code: 0 };
  } catch (err) {
    return { stdout: err.stdout?.toString() ?? "", code: err.status ?? 1 };
  }
}

/** Restaura la versión de la miniapp de cada path protegido, o lo borra si lo creó el template. */
export function applyIgnoreList(cwd) {
  const file = path.join(cwd, ".templatesyncignore");
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const restored = gitAllowFail(cwd, ["checkout", "HEAD", "--", line]);
    if (restored.code !== 0) gitAllowFail(cwd, ["rm", "-f", "--ignore-unmatch", "--", line]);
  }
}

/** Bumpea .template-sync.baseSha al templateHead recién sincronizado. */
export function bumpMarker(cwd, templateHead) {
  const file = path.join(cwd, ".template-sync");
  const marker = JSON.parse(readFileSync(file, "utf8"));
  marker.baseSha = templateHead;
  writeFileSync(file, `${JSON.stringify(marker, null, 2)}\n`, "utf8");
}

/** @returns {{status:"unchanged"|"no-changes"|"merged", branch?:string, short?:string, conflicted?:boolean}} */
export function templateMerge({ base, templateHead, cwd = process.cwd() }) {
  if (base === templateHead) return { status: "unchanged" };

  const short = git(cwd, ["rev-parse", "--short", templateHead]).trim();
  const branch = `sync/template-${short}`;

  const merge = gitAllowFail(cwd, ["merge-tree", "--write-tree", `--merge-base=${base}`, "HEAD", templateHead]);
  const tree = merge.stdout.split("\n")[0].trim();
  const conflicted = merge.code !== 0;

  git(cwd, ["switch", "-c", branch]);
  git(cwd, ["read-tree", "-u", "--reset", tree]);

  applyIgnoreList(cwd);
  bumpMarker(cwd, templateHead);

  git(cwd, ["add", "-A"]);
  const hasChanges = gitAllowFail(cwd, ["diff", "--cached", "--quiet"]).code !== 0;
  if (!hasChanges) return { status: "no-changes", branch, short, conflicted };

  git(cwd, ["commit", "-m", `sync: template @ ${short}`]);
  return { status: "merged", branch, short, conflicted };
}

// --- CLI: BASE/TEMPLATE_HEAD de env → outputs a $GITHUB_OUTPUT ---
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const base = process.env.BASE, templateHead = process.env.TEMPLATE_HEAD;
  if (!base || !templateHead) { console.error("BASE and TEMPLATE_HEAD are required"); process.exit(1); }
  const res = templateMerge({ base, templateHead });
  console.log(`template-merge: ${res.status}${res.branch ? ` (${res.branch}, conflicted=${res.conflicted})` : ""}`);
  if (process.env.GITHUB_OUTPUT) {
    const lines = [`status=${res.status}`];
    if (res.branch) lines.push(`branch=${res.branch}`, `short=${res.short}`, `conflicted=${res.conflicted}`);
    writeFileSync(process.env.GITHUB_OUTPUT, `${lines.join("\n")}\n`, { flag: "a" });
  }
}
```

- [ ] **Step 2: Crear el test `scripts/__tests__/template-merge.test.mjs`**

```js
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { templateMerge } from "../template-merge.mjs";

const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function g(cwd, ...args) { return execFileSync("git", args, { cwd, encoding: "utf8" }).trim(); }
function write(cwd, rel, content) {
  const f = path.join(cwd, rel);
  mkdirSync(path.dirname(f), { recursive: true });
  writeFileSync(f, content, "utf8");
}
function showOnBranch(cwd, branch, rel) { return g(cwd, "show", `${branch}:${rel}`); }
function existsOnBranch(cwd, branch, rel) {
  try { g(cwd, "cat-file", "-e", `${branch}:${rel}`); return true; } catch { return false; }
}

/** Repo con T0(base) → branch tmpl(template) y branch main(miniapp). */
function setupFixture({ miniapp, template, ignore = "manifest.json\n.template-sync\n" }) {
  const cwd = mkdtempSync(path.join(tmpdir(), "tmerge-"));
  dirs.push(cwd);
  g(cwd, "init", "-q", "-b", "main");
  g(cwd, "config", "user.email", "t@t.co");
  g(cwd, "config", "user.name", "t");
  write(cwd, "src/Screen.tsx", "// base screen\n");
  write(cwd, "shared.txt", "base\n");
  write(cwd, "manifest.json", '{"id":"__MINIAPP_ID__"}\n');
  write(cwd, ".templatesyncignore", ignore);
  g(cwd, "add", "-A"); g(cwd, "commit", "-qm", "T0");
  const base = g(cwd, "rev-parse", "HEAD");
  g(cwd, "switch", "-qc", "tmpl");
  template(cwd);
  g(cwd, "add", "-A"); g(cwd, "commit", "-qm", "template changes");
  const templateHead = g(cwd, "rev-parse", "HEAD");
  g(cwd, "switch", "-q", "main");
  write(cwd, ".template-sync", `${JSON.stringify({ templateRepo: "DentVega/miniapp-template", baseSha: base }, null, 2)}\n`);
  miniapp(cwd);
  g(cwd, "add", "-A"); g(cwd, "commit", "-qm", "miniapp changes");
  return { cwd, base, templateHead };
}

test("no-op: base == templateHead → unchanged (sin tocar git)", () => {
  const res = templateMerge({ base: "sha1", templateHead: "sha1", cwd: "/nonexistent" });
  assert.equal(res.status, "unchanged");
  assert.equal(res.branch, undefined);
});

test("merge limpio: combina ambos lados + bump del marker", () => {
  const { cwd, base, templateHead } = setupFixture({
    template: (c) => write(c, "shared.txt", "base\ntemplate-added\n"),
    miniapp: (c) => write(c, "src/Screen.tsx", "// miniapp custom\n"),
  });
  const res = templateMerge({ base, templateHead, cwd });
  assert.equal(res.status, "merged");
  assert.equal(res.conflicted, false);
  assert.equal(showOnBranch(cwd, res.branch, "shared.txt"), "base\ntemplate-added");
  assert.equal(showOnBranch(cwd, res.branch, "src/Screen.tsx"), "// miniapp custom");
  assert.equal(JSON.parse(showOnBranch(cwd, res.branch, ".template-sync")).baseSha, templateHead);
});

test("conflicto: marcadores <<<<<<< y conflicted=true", () => {
  const { cwd, base, templateHead } = setupFixture({
    template: (c) => write(c, "shared.txt", "base\nTEMPLATE version\n"),
    miniapp: (c) => write(c, "shared.txt", "base\nMINIAPP version\n"),
  });
  const res = templateMerge({ base, templateHead, cwd });
  assert.equal(res.status, "merged");
  assert.equal(res.conflicted, true);
  assert.match(showOnBranch(cwd, res.branch, "shared.txt"), /<<<<<<</);
});

test("ignore-list: preserva la versión de la miniapp de un archivo protegido", () => {
  const { cwd, base, templateHead } = setupFixture({
    template: (c) => write(c, "manifest.json", '{"id":"TEMPLATE"}\n'),
    miniapp: () => {},
  });
  const res = templateMerge({ base, templateHead, cwd });
  assert.equal(JSON.parse(showOnBranch(cwd, res.branch, "manifest.json")).id, "__MINIAPP_ID__");
});

test("ignore-list: borra un archivo protegido que creó el template", () => {
  const { cwd, base, templateHead } = setupFixture({
    ignore: "manifest.json\n.template-sync\nsecret.local\n",
    template: (c) => write(c, "secret.local", "from template\n"),
    miniapp: () => {},
  });
  const res = templateMerge({ base, templateHead, cwd });
  assert.equal(existsOnBranch(cwd, res.branch, "secret.local"), false);
});
```

- [ ] **Step 3: Correr el test local**

Run: `cd /Volumes/SSDExterno/prodproyects/miniapp-template && node --test scripts/__tests__/template-merge.test.mjs`
Expected: 5 tests pass. Si algo falla → iterar sobre el .mjs hasta verde.

- [ ] **Step 4: Confirmar que el resto de los tests del template siguen verdes**

Run: `cd /Volumes/SSDExterno/prodproyects/miniapp-template && node --test scripts/*.test.mjs scripts/__tests__/*.test.mjs`
Expected: todo verde (los nuevos + los existentes).

---

### Task 2: Refactor de `template-sync.yml` + PR

**Files:**
- Modify: `miniapp-template/.github/workflows/template-sync.yml`

- [ ] **Step 1: Reemplazar el paso monolítico "3-way merge ... + open PR"** por los dos pasos:

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
          node scripts/template-merge.mjs

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
          gh pr create --title "Sync desde template @ ${{ steps.merge.outputs.short }}" --body "$BODY" \
            --base main --head "${{ steps.merge.outputs.branch }}"
```

Los pasos `Read marker` y `Fetch template` y el `if` del job NO se tocan.

- [ ] **Step 2: Validar YAML**

Run: `ruby -ryaml -e "YAML.load_file('/Volumes/SSDExterno/prodproyects/miniapp-template/.github/workflows/template-sync.yml'); puts 'YAML OK'"`
Expected: `YAML OK`.

- [ ] **Step 3: Branch, commit, PR**

```bash
cd /Volumes/SSDExterno/prodproyects/miniapp-template
git checkout -b feat/merge-engine-test
git add scripts/template-merge.mjs scripts/__tests__/template-merge.test.mjs .github/workflows/template-sync.yml
git commit -m "test: extract Capa 2 merge engine to tested script (#6)"
git push -u origin feat/merge-engine-test
gh pr create --repo DentVega/miniapp-template --base main --head feat/merge-engine-test \
  --title "test: motor de merge de Capa 2 extraído + testeado (#6)" \
  --body "Extrae el 3-way merge de template-sync.yml a scripts/template-merge.mjs (behavior-preserving) + test node:test. Cierra roadmap #6."
```

- [ ] **Step 4: Confirmar `test` verde (ahora incluye el merge test) y mergear**

```bash
cd /Volumes/SSDExterno/prodproyects/miniapp-template
gh pr checks --repo DentVega/miniapp-template --watch   # el PR es de feat/merge-engine-test
```
Expected: check `test` **success** (compat/publish skipped por el guard). Luego:
```bash
gh pr merge --repo DentVega/miniapp-template --squash --delete-branch
```

---

### Task 3: Rollout a las 3 miniapps + e2e

**Files:** ninguno (operativo).

- [ ] **Step 1: Entregar script + workflow a las 3 miniapps (push directo, token workflow)**

Para cada `R` en `miniapp-hellow_widget`, `miniapp-cards_wallet`, `miniapp-account-dashboard`: PUT de `scripts/template-merge.mjs` y de `.github/workflows/template-sync.yml` (contenido = el del template mergeado) vía Contents API, en su `main`.
```bash
cd /Volumes/SSDExterno/prodproyects/miniapp-template
put_file() { # repo path
  local R="$1" P="$2"
  local SHA; SHA=$(gh api "repos/DentVega/$R/contents/$P" --jq '.sha' 2>/dev/null)
  local B64; B64=$(base64 -i "$P")
  gh api -X PUT "repos/DentVega/$R/contents/$P" \
    -f message="chore: adopt tested Capa 2 merge engine (#6)" \
    -f content="$B64" ${SHA:+-f sha="$SHA"} --jq '.commit.sha' 2>&1 | tail -1
}
for R in miniapp-hellow_widget miniapp-cards_wallet miniapp-account-dashboard; do
  echo "=== $R ==="
  put_file "$R" "scripts/template-merge.mjs"
  put_file "$R" ".github/workflows/template-sync.yml"
done
```
Expected: dos commits por repo. (Nota: `account-dashboard` está enrolado; si le falta algún path, se crea.)

- [ ] **Step 2: e2e — disparar template-sync sobre una miniapp y confirmar que abre el PR igual que antes**

Provocar drift (un cambio trivial en el template main ya existe si hay commits nuevos) y disparar el sync en `hellow_widget`:
```bash
cd /Volumes/SSDExterno/prodproyects
gh workflow run template-sync.yml --repo DentVega/miniapp-hellow_widget
sleep 8
RID=$(gh run list --repo DentVega/miniapp-hellow_widget --workflow "Template sync" -L 1 --json databaseId --jq '.[0].databaseId')
gh run watch "$RID" --repo DentVega/miniapp-hellow_widget --exit-status 2>&1 | tail -8
gh pr list --repo DentVega/miniapp-hellow_widget --state open --json number,title --jq '.[] | "#\(.number) \(.title)"'
```
Expected: el run pasa; si había drift, abre un PR "Sync desde template @ …" (igual que antes del refactor). Si no hay drift → "Template unchanged / nothing to sync" (también válido). Confirmar que NO rompe.

- [ ] **Step 3: (Sin commit)** Reportar resultado.

---

## Correcciones durante la ejecución

- **Rollout (Task 3 step 1):** el PUT del workflow a las miniapps dio `422 "sha wasn't supplied"` — el `2>/dev/null` del helper tapó el GET del sha de un archivo existente. Fix: re-fetch del sha explícito por repo y re-PUT (los 3 OK). El script (archivo nuevo) sí entró en la 1ª pasada.
- **e2e (Task 3 step 2):** hellow_widget tenía drift real (baseSha `d14c9bb` vs template `b43eea8`) → el sync corrió el merge: `template-merge: merged (sync/template-b43eea8, conflicted=true)` → abrió PR #6 (cerrado, era e2e). Confirma que el refactor es behavior-preserving punta a punta.

## Notas de ejecución

- El objetivo es el **test** (Task 1); el refactor lo habilita sin cambiar comportamiento; el rollout alinea la flota.
- Si el e2e no encuentra drift, forzarlo con un commit trivial en el template main (que dispararía además el auto-publish del host contract si tocara shared-deps — usar un archivo inocuo).
- Fuera de alcance: test de push/PR (glue), cambiar el algoritmo.
