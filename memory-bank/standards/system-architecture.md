# System Architecture

> Set during Inception (system-context) and refined during Construction (Design + ADRs).

## Three planes
1. **Backstage Web (this repo)** — control-plane: Registry (source of truth), Scaffolder (repo-from-template), Distribution API (`/api/resolve`, `/api/miniapps/*`).
2. **Mobile Host (React Native + Re.Pack)** — boots the runtime, owns core nav + auth, calls `resolve(id, range)`, downloads + mounts remotes.
3. **Miniapp repos (one per miniapp)** — independently built/deployed remotes; their CI builds the federated chunk and `POST`s it to `/api/miniapps/:id/upload`.

```
Host --resolve(id,range)--> Backstage API --> Registry
Host <--{ chunk url, manifest }-- Backstage
Host --download+mount--> Federated chunk (Blob/CDN)
Scaffolder --generate--> Miniapp repo --CI publish--> Registry
```

## Module Federation topology (Re.Pack — the system this serves)
- **Host app:** boots runtime, owns core navigation + auth, resolves and mounts remotes, injects scoped capabilities.
- **Remotes:** independently buildable feature chunks, downloaded on demand.

## Rules
- The **only** coupling between web and mobile is the versioned `@org/miniapp-contract`. Keep it that way; don't leak web types into the host or vice versa.
- A feature that requires **native modules** cannot be a pure-JS remote — keep it in the host or a native-aware container. Record as an ADR.
- Remote chunk URLs are environment-aware (dev server vs. prod CDN/Blob).
- Always design a **graceful fallback** when a remote fails to download or resolve.
- **Version skew / shared-library rule:** host and all remotes share one identical `shared` list. Framework libs (react, react-native, navigation) AND stateful libs (data-cache client, stores, i18n, session) are `singleton: true` in every container — a per-remote copy of a stateful lib means split caches/sessions. The registry manifest records each version's `shared` requirements + `requiredRange`.
- **Resolution:** `/api/resolve` picks the highest version satisfying the requested exact version or semver range. Manifests carry `integrity` — the host verifies before mounting.

## Control-plane layering (this repo)
- **Domain** (`lib/registry`, `lib/scaffold`) — pure, framework-free, unit-tested.
- **Adapters** (`lib/git`, `lib/storage`, `lib/ci`) — injectable interfaces with real + mock impls.
- **Route handlers / UI** (`app/`) — thin; delegate to domain.

## ADRs
Each non-trivial architectural decision → `memory-bank/bolts/{bolt-id}/adr-NNN.md` (context / decision / consequences). Existing ADRs are referenced in code comments (e.g. ADR-015 for the CI upload contract) — migrate them here as bolts are formalized.
