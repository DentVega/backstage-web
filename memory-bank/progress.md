# Progress — `backstage-web` (pointer)

> **⚠️ Source of truth:** the authoritative AI-DLC tracker lives in the host monorepo:
> `/Volumes/SSDExterno/prodproyects/backstagereactnative/memory-bank/progress.md`
> (Intents 01–04). This repo was split out of that monorepo. Keep planning there;
> this file only records `backstage-web`-local state and points back.

## What this repo is
The Next.js control-plane (Registry, Scaffolder, Distribution API, Auth UI) for the
React Native + Re.Pack federation in the host monorepo. Coupled to the host only via
the versioned `@org/miniapp-contract`.

## Status (per host memory bank, 2026-07-13)
- **Creating miniapps: DONE + tested.** Scaffolder (`/api/scaffold` + `/create`), CI
  build→zip→publish (verified e2e local: `201`→resolve), Registry→KV, authenticated
  Blob upload. (Host Intents 02 + 03, MVP complete.)
- **Auth UI (Intent 04):** B1 login done; B2 registry metadata, B3 CI status, B4 detail/catalog UI planned.
- **Real Vercel deploy:** manual (needs the user's account).

## Current cross-repo focus
- **Unblock the native Android/iOS build** (host repo) so a miniapp mounts on-device —
  the only gap left to actually *run* a miniapp. Env-level blocker; see host
  `operations/activation-checklist.md`.

## Not tracked as bolts here
- All AI-DLC bolts are tracked in the host memory bank. This repo carries only the
  adapted `standards/` + these pointers.
