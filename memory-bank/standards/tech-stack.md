# Tech Stack

> Read by every AI-DLC agent before acting. Keep current.
>
> **Scope note:** This repo (`backstage-web`) is the **web control-plane** for a
> React Native + Re.Pack federation — the registry, scaffolder, and distribution
> API. It is **not** the mobile host. The RN/Re.Pack section below describes the
> *system it serves*, so contracts stay compatible; the "This repo" section is
> what actually runs here.

## This repo — control-plane (authoritative)
- **Framework:** Next.js 16 (App Router, RSC) — **read `node_modules/next/dist/docs/` before writing code; this Next has breaking changes vs. training data** (see `AGENTS.md`).
- **Language:** TypeScript (strict).
- **Auth:** Auth.js v5 (`next-auth@5.0.0-beta.31`), GitHub OAuth. Access token stays server-side.
- **Registry store:** JSON file (`data/registry.json`) in dev; **Upstash Redis** (`@upstash/redis`) in prod — injectable `RegistryStore`.
- **Chunk storage:** local `public/chunks` (fs) in dev; **Vercel Blob** (`@vercel/blob`) in prod — selected by `BLOB_READ_WRITE_TOKEN`. Injectable `ChunkStorage`.
- **Git provider:** GitHub REST (`repos/{template}/generate`) — injectable `GitProvider`.
- **Shared contract:** `@org/miniapp-contract` (vendored at `./vendor/miniapp-contract`) — the ONLY coupling between web and mobile. Versioned.
- **Test:** Vitest + React Testing Library + jsdom. `pnpm test` (102 tests).
- **Package manager:** pnpm (workspace).
- **Deploy:** Vercel. See `DEPLOY.md`.

## System it serves — RN mobile federation (for compatibility only)
- **Framework:** React Native (New Architecture / Fabric + TurboModules).
- **Bundler:** **Re.Pack** (Rspack) — **NOT Metro**. Do not generate Metro config for the host/remotes.
- **Code splitting:** Module Federation v2 — host app + on-demand remote chunks (Hermes bytecode).
- Lists: **FlashList**. Navigation: native navigators. State: TBD in the host repo (not this one).

## Federation boundaries
- **Host bundle:** core nav, auth, shared UI, the resolver client that calls `GET /api/resolve`.
- **Federated remotes (miniapps):** e.g. `account_dashboard`, `cards_wallet` — each its own repo, own CI, downloaded on demand.
- **Shared singletons across chunks:** react, react-native, navigation, and stateful libs (react-query, stores) — pinned in every container's `shared` list. The registry manifest records each miniapp's `shared` requirements.

## Config / env (control-plane)
- `AUTH_SECRET`, `AUTH_GITHUB_ID`, `AUTH_GITHUB_SECRET` — auth (set).
- `SCAFFOLD_ALLOWED_LOGINS` (CSV) — who may scaffold; **empty = nobody (fail-closed)**.
- `GITHUB_TOKEN` (`repo` scope) — create repos from template.
- `MINIAPP_TEMPLATE_REPO` — the Re.Pack template to generate from (currently placeholder `org/miniapp-template`).
- `PUBLISH_TOKEN` — Bearer token CI uses to upload builds.
- `BLOB_READ_WRITE_TOKEN`, Upstash Redis vars — prod storage.

## Performance budget (mobile side, for manifests)
- Target FPS 60. Host chunk kept lean; heavy features are remotes. TTI / host-chunk ceiling: TBD in host repo.
