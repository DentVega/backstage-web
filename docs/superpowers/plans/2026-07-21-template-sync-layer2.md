# Capa 2 — Template Sync (anti-drift) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Backstage operator update any scaffolded miniapp to the current template state with one click, via a reviewable PR produced by a real 3-way merge that never clobbers the miniapp's own code.

**Architecture:** A `template-sync.yml` workflow lives in each miniapp (inherited from the template). A Backstage button dispatches it (`workflow_dispatch`, same pattern as Deploy). The workflow does an explicit-base 3-way merge (`git merge-tree --merge-base=<baseSha from .template-sync>`) of `template/main` into the miniapp, applies `.templatesyncignore` for miniapp-owned files, bumps the marker, and opens a PR. No new secrets — uses the automatic `GITHUB_TOKEN`.

**Tech Stack:** Next.js 16 (backstage-web), Vitest, GitHub Actions, `git merge-tree` (git ≥2.38), `gh` CLI, Upstash registry.

## Global Constraints

- Owner is **DentVega** (GitHub user, not org). Template repo: `DentVega/miniapp-template`.
- **No new secrets.** The sync workflow uses the automatic `GITHUB_TOKEN` (`contents: write`, `pull-requests: write`). Template is public → fetch without auth.
- Spec of record: `docs/superpowers/specs/2026-07-21-template-sync-layer2-design.md`.
- Miniapp-owned files (never overwritten): `src/Screen.tsx`, `manifest.json`, `README.md`, `README.es.md`, `.template-sync`.
- Marker file `.template-sync` shape: `{ "templateRepo": "DentVega/miniapp-template", "baseSha": "<40-hex>" }`.
- Current template HEAD (baseSha for backfill): `d5cc652c5a9abc48567d470534ee06e94da12435`.
- Backstage repo: `/Volumes/SSDExterno/prodproyects/backstage-web`. Template repo: `/Volumes/SSDExterno/prodproyects/miniapp-template`.
- Commit trailer for every commit:
  ```
  Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01MPXCf3ev2d17B2N5RgKVJS
  ```

---

## Task 1: Shared dispatch helper + `sync-template` route

**Files:**
- Modify: `lib/registry/types.ts` (add `InvalidRepoUrlError`)
- Modify: `lib/http.ts` (map it to 400)
- Create: `lib/git/miniapp-dispatch.ts` (`parseRepo` + `dispatchMiniappWorkflow`)
- Modify: `app/api/miniapps/[id]/deploy/route.ts` (use the helper; re-export `parseRepo`)
- Create: `app/api/miniapps/[id]/sync-template/route.ts`
- Test: `app/api/__tests__/sync-template-route.test.ts`

**Interfaces:**
- Produces: `parseRepo(url: string | undefined): { owner: string; repo: string } | null`
- Produces: `dispatchMiniappWorkflow(id: string, workflow: string): Promise<{ actionsUrl: string }>` — loads the registry, resolves the miniapp's repo, dispatches `workflow` on `main`, returns `{ actionsUrl }`. Throws `MiniappNotFoundError` (404) or `InvalidRepoUrlError` (400).
- Consumes: `getStore` (`@/lib/registry/store`), `getMiniappDetail` (`@/lib/registry/registry`), `githubProvider`/`githubToken` (`@/lib/git/github`, `@/lib/config`).

- [ ] **Step 1: Write the failing test**

Create `app/api/__tests__/sync-template-route.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Registry } from "@/lib/registry/types";

const state = vi.hoisted(() => ({ reg: {} as Registry }));
const dispatchSpy = vi.hoisted(() => vi.fn());

vi.mock("@/lib/registry/store", () => ({
  getStore: () => ({ load: async () => state.reg, save: async () => {} }),
}));
vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/git/github", () => ({
  githubProvider: () => ({ createFromTemplate: vi.fn(), dispatchWorkflow: dispatchSpy }),
}));

import { POST } from "@/app/api/miniapps/[id]/sync-template/route";
import { auth } from "@/auth";

const authMock = auth as unknown as ReturnType<typeof vi.fn>;
const ADMIN = "dentvega";

function req(): Request {
  return new Request("http://x/api/miniapps/acc/sync-template", { method: "POST" });
}
const params = { params: Promise.resolve({ id: "acc" }) };

beforeEach(() => {
  process.env.GITHUB_TOKEN = "test-token";
  process.env.SCAFFOLD_ALLOWED_LOGINS = ADMIN;
  authMock.mockResolvedValue({ githubLogin: ADMIN });
  dispatchSpy.mockReset().mockResolvedValue(undefined);
  state.reg = {
    acc: {
      id: "acc" as never,
      name: "Acc",
      owner: "DentVega",
      versions: [],
      repoUrl: "https://github.com/DentVega/miniapp-acc",
    },
  } as unknown as Registry;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.SCAFFOLD_ALLOWED_LOGINS;
});

describe("POST /api/miniapps/:id/sync-template", () => {
  it("dispatches template-sync.yml for an allowlisted user (202)", async () => {
    const res = await POST(req(), params);
    expect(res.status).toBe(202);
    expect(dispatchSpy).toHaveBeenCalledWith({
      owner: "DentVega",
      repo: "miniapp-acc",
      workflow: "template-sync.yml",
      ref: "main",
    });
  });

  it("rejects a login not on the allowlist (403, no dispatch)", async () => {
    authMock.mockResolvedValue({ githubLogin: "mallory" });
    expect((await POST(req(), params)).status).toBe(403);
    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown miniapp", async () => {
    state.reg = {} as Registry;
    expect((await POST(req(), params)).status).toBe(404);
  });

  it("returns 400 when the miniapp has no repo URL", async () => {
    (state.reg.acc as { repoUrl?: string }).repoUrl = "not a url";
    expect((await POST(req(), params)).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run app/api/__tests__/sync-template-route.test.ts`
Expected: FAIL — cannot resolve `@/app/api/miniapps/[id]/sync-template/route`.

- [ ] **Step 3: Add `InvalidRepoUrlError`**

In `lib/registry/types.ts`, after the `InvalidManifestError` class, add:

```ts
export class InvalidRepoUrlError extends Error {
  readonly code = "INVALID_REPO_URL";
  constructor(id: string) {
    super(`Miniapp "${id}" has no valid GitHub repo URL.`);
    this.name = "InvalidRepoUrlError";
  }
}
```

- [ ] **Step 4: Map it to 400**

In `lib/http.ts`, add `InvalidRepoUrlError` to the import from `./registry/types` and add this line to `statusForError`, right after the `InvalidManifestError` line:

```ts
  if (err instanceof InvalidRepoUrlError) return 400;
```

- [ ] **Step 5: Create the shared helper**

Create `lib/git/miniapp-dispatch.ts`:

```ts
import { getStore } from "@/lib/registry/store";
import { getMiniappDetail } from "@/lib/registry/registry";
import { InvalidRepoUrlError } from "@/lib/registry/types";
import { githubProvider } from "@/lib/git/github";
import { githubToken } from "@/lib/config";

/** Parse `owner/repo` from a GitHub repo URL (https or ssh, optional `.git`). */
export function parseRepo(
  url: string | undefined,
): { owner: string; repo: string } | null {
  if (url === undefined) return null;
  const m = url.match(/github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/);
  return m ? { owner: m[1]!, repo: m[2]! } : null;
}

/**
 * Resolve a miniapp's repo and dispatch one of its workflows on `main`.
 * Shared by the deploy (ci.yml) and sync-template (template-sync.yml) routes.
 * Throws MiniappNotFoundError (404) or InvalidRepoUrlError (400).
 */
export async function dispatchMiniappWorkflow(
  id: string,
  workflow: string,
): Promise<{ actionsUrl: string }> {
  const reg = await getStore().load();
  const detail = getMiniappDetail(reg, id); // throws MiniappNotFoundError
  const repo = parseRepo(detail.repoUrl);
  if (repo === null) throw new InvalidRepoUrlError(id);

  await githubProvider(githubToken()).dispatchWorkflow({
    owner: repo.owner,
    repo: repo.repo,
    workflow,
    ref: "main",
  });
  return { actionsUrl: `${detail.repoUrl}/actions` };
}
```

- [ ] **Step 6: Create the `sync-template` route**

Create `app/api/miniapps/[id]/sync-template/route.ts`:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { dispatchMiniappWorkflow } from "@/lib/git/miniapp-dispatch";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

/**
 * POST /api/miniapps/:id/sync-template — trigger the miniapp's `template-sync.yml`
 * (`workflow_dispatch`) to 3-way merge the current template and open a PR. Auth: an
 * allowlisted session (same as deploy). No secrets — the workflow uses GITHUB_TOKEN.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const { id } = await params;
    const { actionsUrl } = await dispatchMiniappWorkflow(id, "template-sync.yml");
    return NextResponse.json({ dispatched: true, actionsUrl }, { status: 202 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
```

- [ ] **Step 7: Run the new test to verify it passes**

Run: `npx vitest run app/api/__tests__/sync-template-route.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 8: Refactor `deploy/route.ts` onto the helper (DRY)**

Replace the entire body of `app/api/miniapps/[id]/deploy/route.ts` with:

```ts
import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { dispatchMiniappWorkflow } from "@/lib/git/miniapp-dispatch";
import { scaffoldAllowedLogins } from "@/lib/config";
import { canScaffold, ScaffoldForbiddenError } from "@/lib/scaffold-authz";
import { errorBody, statusForError } from "@/lib/http";

export const runtime = "nodejs";

// Re-exported for existing tests that import parseRepo from here.
export { parseRepo } from "@/lib/git/miniapp-dispatch";

/**
 * POST /api/miniapps/:id/deploy — trigger the miniapp's CI (`ci.yml`,
 * `workflow_dispatch`) to build the chunk and publish a new version. Auth: an
 * allowlisted session. The CI publishes back using the repo's BACKSTAGE_URL +
 * PUBLISH_TOKEN secrets.
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const session = await auth();
    if (!canScaffold(session?.githubLogin, scaffoldAllowedLogins())) {
      throw new ScaffoldForbiddenError();
    }
    const { id } = await params;
    const { actionsUrl } = await dispatchMiniappWorkflow(id, "ci.yml");
    return NextResponse.json({ dispatched: true, actionsUrl }, { status: 202 });
  } catch (err) {
    return NextResponse.json(errorBody(err), { status: statusForError(err) });
  }
}
```

- [ ] **Step 9: Run deploy + sync tests together**

Run: `npx vitest run app/api/__tests__/deploy-route.test.ts app/api/__tests__/sync-template-route.test.ts`
Expected: PASS (deploy: 6 tests still green via the helper; sync: 4).

- [ ] **Step 10: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 11: Commit**

```bash
git add lib/registry/types.ts lib/http.ts lib/git/miniapp-dispatch.ts \
  app/api/miniapps/\[id\]/deploy/route.ts \
  app/api/miniapps/\[id\]/sync-template/route.ts \
  app/api/__tests__/sync-template-route.test.ts
git commit -m "feat(sync): sync-template route + shared dispatchMiniappWorkflow helper"
```

---

## Task 2: "Actualizar desde template" button

**Files:**
- Create: `app/components/SyncTemplateButton.tsx`
- Modify: `app/miniapp/[id]/page.tsx` (render it in the `canPublish` block)

**Interfaces:**
- Consumes: `POST /api/miniapps/:id/sync-template` (from Task 1) → `{ dispatched, actionsUrl }`.
- Produces: `<SyncTemplateButton id={string} />`.

- [ ] **Step 1: Create the component**

Create `app/components/SyncTemplateButton.tsx` (mirrors `DeployButton.tsx`):

```tsx
"use client";

import { useState } from "react";

type State =
  | { status: "idle" }
  | { status: "syncing" }
  | { status: "done"; actionsUrl: string }
  | { status: "error"; message: string };

/**
 * Dispatches the miniapp's template-sync.yml — a 3-way merge of the current
 * template that opens a PR. Session-authorized (allowlist); rendered only for
 * those logins on the detail page.
 */
export function SyncTemplateButton({ id }: { id: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function onSync() {
    setState({ status: "syncing" });
    try {
      const res = await fetch(`/api/miniapps/${id}/sync-template`, { method: "POST" });
      const body = (await res.json()) as { actionsUrl?: string; error?: string };
      if (!res.ok) {
        setState({ status: "error", message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({ status: "done", actionsUrl: body.actionsUrl ?? "" });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "error" });
    }
  }

  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 440 }}>
      <p className="field-hint" style={{ color: "var(--faint)", margin: 0 }}>
        Hace un merge 3-way del template actual y abre un PR (no toca tu código).
      </p>
      <button type="button" onClick={onSync} disabled={state.status === "syncing"}>
        {state.status === "syncing" ? "Disparando sync…" : "Actualizar desde template"}
      </button>
      {state.status === "done" ? (
        <p role="status" style={{ color: "var(--good, green)" }}>
          ✓ Sync lanzado — revisa el PR.{" "}
          {state.actionsUrl ? (
            <a href={state.actionsUrl} target="_blank" rel="noopener noreferrer">
              Ver en GitHub Actions
            </a>
          ) : null}
        </p>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" style={{ color: "var(--bad, crimson)" }}>
          Error: {state.message}
        </p>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Import it in the detail page**

In `app/miniapp/[id]/page.tsx`, add after the `DeployButton` import (line 13):

```tsx
import { SyncTemplateButton } from "@/app/components/SyncTemplateButton";
```

- [ ] **Step 3: Render it in the `canPublish` block**

In `app/miniapp/[id]/page.tsx`, inside the `{canPublish ? (<>…</>) : null}` block, add a new section right after the Deploy `</section>` and before the "Publicar versión" section:

```tsx
          <section className="detail-section">
            <h2>Actualizar desde template</h2>
            <SyncTemplateButton id={id} />
          </section>
```

- [ ] **Step 4: Typecheck + build**

Run: `npx tsc --noEmit && npx next build`
Expected: no type errors; build succeeds.

- [ ] **Step 5: Commit**

```bash
git add app/components/SyncTemplateButton.tsx app/miniapp/\[id\]/page.tsx
git commit -m "feat(ui): 'Actualizar desde template' button on the miniapp detail page"
```

---

## Task 3: Template merge engine (`template-sync.yml` + `.templatesyncignore`)

**Files (in `/Volumes/SSDExterno/prodproyects/miniapp-template`):**
- Create: `.github/workflows/template-sync.yml`
- Create: `.templatesyncignore`

**Interfaces:**
- Consumes: `.template-sync` (`{ templateRepo, baseSha }`) present in the miniapp at run time (Task 4/5 provide it).
- Produces: a PR branch `sync/template-<shortsha>` with the merged tree + bumped `.template-sync`.

- [ ] **Step 1: Create `.templatesyncignore`**

Create `.templatesyncignore` in the template root:

```
# Miniapp-owned files — the sync must NEVER overwrite these.
src/Screen.tsx
manifest.json
README.md
README.es.md
.template-sync
```

- [ ] **Step 2: Create the workflow**

Create `.github/workflows/template-sync.yml`:

```yaml
name: Template sync

# 3-way merge of the current template into this miniapp, opened as a PR (Capa 2).
# Explicit merge-base = baseSha in .template-sync, because template-generated repos
# share no git ancestry with the template. Never overwrites files listed in
# .templatesyncignore. Dispatched on demand (e.g. from Backstage). No extra secrets.

on:
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

jobs:
  sync:
    # Never run on the template repo itself.
    if: ${{ !github.event.repository.is_template }}
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Read marker
        id: marker
        run: |
          set -euo pipefail
          if [ ! -f .template-sync ]; then
            echo "::error::.template-sync missing — this repo is not enrolled for template sync. Backfill it first."
            exit 1
          fi
          TEMPLATE_REPO="$(jq -r .templateRepo .template-sync)"
          BASE="$(jq -r .baseSha .template-sync)"
          echo "template_repo=$TEMPLATE_REPO" >> "$GITHUB_OUTPUT"
          echo "base=$BASE" >> "$GITHUB_OUTPUT"

      - name: Fetch template
        id: fetch
        run: |
          set -euo pipefail
          git remote add template "https://github.com/${{ steps.marker.outputs.template_repo }}.git"
          git fetch template main
          HEAD_SHA="$(git rev-parse template/main)"
          echo "head=$HEAD_SHA" >> "$GITHUB_OUTPUT"

      - name: 3-way merge (explicit base) + open PR
        env:
          GH_TOKEN: ${{ github.token }}
          BASE: ${{ steps.marker.outputs.base }}
          TEMPLATE_HEAD: ${{ steps.fetch.outputs.head }}
        run: |
          set -euo pipefail

          if [ "$BASE" = "$TEMPLATE_HEAD" ]; then
            echo "Template unchanged since baseSha — nothing to sync."
            exit 0
          fi

          git config user.name "backstage-template-sync"
          git config user.email "template-sync@users.noreply.github.com"

          SHORT="$(git rev-parse --short "$TEMPLATE_HEAD")"
          BRANCH="sync/template-$SHORT"

          # Real 3-way merge with an explicit merge-base. --write-tree emits the
          # merged tree OID (first line); on conflicts it still writes a tree whose
          # conflicted files contain <<<<<<< markers and exits non-zero.
          set +e
          MERGE_OUT="$(git merge-tree --write-tree --merge-base="$BASE" HEAD "$TEMPLATE_HEAD")"
          CONFLICTED=$?
          set -e
          TREE="$(echo "$MERGE_OUT" | head -n1)"

          # Materialize the merged tree onto a fresh branch off current HEAD.
          git switch -c "$BRANCH"
          git read-tree "$TREE"
          git checkout-index -a -f

          # Ignore-list: restore the miniapp's own version of protected paths.
          if [ -f .templatesyncignore ]; then
            while IFS= read -r line; do
              case "$line" in ''|\#*) continue ;; esac
              git checkout HEAD -- "$line" 2>/dev/null || true
            done < .templatesyncignore
          fi

          # Bump the marker to the newly-synced template SHA.
          jq --arg sha "$TEMPLATE_HEAD" '.baseSha = $sha' .template-sync > .template-sync.tmp
          mv .template-sync.tmp .template-sync

          git add -A
          if git diff --cached --quiet; then
            echo "No file changes after merge — nothing to open a PR for."
            exit 0
          fi

          if [ "$CONFLICTED" -ne 0 ]; then
            BODY="⚠️ Merge con **conflictos** — resuélvelos en este branch antes de mergear. Base \`$BASE\` → template \`$SHORT\`."
          else
            BODY="Merge 3-way limpio desde el template (\`$SHORT\`). Revisa el diff y el CI antes de mergear."
          fi

          git commit -m "sync: template @ $SHORT"
          git push -u origin "$BRANCH"
          gh pr create --title "Sync desde template @ $SHORT" --body "$BODY" \
            --base main --head "$BRANCH"
```

- [ ] **Step 3: Validate the workflow YAML locally**

Run: `python3 -c "import yaml,sys; yaml.safe_load(open('.github/workflows/template-sync.yml')); print('yaml ok')"`
Expected: `yaml ok`.

- [ ] **Step 4: Commit + push the template**

```bash
cd /Volumes/SSDExterno/prodproyects/miniapp-template
git add .github/workflows/template-sync.yml .templatesyncignore
git commit -m "feat(template): template-sync.yml (3-way merge PR) + .templatesyncignore"
git push origin main
```

Note: pushing a new workflow file needs a token with `workflow` scope; use the repo's normal git credentials (not the scaffolder PAT), as established earlier this project.

---

## Task 4: New scaffolds self-record `.template-sync`

**Files (in `/Volumes/SSDExterno/prodproyects/miniapp-template`):**
- Modify: `.github/workflows/init-template.yml`

**Interfaces:**
- Produces: a committed `.template-sync` file in every freshly-generated miniapp, with `baseSha` = the template's HEAD at init time.

- [ ] **Step 1: Add a marker-writing step**

In `.github/workflows/init-template.yml`, add this step between the "Substitute placeholders" step and the "Remove this workflow (one-shot)" step:

```yaml
      - name: Write template-sync marker
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          set -euo pipefail
          BASE="$(gh api repos/DentVega/miniapp-template/commits/main --jq .sha)"
          printf '{\n  "templateRepo": "DentVega/miniapp-template",\n  "baseSha": "%s"\n}\n' "$BASE" > .template-sync
          echo "wrote .template-sync baseSha=$BASE"
```

(The existing final "Commit" step runs `git add -A`, so the new `.template-sync` is committed with the init commit — no change needed there.)

- [ ] **Step 2: Validate the workflow YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/init-template.yml')); print('yaml ok')"`
Expected: `yaml ok`.

- [ ] **Step 3: Commit + push**

```bash
cd /Volumes/SSDExterno/prodproyects/miniapp-template
git add .github/workflows/init-template.yml
git commit -m "feat(template): init writes .template-sync marker for new scaffolds"
git push origin main
```

---

## Task 5: Backfill existing repos (hello_widget + cards_wallet)

**Files:** none in-repo here — operates on the two miniapp repos via fresh clones.

**Interfaces:**
- Consumes: `template-sync.yml` + `.templatesyncignore` from the template (Task 3), current template HEAD.
- Produces: both repos enrolled — each gets the two files + a `.template-sync` marker with `baseSha` = current template HEAD, committed + pushed.

- [ ] **Step 1: Backfill both repos**

Both repos are already at the current template state, so their baseSha is the template's current HEAD. Run:

```bash
SCR=/private/tmp/claude-501/-Volumes-SSDExterno-prodproyects-backstage-web/5db4d988-16f5-4dce-84c0-b911146cb07f/scratchpad
TPL=/Volumes/SSDExterno/prodproyects/miniapp-template
BASE="$(git -C "$TPL" rev-parse origin/main)"
for R in miniapp-hellow_widget miniapp-cards_wallet; do
  D="$SCR/backfill-$R"
  rm -rf "$D"
  git clone "https://github.com/DentVega/$R.git" "$D"
  cp "$TPL/.github/workflows/template-sync.yml" "$D/.github/workflows/template-sync.yml"
  cp "$TPL/.templatesyncignore" "$D/.templatesyncignore"
  printf '{\n  "templateRepo": "DentVega/miniapp-template",\n  "baseSha": "%s"\n}\n' "$BASE" > "$D/.template-sync"
  git -C "$D" add -A
  git -C "$D" commit -m "chore: enroll for template sync (Capa 2)"
  git -C "$D" push origin main
done
```

Expected: two pushes succeed. (These clones use normal git credentials, which can push workflow files — same as prior template pushes this project.)

- [ ] **Step 2: Verify enrollment**

Run:
```bash
for R in miniapp-hellow_widget miniapp-cards_wallet; do
  echo "== $R =="
  gh api "repos/DentVega/$R/contents/.template-sync" --jq '.content' | base64 -d
  gh api "repos/DentVega/$R/contents/.github/workflows/template-sync.yml" --jq '.name'
done
```
Expected: each prints a `.template-sync` JSON with the template HEAD sha and `template-sync.yml`.

---

## Task 6: End-to-end verification

**Files:** none — this validates the whole flow against live infra.

- [ ] **Step 1: Wait for Backstage prod to redeploy**

After Tasks 1–2 are pushed to `backstage-web` main, Vercel redeploys. Confirm:
```bash
cd /Volumes/SSDExterno/prodproyects/backstage-web
vercel ls backstage-web --prod 2>&1 | sed -n '5,7p'
```
Expected: latest Production deployment shows `Ready`.

- [ ] **Step 2: Make a trivial template infra change**

Add a harmless comment to a template-owned file so the sync has something to merge:
```bash
cd /Volumes/SSDExterno/prodproyects/miniapp-template
printf '\n// template-sync smoke test %s\n' "$(git rev-parse --short HEAD)" >> babel.config.cjs
git commit -am "chore: template smoke change for sync test"
git push origin main
```

- [ ] **Step 3: Dispatch the sync for cards_wallet**

```bash
gh workflow run template-sync.yml --repo DentVega/miniapp-cards_wallet --ref main
sleep 5
RID=$(gh run list --repo DentVega/miniapp-cards_wallet --workflow template-sync.yml --limit 1 --json databaseId -q '.[0].databaseId')
gh run watch "$RID" --repo DentVega/miniapp-cards_wallet --exit-status
```
Expected: run succeeds.

- [ ] **Step 4: Verify the PR is correct**

```bash
gh pr list --repo DentVega/miniapp-cards_wallet --state open
PR=$(gh pr list --repo DentVega/miniapp-cards_wallet --state open --json number -q '.[0].number')
gh pr diff "$PR" --repo DentVega/miniapp-cards_wallet
```
Expected: the diff shows the `babel.config.cjs` comment **and** the `.template-sync` baseSha bump, and does **not** touch `src/Screen.tsx` or `manifest.json`.

- [ ] **Step 5: Merge and confirm it still mounts**

Merge the PR (`gh pr merge "$PR" --repo DentVega/miniapp-cards_wallet --squash`), then follow the emulator flow from the session (relaunch host, open Cards Wallet) to confirm it still renders. Optionally re-deploy via the Deploy button to publish a fresh chunk.

- [ ] **Step 6: Clean up the smoke change**

```bash
cd /Volumes/SSDExterno/prodproyects/miniapp-template
git revert --no-edit HEAD   # revert the babel.config.cjs smoke comment
git push origin main
```

---

## Self-Review notes (author)

- **Spec coverage:** merge engine §3.1 → Task 3; ignore-list §3.2 → Task 3 Step 1; button + route §3.3 → Tasks 1–2; activation §3.4 (new scaffolds) → Task 4, (backfill) → Task 5; error cases §6 (no-op, conflicts, missing marker) → Task 3 Step 2 logic; testing §7 → Task 1 tests + Task 6 e2e; order §9 → Tasks 1–6.
- **No new secrets:** confirmed — `template-sync.yml` uses `github.token`.
- **Type consistency:** `dispatchMiniappWorkflow(id, workflow)` and `parseRepo` names/signatures match across Tasks 1–2 and both routes.
