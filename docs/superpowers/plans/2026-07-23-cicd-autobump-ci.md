# CI/CD hardening (auto-bump + backstage-web CI) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give backstage-web a CI safety net, and make every miniapp publish auto-increment its version so re-deploys never hit the immutable registry's 409.

**Architecture:** (#5) A GitHub Actions workflow in backstage-web runs `tsc` + `vitest` on PRs/pushes. (#4) A new pure `scripts/version.mjs` in the miniapp template computes the next version; `scripts/publish.mjs` reads the registry's `latestVersion` and publishes `nextVersion(latest, manifest.version)` instead of the static manifest version. Propagates to existing miniapps via the Capa 2 sync.

**Tech Stack:** GitHub Actions, pnpm, Node 24 (CI) / Node ≥18 (`node:test`), Next.js 16 + vitest (backstage-web), ESM `.mjs` scripts.

## Global Constraints

- Owner DentVega. Template repo: `DentVega/miniapp-template`.
- Spec of record: `docs/superpowers/specs/2026-07-22-cicd-autobump-ci-design.md`.
- `GET {BACKSTAGE_URL}/api/miniapps` returns `{ miniapps: [{ id, latestVersion, ... }] }`; `latestVersion` is a semver string or `null`.
- Auto-bump is **patch-only**; a minor/major bump is a manual edit to `manifest.json` (honored when `manifest.version > latest`).
- Versions in use are simple `x.y.z` (no pre-release tags).
- Pure version functions live in `scripts/version.mjs` (no side effects); `publish.mjs` imports them; `publish.test.mjs` tests them via `node:test` and never runs the publish flow.
- No new dependencies (`node:test`, `fetch`, `FormData`, `Blob` are built in).
- backstage-web uses pnpm; installs `@dentvega/*` public packages from GitHub Packages (auth via `~/.npmrc` + automatic `GITHUB_TOKEN`).
- Pushing workflow files needs a token with `workflow` scope — use each repo's normal git credentials; on rejection, report BLOCKED (do not rewrite the remote with a token).
- Commit trailer for every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```

---

## Task 1: backstage-web CI workflow (#5)

**Files:**
- Create: `.github/workflows/ci.yml` (in `/Volumes/SSDExterno/prodproyects/backstage-web`)

**Interfaces:**
- Produces: a `CI` workflow running `tsc --noEmit` + `vitest run` on `pull_request` and `push` to `main`.

- [ ] **Step 1: Create the workflow**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

# Runs the typecheck + test suite on every PR and push to main, so a regression
# is caught before it reaches Vercel. backstage-web had no CI before this.

on:
  pull_request:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 10
      - uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install deps (GitHub Packages)
        # @dentvega/* are public; the automatic GITHUB_TOKEN suffices to read them.
        run: |
          echo "//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}" >> ~/.npmrc
          pnpm install --frozen-lockfile=false
        env:
          NODE_AUTH_TOKEN: ${{ secrets.GITHUB_TOKEN }}

      - name: Typecheck
        run: pnpm exec tsc --noEmit

      - name: Test
        run: pnpm exec vitest run
```

- [ ] **Step 2: Validate the YAML parses**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml')); print('yaml ok')"`
Expected: `yaml ok`. (If ambient python lacks pyyaml, use a throwaway venv; do not touch system packages.)

- [ ] **Step 3: Confirm the commands work locally (same as CI will run)**

Run: `npx tsc --noEmit && npx vitest run`
Expected: tsc clean; `Tests  135 passed` (or current count, all passing).

- [ ] **Step 4: Commit + push**

```bash
cd /Volumes/SSDExterno/prodproyects/backstage-web
git add .github/workflows/ci.yml
git commit -m "ci: run tsc + vitest on PRs and pushes to main"
git push origin main
```

- [ ] **Step 5: Confirm the workflow ran green**

Run: `gh run list --repo DentVega/backstage-web --workflow ci.yml --limit 1`
Expected: the run for the push completes with `success` (allow ~1–2 min; re-check).

---

## Task 2: `version.mjs` pure functions + `node:test` (#4 core)

**Files:**
- Create: `scripts/version.mjs` (in `/Volumes/SSDExterno/prodproyects/miniapp-template`)
- Test: `scripts/publish.test.mjs`

**Interfaces:**
- Produces: `parseVer(v: string): number[]`, `cmpVer(a: string, b: string): -1|0|1`, `bumpPatch(v: string): string`, `nextVersion(latest: string|null, want: string): string` — all exported from `scripts/version.mjs`.

- [ ] **Step 1: Write the failing test**

Create `scripts/publish.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseVer, cmpVer, bumpPatch, nextVersion } from "./version.mjs";

test("parseVer splits into numbers", () => {
  assert.deepEqual(parseVer("0.1.2"), [0, 1, 2]);
});

test("cmpVer orders versions", () => {
  assert.equal(cmpVer("0.2.0", "0.1.9"), 1);
  assert.equal(cmpVer("0.1.0", "0.1.2"), -1);
  assert.equal(cmpVer("0.1.2", "0.1.2"), 0);
});

test("bumpPatch increments the patch", () => {
  assert.equal(bumpPatch("0.7.0"), "0.7.1");
  assert.equal(bumpPatch("0.1.9"), "0.1.10");
});

test("nextVersion: first publish uses manifest version", () => {
  assert.equal(nextVersion(null, "0.1.0"), "0.1.0");
});

test("nextVersion: auto-patches when want <= latest", () => {
  assert.equal(nextVersion("0.1.2", "0.1.0"), "0.1.3");
  assert.equal(nextVersion("0.1.2", "0.1.2"), "0.1.3");
});

test("nextVersion: honors an intentional dev bump (want > latest)", () => {
  assert.equal(nextVersion("0.1.2", "0.2.0"), "0.2.0");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Volumes/SSDExterno/prodproyects/miniapp-template && node --test scripts/publish.test.mjs`
Expected: FAIL — cannot resolve `./version.mjs`.

- [ ] **Step 3: Implement `version.mjs`**

Create `scripts/version.mjs`:

```js
/** Pure semver helpers for auto-bump (no side effects). Versions are simple x.y.z. */

/** "0.1.2" -> [0,1,2] */
export function parseVer(v) {
  return String(v).split(".").map(Number);
}

/** -1 | 0 | 1 */
export function cmpVer(a, b) {
  const pa = parseVer(a);
  const pb = parseVer(b);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** "0.1.2" -> "0.1.3" */
export function bumpPatch(v) {
  const [maj, min, pat] = parseVer(v);
  return `${maj}.${min}.${(pat ?? 0) + 1}`;
}

/**
 * The version to publish. `latest` is the registry's latestVersion (or null),
 * `want` is manifest.version. First publish → want; an intentional dev bump
 * (want > latest) → want; otherwise auto-increment the patch of latest.
 */
export function nextVersion(latest, want) {
  if (latest == null) return want;
  if (cmpVer(want, latest) > 0) return want;
  return bumpPatch(latest);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Volumes/SSDExterno/prodproyects/miniapp-template && node --test scripts/publish.test.mjs`
Expected: PASS — `# pass 6`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
cd /Volumes/SSDExterno/prodproyects/miniapp-template
git add scripts/version.mjs scripts/publish.test.mjs
git commit -m "feat(publish): pure version helpers (parseVer/cmpVer/bumpPatch/nextVersion) + tests"
```

(Do not push yet — Task 3 lands with it in one push.)

---

## Task 3: Wire auto-bump into `publish.mjs` (#4)

**Files:**
- Modify: `scripts/publish.mjs` (in `/Volumes/SSDExterno/prodproyects/miniapp-template`)

**Interfaces:**
- Consumes: `nextVersion` from `./version.mjs` (Task 2).

- [ ] **Step 1: Replace `publish.mjs` with the auto-bump version**

Replace the entire contents of `scripts/publish.mjs` with:

```js
#!/usr/bin/env node
/**
 * Publish a built miniapp chunk to Backstage (ADR-016). Reusable across miniapps.
 *
 * Usage: node scripts/publish.mjs <build.zip>
 * Env:   BACKSTAGE_URL, PUBLISH_TOKEN
 * Reads: manifest.json (id, version) + package.json (version fallback)
 *
 * Auto-bump: the registry is immutable, so re-publishing a static version 409s.
 * We read the miniapp's latestVersion from the registry and publish
 * nextVersion(latest, manifest.version) — patch-auto-increment, honoring an
 * intentional minor/major bump in manifest.json. No commit back to the repo.
 *
 * No extra deps — Node provides fetch / FormData / Blob / fs.
 */
import { readFileSync } from "node:fs";
import { nextVersion } from "./version.mjs";

const zipPath = process.argv[2];
if (!zipPath) {
  console.error("usage: node scripts/publish.mjs <build.zip>");
  process.exit(1);
}

const backstageUrl = process.env.BACKSTAGE_URL;
const token = process.env.PUBLISH_TOKEN;
if (!backstageUrl || !token) {
  console.error("BACKSTAGE_URL and PUBLISH_TOKEN must be set");
  process.exit(1);
}

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const id = manifest.id;
const want = manifest.version ?? pkg.version;

// Look up the current latest published version to auto-bump past it.
let latest = null;
try {
  const res = await fetch(`${backstageUrl}/api/miniapps`);
  if (res.ok) {
    const body = await res.json();
    const found = (body.miniapps ?? []).find((m) => m.id === id);
    latest = found?.latestVersion ?? null;
  } else {
    console.warn(`catalog lookup failed: HTTP ${res.status} — falling back to manifest version`);
  }
} catch (err) {
  console.warn(`catalog lookup error (${err instanceof Error ? err.message : err}) — falling back to manifest version`);
}

const version = nextVersion(latest, want);

const form = new FormData();
form.set("file", new Blob([readFileSync(zipPath)]), "build.zip");
form.set("version", String(version));
form.set("manifest", JSON.stringify({ ...manifest, version }));

const res = await fetch(`${backstageUrl}/api/miniapps/${id}/upload`, {
  method: "POST",
  headers: { authorization: `Bearer ${token}` },
  body: form,
});

const body = await res.text();
if (!res.ok) {
  console.error(`publish failed: HTTP ${res.status} ${body}`);
  process.exit(1);
}
console.log(`published ${id}@${version} (latest was ${latest ?? "none"}): ${body}`);
```

- [ ] **Step 2: Syntax-check the script**

Run: `cd /Volumes/SSDExterno/prodproyects/miniapp-template && node --check scripts/publish.mjs`
Expected: no output (valid). Note: `node --check` does not support top-level `await` validation in all versions; if it errors on `await`, instead run `node -e "import('./scripts/publish.mjs').catch(()=>{})"` with no args and confirm it exits on the usage guard (`usage: node scripts/publish.mjs <build.zip>`) — proving the module parses and imports `version.mjs`.

- [ ] **Step 3: Re-run the version tests (unchanged, still green)**

Run: `cd /Volumes/SSDExterno/prodproyects/miniapp-template && node --test scripts/publish.test.mjs`
Expected: PASS — `# pass 6`.

- [ ] **Step 4: Commit + push (Tasks 2 + 3 together)**

```bash
cd /Volumes/SSDExterno/prodproyects/miniapp-template
git add scripts/publish.mjs
git commit -m "feat(publish): auto-bump version from registry latestVersion (no 409 on re-deploy)"
git push origin main
```

---

## Task 4: Propagate #4 to existing miniapps via Capa 2 sync

**Files:** none in-repo — operates on hello_widget + cards_wallet via their template-sync workflow.

**Interfaces:**
- Consumes: the new `scripts/version.mjs` + updated `scripts/publish.mjs` on template `main` (Task 3).
- Produces: both miniapp repos carrying the new files (merged sync PR).

- [ ] **Step 1: Trigger template-sync for both repos**

```bash
for R in miniapp-hellow_widget miniapp-cards_wallet; do
  gh workflow run template-sync.yml --repo "DentVega/$R" --ref main
done
sleep 8
for R in miniapp-hellow_widget miniapp-cards_wallet; do
  RID=$(gh run list --repo "DentVega/$R" --workflow template-sync.yml --limit 1 --json databaseId -q '.[0].databaseId')
  gh run watch "$RID" --repo "DentVega/$R" --exit-status
done
```
Expected: both runs succeed and open a sync PR.

- [ ] **Step 2: Review + merge each sync PR**

For each repo, inspect the PR (it should bring `scripts/version.mjs` + the updated `scripts/publish.mjs`, and bump `.template-sync`; it must NOT touch `src/Screen.tsx` / `manifest.json`), then merge:
```bash
for R in miniapp-hellow_widget miniapp-cards_wallet; do
  PR=$(gh pr list --repo "DentVega/$R" --state open --json number -q '.[0].number')
  gh pr diff "$PR" --repo "DentVega/$R" --name-only
  gh pr merge "$PR" --repo "DentVega/$R" --squash --delete-branch
done
```
Expected: each PR's files include `scripts/version.mjs` + `scripts/publish.mjs` + `.template-sync`; merges succeed.

- [ ] **Step 3: Confirm the new files landed on main**

```bash
for R in miniapp-hellow_widget miniapp-cards_wallet; do
  echo "== $R =="
  gh api "repos/DentVega/$R/contents/scripts/version.mjs" --jq .name
  gh api "repos/DentVega/$R/contents/scripts/publish.mjs" --jq .content | base64 -d | grep -c "nextVersion" | sed 's/^/  publish.mjs uses nextVersion x/'
done
```
Expected: `version.mjs` present; `publish.mjs` references `nextVersion`.

---

## Task 5: End-to-end verification (#4)

**Files:** none — validates auto-bump against live infra.

- [ ] **Step 1: Record cards_wallet's current latest version**

```bash
curl -s "https://backstage-web-blond.vercel.app/api/miniapps" \
  | python3 -c "import sys,json;m=[x for x in json.load(sys.stdin)['miniapps'] if x['id']=='cards_wallet'][0];print('before:',m['latestVersion'],'count',m['versionCount'])"
```
Record the value (e.g. `0.1.0`). Note: merging the sync PR in Task 4 already pushed to main, which triggers `ci.yml` (publish) once — that first auto-bump may have already advanced it.

- [ ] **Step 2: Trigger a deploy (auto-bump) once**

```bash
gh workflow run ci.yml --repo DentVega/miniapp-cards_wallet --ref main
sleep 5
RID=$(gh run list --repo DentVega/miniapp-cards_wallet --workflow ci.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RID" --repo DentVega/miniapp-cards_wallet --exit-status
```
Expected: run succeeds (no 409).

- [ ] **Step 3: Confirm the version auto-incremented**

```bash
curl -s "https://backstage-web-blond.vercel.app/api/miniapps" \
  | python3 -c "import sys,json;m=[x for x in json.load(sys.stdin)['miniapps'] if x['id']=='cards_wallet'][0];print('after:',m['latestVersion'],'count',m['versionCount'])"
```
Expected: `latestVersion` is one patch higher than the previous latest, `versionCount` +1 — and the run did NOT 409.

- [ ] **Step 4: Trigger a second deploy to prove idempotent re-deploy**

Repeat Step 2, then Step 3. Expected: `latestVersion` advances one more patch again, still no 409 — proving the Deploy button is now usable for repeated re-deploys.

---

## Self-Review notes (author)

- **Spec coverage:** #5 CI → Task 1; #4 pure functions + tests §2.3/§4 → Task 2; publish.mjs wiring §2.4/§2.5 → Task 3; propagation §6 → Task 4; e2e §4 → Task 5. Rollout order (§6: #5 first) → Task 1 first.
- **No new deps:** confirmed (`node:test`, `fetch`, `FormData`, `Blob` built in).
- **Type consistency:** `nextVersion(latest, want)` signature identical in Task 2 (definition), Task 2 tests, and Task 3 (call site).
- **Registry shape:** `{ miniapps: [{ id, latestVersion }] }` used consistently in Task 3 and Task 5.
