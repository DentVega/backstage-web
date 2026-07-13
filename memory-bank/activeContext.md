# Active Context

> **Agent note:** short-term memory. Read at session start; update after any important decision, focus change, or blocker.

## ⚠️ Source of truth
The **authoritative AI-DLC memory bank lives in the host monorepo**:
`/Volumes/SSDExterno/prodproyects/backstagereactnative/memory-bank/` (Intents 01–04).
This `backstage-web` repo was split out of that monorepo (Intent 01 Bolt 2). Its history —
registry→KV, Blob upload, scaffolder, auth UI — is tracked there under Intents 02/03/04.
**Do not plan new work here without checking the host memory bank first.** This file is a pointer.

## Current Focus
- **Unblock the native Android/iOS build** so a miniapp actually mounts on-device. This is the ONLY gap between "tests green" and "probar las miniapps" for real. Everything else in the loop (scaffold → CI build → publish → resolve → mount logic → fallback) is already built and tested.
- Tracked authoritatively in the host repo's `memory-bank/operations/activation-checklist.md`.

## Recent Technical Decisions (2026-07-13)
- Retired the redundant `miniapp-e2e-loop` Inception draft — the loop it described already exists (host Intents 01–03). Host memory bank is the single source of truth.
- Native build blocker diagnosed as **environment, not project** (a vanilla RN 0.76 also fails). Attacking the JDK first: installing **Temurin 17** to swap off Zulu 17 (AGP provider-bug suspect #1). Fallback levers: JDK 21, reinstall Android SDK to a standard path, or build via Android Studio.
- iOS: `pod install` likely unblocked now (ruby 3.3.5 + CocoaPods 1.16.2 present).

## Known Issues / Blockers
- **Android `assembleDebug` fails** with a `MissingValueException` in `compileDebugJavaWithJavac` — env-level, not our code (see host `operations/activation-checklist.md`).
- Chunk integrity is a deliberate no-op (`IntegrityVerifier`, ADR-008) — crypto deferred to Operations.
- Real Vercel deploy is manual (needs the user's account).

## Immediate Next Step
- Point `JAVA_HOME` at Temurin 17 and re-run `./gradlew assembleDebug` in `apps/host`; if it compiles, `pnpm android` to mount the miniapp on the connected device (`29171FDH300ESL`).
