# Bootstrap de adopción Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A one-command `bootstrap.mjs` that renames the origin scope/owner (`@dentvega`/`DentVega`) to a new company's, so they can adopt the whole platform from GitHub template repos — without breaking our live repos.

**Architecture:** Pure, side-effect-free rename helpers (`bootstrap-lib.mjs`) tested with `node:test`; a thin CLI (`bootstrap.mjs`) that walks the repo, previews by default, and writes only with `--yes` (guarded against running on the origin repos). The identical three files ship in each of the 3 repos. Plus a `.gitignore` hardening, a `SETUP.md` update, and marking the repos as GitHub templates.

**Tech Stack:** Node ≥18 ESM (`node:test`, `node:fs`, `node:child_process`), `gh` CLI. Zero dependencies.

## Global Constraints

- **Additive only:** the live repos stay literal `@dentvega` / `DentVega` — never placeholder-ize (would break the build). The bootstrap renames a COPY.
- Origin literals (verified): `@dentvega` (scope), `DentVega` (owner, PascalCase), `dentvega` (login, lowercase standalone).
- Replacement order is **scope → owner → login** (avoids corrupting `@dentvega`, which contains `dentvega`).
- The bootstrap's OWN files (`bootstrap.mjs`, `bootstrap-lib.mjs`, `bootstrap.test.mjs`) and lockfiles are excluded from the walk.
- Write happens ONLY with `--yes`; otherwise always dry-run. `--force` bypasses the origin-guard (only meaningful with `--yes`).
- The 3 identical script files live at `scripts/` in each repo: `backstage-web`, `backstagereactnative`, `miniapp-template`. Owner `DentVega`.
- Commit trailer for every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```

---

## Task 1: `bootstrap-lib.mjs` pure helpers + tests

**Files (in `/Volumes/SSDExterno/prodproyects/backstage-web`):**
- Create: `scripts/bootstrap-lib.mjs`
- Test: `scripts/bootstrap.test.mjs`

**Interfaces:**
- Produces: `renameContent(text: string, opts: {scope,owner,login}): string`, `isOriginRepo(remoteUrl: string|undefined): boolean`, `shouldProcessFile(relPath: string): boolean`, `isExcludedDir(name: string): boolean`.

- [ ] **Step 1: Write the failing test**

Create `scripts/bootstrap.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  renameContent,
  isOriginRepo,
  shouldProcessFile,
  isExcludedDir,
} from "./bootstrap-lib.mjs";

const NEW = { scope: "@acme", owner: "Acme", login: "acme" };

test("renameContent: scope import", () => {
  assert.equal(renameContent("import x from '@dentvega/ui-kit'", NEW), "import x from '@acme/ui-kit'");
});
test("renameContent: owner URL", () => {
  assert.equal(renameContent("github.com/DentVega/miniapp-template", NEW), "github.com/Acme/miniapp-template");
});
test("renameContent: workflow uses", () => {
  assert.equal(
    renameContent("uses: DentVega/miniapp-template/.github/workflows/publish.yml@main", NEW),
    "uses: Acme/miniapp-template/.github/workflows/publish.yml@main",
  );
});
test("renameContent: login fixture", () => {
  assert.equal(renameContent('const ADMIN = "dentvega";', NEW), 'const ADMIN = "acme";');
});
test("renameContent: all three together, no corruption", () => {
  assert.equal(renameContent("@dentvega/ui-kit DentVega dentvega", NEW), "@acme/ui-kit Acme acme");
});
test("renameContent: no-op when nothing matches", () => {
  assert.equal(renameContent("nothing here", NEW), "nothing here");
});

test("isOriginRepo", () => {
  assert.equal(isOriginRepo("https://github.com/DentVega/backstage-web.git"), true);
  assert.equal(isOriginRepo("git@github.com:DentVega/x.git"), true);
  assert.equal(isOriginRepo("https://github.com/Acme/backstage-web"), false);
  assert.equal(isOriginRepo(""), false);
  assert.equal(isOriginRepo(undefined), false);
});

test("shouldProcessFile: includes source/config", () => {
  assert.equal(shouldProcessFile("package.json"), true);
  assert.equal(shouldProcessFile("src/x.ts"), true);
  assert.equal(shouldProcessFile(".npmrc"), true);
});
test("shouldProcessFile: excludes lockfiles, own scripts, binaries, dotfiles", () => {
  assert.equal(shouldProcessFile("pnpm-lock.yaml"), false);
  assert.equal(shouldProcessFile("scripts/bootstrap-lib.mjs"), false);
  assert.equal(shouldProcessFile("scripts/bootstrap.mjs"), false);
  assert.equal(shouldProcessFile("node_modules/x/index.js"), false);
  assert.equal(shouldProcessFile("public/logo.png"), false);
  assert.equal(shouldProcessFile(".gitignore"), false);
});
test("isExcludedDir", () => {
  assert.equal(isExcludedDir("node_modules"), true);
  assert.equal(isExcludedDir(".git"), true);
  assert.equal(isExcludedDir("src"), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Volumes/SSDExterno/prodproyects/backstage-web && node --test scripts/bootstrap.test.mjs`
Expected: FAIL — cannot resolve `./bootstrap-lib.mjs`.

- [ ] **Step 3: Implement `bootstrap-lib.mjs`**

Create `scripts/bootstrap-lib.mjs`:

```js
/** Pure helpers for the adoption bootstrap (no IO). */

const INCLUDE_EXT = new Set(["json", "ts", "tsx", "mjs", "js", "jsx", "yml", "yaml", "md"]);
const EXCLUDE_DIRS = new Set([
  "node_modules", ".git", "build", "dist", ".next", "coverage", "@mf-types", "Pods", ".gradle",
]);
const EXCLUDE_FILES = new Set([
  "pnpm-lock.yaml", "package-lock.json", "yarn.lock",
  "bootstrap.mjs", "bootstrap-lib.mjs", "bootstrap.test.mjs",
]);

/**
 * Replace the origin scope/owner/login literals with the new ones, in an order
 * that avoids corruption: scope (@dentvega) first, then owner (DentVega), then
 * the bare lowercase login (dentvega) — after the first two the only remaining
 * "dentvega" is the standalone login.
 */
export function renameContent(text, { scope, owner, login }) {
  return text
    .replaceAll("@dentvega", scope)
    .replaceAll("DentVega", owner)
    .replaceAll("dentvega", login);
}

/** true if the git remote origin URL points at the DentVega origin repos. */
export function isOriginRepo(remoteUrl) {
  if (!remoteUrl) return false;
  return /github\.com[:/]dentvega\//i.test(remoteUrl);
}

/** true if a directory name should be pruned from the walk. */
export function isExcludedDir(name) {
  return EXCLUDE_DIRS.has(name);
}

/**
 * Decide whether a repo-relative path (using "/" separators) should be scanned.
 * Includes known source/config extensions + `.npmrc`; excludes lockfiles, the
 * bootstrap's own files, excluded dirs, dotfiles, and everything else.
 */
export function shouldProcessFile(relPath) {
  const parts = relPath.split("/");
  const base = parts[parts.length - 1];
  if (parts.some((p) => EXCLUDE_DIRS.has(p))) return false;
  if (EXCLUDE_FILES.has(base)) return false;
  if (base === ".npmrc") return true;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return false; // no extension, or a dotfile like .gitignore
  return INCLUDE_EXT.has(base.slice(dot + 1).toLowerCase());
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Volumes/SSDExterno/prodproyects/backstage-web && node --test scripts/bootstrap.test.mjs`
Expected: PASS — `# pass 10`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/SSDExterno/prodproyects/backstage-web
git add scripts/bootstrap-lib.mjs scripts/bootstrap.test.mjs
git commit -m "feat(bootstrap): pure rename/guard/file-selection helpers + tests"
```

(No push yet — Task 2 pushes with it.)

---

## Task 2: `bootstrap.mjs` CLI + self-test (backstage-web)

**Files (in `/Volumes/SSDExterno/prodproyects/backstage-web`):**
- Create: `scripts/bootstrap.mjs`

**Interfaces:**
- Consumes: `renameContent`, `isOriginRepo`, `isExcludedDir`, `shouldProcessFile` from `./bootstrap-lib.mjs` (Task 1).

- [ ] **Step 1: Create the CLI**

Create `scripts/bootstrap.mjs`:

```js
#!/usr/bin/env node
/**
 * Adoption bootstrap: rename @dentvega/DentVega to a new company's scope/owner
 * across this repo (a template copy). Dry-run by default; --yes writes.
 *
 * Usage:
 *   node scripts/bootstrap.mjs --scope @acme --owner Acme [--login acme] [--yes] [--force]
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { execSync } from "node:child_process";
import {
  renameContent,
  isOriginRepo,
  isExcludedDir,
  shouldProcessFile,
} from "./bootstrap-lib.mjs";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--yes") args.yes = true;
    else if (a === "--force") args.force = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--scope") args.scope = argv[++i];
    else if (a === "--owner") args.owner = argv[++i];
    else if (a === "--login") args.login = argv[++i];
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.scope || !args.owner || !args.scope.startsWith("@")) {
  console.error("usage: node scripts/bootstrap.mjs --scope @acme --owner Acme [--login acme] [--yes] [--force]");
  console.error("  --scope must start with '@'; --owner required. Dry-run unless --yes.");
  process.exit(1);
}
const opts = { scope: args.scope, owner: args.owner, login: args.login ?? args.owner.toLowerCase() };
const write = Boolean(args.yes);

// Origin guard: refuse to WRITE on the DentVega origin repos unless --force.
if (write && !args.force) {
  let remote = "";
  try {
    remote = execSync("git remote get-url origin", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    remote = "";
  }
  if (isOriginRepo(remote)) {
    console.error(`Refusing to write: this looks like the origin repo (${remote}).`);
    console.error("Run bootstrap in a template copy / fork, or pass --force if you really mean it.");
    process.exit(1);
  }
}

// Walk the repo, pruning excluded dirs.
const root = process.cwd();
function walk(dir, rel) {
  const found = [];
  for (const name of readdirSync(dir)) {
    if (rel === "" && name === ".git") continue;
    const relPath = rel ? `${rel}/${name}` : name;
    const full = `${dir}/${name}`;
    let st;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      if (isExcludedDir(name)) continue;
      found.push(...walk(full, relPath));
    } else if (shouldProcessFile(relPath)) {
      found.push(relPath);
    }
  }
  return found;
}

const count = (text, re) => (text.match(re) || []).length;
const changed = [];
const totals = { scope: 0, owner: 0, login: 0 };

for (const rel of walk(root, "")) {
  const before = readFileSync(`${root}/${rel}`, "utf8");
  const after = renameContent(before, opts);
  if (after === before) continue;
  const cScope = count(before, /@dentvega/g);
  const cOwner = count(before, /DentVega/g);
  const cLogin = count(before, /dentvega/g) - cScope; // standalone lowercase login
  changed.push({ rel, cScope, cOwner, cLogin });
  totals.scope += cScope;
  totals.owner += cOwner;
  totals.login += cLogin;
  if (write) writeFileSync(`${root}/${rel}`, after, "utf8");
}

for (const c of changed) {
  console.log(`  ${c.rel}  (@dentvega:${c.cScope} DentVega:${c.cOwner} dentvega:${c.cLogin})`);
}
console.log(
  `\n${changed.length} archivos · @dentvega→${opts.scope}: ${totals.scope} · DentVega→${opts.owner}: ${totals.owner} · dentvega→${opts.login}: ${totals.login}`,
);
if (write) {
  console.log("Hecho. Ahora corré `pnpm install` para regenerar el lockfile, y seguí SETUP.md desde §3.2.");
} else {
  console.log("dry-run: nada escrito. Corré con --yes para aplicar.");
}
```

- [ ] **Step 2: Syntax-check + usage guard**

Run: `cd /Volumes/SSDExterno/prodproyects/backstage-web && node --check scripts/bootstrap.mjs && node scripts/bootstrap.mjs`
Expected: `node --check` exits 0 (no output); running with no args prints the `usage:` lines and exits 1.

- [ ] **Step 3: Self-test — dry-run finds occurrences, writes nothing**

Run:
```bash
cd /Volumes/SSDExterno/prodproyects/backstage-web
node scripts/bootstrap.mjs --scope @acme --owner Acme
git status --porcelain | grep -v "data/registry.json" | head
```
Expected: the summary line reports **nonzero** counts for `@dentvega→@acme`, `DentVega→Acme`, and `dentvega→acme` (dozens each), ends with "dry-run: nada escrito"; and `git status` shows **no modified tracked files** (dry-run wrote nothing). (Exact counts drift as docs change — assert only that all three are > 0 and nothing was written.)

- [ ] **Step 4: Self-test — origin-guard blocks `--yes`**

Run:
```bash
cd /Volumes/SSDExterno/prodproyects/backstage-web
node scripts/bootstrap.mjs --scope @acme --owner Acme --yes; echo "exit=$?"
git status --porcelain | grep -v "data/registry.json" | head
```
Expected: prints "Refusing to write: this looks like the origin repo …", `exit=1`, and `git status` still shows **no modified files** (origin-guard prevented the write, because this repo's origin is `DentVega/backstage-web`).

- [ ] **Step 5: Commit + push (Tasks 1 + 2)**

```bash
cd /Volumes/SSDExterno/prodproyects/backstage-web
git add scripts/bootstrap.mjs
git commit -m "feat(bootstrap): CLI (dry-run default, --yes writes, origin-guard)"
git push origin main
```

---

## Task 3: Propagate the 3 files to the other repos

**Files:** copy `scripts/bootstrap-lib.mjs`, `scripts/bootstrap.mjs`, `scripts/bootstrap.test.mjs` (identical) into `backstagereactnative` and `miniapp-template`.

**Interfaces:** none new — identical files.

- [ ] **Step 1: Copy the 3 files into both repos**

```bash
SRC=/Volumes/SSDExterno/prodproyects/backstage-web/scripts
for R in backstagereactnative miniapp-template; do
  D=/Volumes/SSDExterno/prodproyects/$R/scripts
  mkdir -p "$D"
  cp "$SRC/bootstrap-lib.mjs" "$SRC/bootstrap.mjs" "$SRC/bootstrap.test.mjs" "$D/"
done
```

- [ ] **Step 2: Run tests + dry-run self-test in each**

```bash
for R in backstagereactnative miniapp-template; do
  cd /Volumes/SSDExterno/prodproyects/$R
  echo "== $R =="
  node --test scripts/bootstrap.test.mjs 2>&1 | grep -E "# (pass|fail)"
  node scripts/bootstrap.mjs --scope @acme --owner Acme | tail -2
  git status --porcelain | grep -vE "scripts/bootstrap" | head   # must be clean (dry-run wrote nothing)
done
```
Expected: each repo → `# pass 10` / `# fail 0`; the dry-run summary reports nonzero counts and "dry-run: nada escrito"; no tracked files modified beyond the new `scripts/bootstrap*` files themselves.

- [ ] **Step 3: Commit + push each**

```bash
FOOTER="Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS"
for R in backstagereactnative miniapp-template; do
  cd /Volumes/SSDExterno/prodproyects/$R
  git add scripts/bootstrap-lib.mjs scripts/bootstrap.mjs scripts/bootstrap.test.mjs
  git commit -m "feat(bootstrap): adoption rename script (for a new company's template copy)" -m "$FOOTER"
  git push origin main
done
```
Expected: both push successfully.

---

## Task 4: `.gitignore` hardening (backstagereactnative)

**Files:**
- Modify: `/Volumes/SSDExterno/prodproyects/backstagereactnative/.gitignore`

- [ ] **Step 1: Confirm it lacks an env pattern, then add one**

Run: `grep -nE '(^|/)\.env' /Volumes/SSDExterno/prodproyects/backstagereactnative/.gitignore || echo "NO env pattern"`
Expected: `NO env pattern`.

Append to the end of `/Volumes/SSDExterno/prodproyects/backstagereactnative/.gitignore`:
```
# local env / secrets (never commit)
.env*
!.env.example
```

- [ ] **Step 2: Verify a would-be secret file is now ignored**

Run:
```bash
cd /Volumes/SSDExterno/prodproyects/backstagereactnative
printf 'SECRET=x\n' > .env.local && git check-ignore .env.local; rm -f .env.local
```
Expected: prints `.env.local` (it is ignored). Then it's removed.

- [ ] **Step 3: Commit + push**

```bash
cd /Volumes/SSDExterno/prodproyects/backstagereactnative
git add .gitignore
git commit -m "chore: gitignore .env* (never commit local secrets)"
git push origin main
```

---

## Task 5: Update `SETUP.md §3.1` to use bootstrap

**Files:**
- Modify: `/Volumes/SSDExterno/prodproyects/backstage-web/docs/SETUP.md` (§3.1, currently lines ~86–106)

- [ ] **Step 1: Replace the manual-rename block**

In `docs/SETUP.md`, replace the §3.1 body — the `grep/sed` code block and the surrounding text from "El proyecto de referencia usa el scope…" through the `> docs/miniapps-guide.md usa @org…` note — with:

```markdown
El proyecto de referencia usa el scope npm `@dentvega` y el owner GitHub
`DentVega`. Una empresa nueva **debe reemplazar ambos** — hay un script que lo
hace en un comando, en cada repo (corre desde la raíz del repo copiado):

```bash
# 1) preview (dry-run — no escribe nada):
node scripts/bootstrap.mjs --scope @acme --owner Acme

# 2) aplicar:
node scripts/bootstrap.mjs --scope @acme --owner Acme --yes

# 3) regenerar el lockfile con los nuevos nombres de paquete:
pnpm install
```

- `--scope` es tu scope npm (debe empezar con `@`); `--owner` tu usuario/org de
  GitHub. `--login` es opcional (default: el owner en minúscula) y solo afecta
  fixtures de test.
- Reemplaza `@dentvega`→tu scope, `DentVega`→tu owner y `dentvega`→tu login en
  `package.json`, `.npmrc`, `rspack.config.mjs`, `.github/workflows/*`, `src`,
  `docs`, etc. Excluye lockfiles (por eso el `pnpm install`) y sus propios
  archivos.
- Tiene un **guard**: se niega a escribir si detecta que corres sobre los repos
  origen (`DentVega/*`); usá `--force` solo si sabés lo que hacés.

> `docs/miniapps-guide.md` usa `@org/...` como placeholder genérico (ya pensado
> para sustituirse). Lo **literal** que el bootstrap renombra es `@dentvega` /
> `DentVega`.
```

- [ ] **Step 2: Verify the doc still renders (no broken code fences)**

Run: `grep -c '```' /Volumes/SSDExterno/prodproyects/backstage-web/docs/SETUP.md`
Expected: an **even** number (all fenced blocks closed).

- [ ] **Step 3: Commit + push**

```bash
cd /Volumes/SSDExterno/prodproyects/backstage-web
git add docs/SETUP.md
git commit -m "docs(setup): §3.1 uses bootstrap.mjs instead of manual grep/sed rename"
git push origin main
```

---

## Task 6: Mark the 3 repos as GitHub templates

**Files:** none — GitHub settings via `gh`.

- [ ] **Step 1: Flip `is_template` on all three**

```bash
for R in backstage-web backstagereactnative miniapp-template; do
  gh api -X PATCH "repos/DentVega/$R" -F is_template=true --jq '.name + " isTemplate=" + (.is_template|tostring)'
done
```
Expected: each prints `<repo> isTemplate=true`. (`miniapp-template` was already true — idempotent.)

- [ ] **Step 2: Verify**

```bash
for R in backstage-web backstagereactnative miniapp-template; do
  gh repo view "DentVega/$R" --json name,isTemplate --jq '.name + ": " + (.isTemplate|tostring)'
done
```
Expected: all three `: true`.

---

## Self-Review notes (author)

- **Spec coverage:** §3 script (lib+CLI) → Tasks 1–2; §4 template flag → Task 6, gitignore → Task 4, SETUP §3.1 → Task 5; §5 file structure (lib/CLI/test split) → Tasks 1–2; §6 tests → Task 1 (units) + Task 2 Steps 3–4 (self-test); §7 rollout order → Tasks 1→6.
- **Additive/no-break:** the origin-guard (Task 2 Step 4) proves `--yes` cannot modify our live repos; bootstrap files self-excluded so the tool never rewrites its own literals.
- **Type consistency:** `renameContent(text,{scope,owner,login})`, `isOriginRepo`, `isExcludedDir`, `shouldProcessFile` identical across Task 1 (def), Task 1 tests, and Task 2 (CLI import).
- **No hardcoded counts:** self-tests assert nonzero + no-write (robust to docs changing the exact totals).
