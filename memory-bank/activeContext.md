# Active Context

> **Agent note:** short-term memory. Read at session start; update after any important decision, focus change, or blocker.

## ⚠️ Source of truth
The **authoritative AI-DLC memory bank lives in the host monorepo**:
`/Volumes/SSDExterno/prodproyects/backstagereactnative/memory-bank/` (Intents 01–04).
This `backstage-web` repo was split out of that monorepo (Intent 01 Bolt 2). Its history —
registry→KV, Blob upload, scaffolder, auth UI — is tracked there under Intents 02/03/04.
**Do not plan new work here without checking the host memory bank first.** This file is a pointer.

## Current Focus (2026-07-17)
- **LIVE en producción:** `backstage-web-blond.vercel.app` (Next.js 16 en Vercel). Registry en **Upstash Redis**, chunks en **Vercel Blob** (CDN público), integridad **sha256** real. Validado end-to-end en dispositivo.
- Esta sesión se cerró todo el loop: build nativo desbloqueado, mount on-device, login GitHub, crear miniapps (scaffolder), **publicar versión desde la UI** (nueva feature aquí), storage de prod, integridad, deploy.
- **Único pendiente formal:** publicar el contrato `@org/miniapp-contract` → `@dentvega/miniapp-contract` a GitHub Packages (esperando PAT `write:packages`) + quitar el `file:`/vendor de este repo.
- Detalle completo en el memory-bank autoritativo del host (`backstagereactnative/memory-bank/{activeContext,progress,audit}.md`).

## Recent Technical Decisions (2026-07-13)
- Retired the redundant `miniapp-e2e-loop` Inception draft — the loop it described already exists (host Intents 01–03). Host memory bank is the single source of truth.
- Native build blocker diagnosed as **environment, not project** (a vanilla RN 0.76 also fails). Attacking the JDK first: installing **Temurin 17** to swap off Zulu 17 (AGP provider-bug suspect #1). Fallback levers: JDK 21, reinstall Android SDK to a standard path, or build via Android Studio.
- iOS: `pod install` likely unblocked now (ruby 3.3.5 + CocoaPods 1.16.2 present).

## Known Issues / Blockers
- **Android `assembleDebug` fails** with a `MissingValueException` in `compileDebugJavaWithJavac` — env-level, not our code (see host `operations/activation-checklist.md`).
- Chunk integrity is a deliberate no-op (`IntegrityVerifier`, ADR-008) — crypto deferred to Operations.
- Real Vercel deploy is manual (needs the user's account).

## Immediate Next Step
- Publicar el contrato a GitHub Packages como `@dentvega/miniapp-contract` (rename `@org`→`@dentvega` en los 4 repos + publish + backstage-web consume el publicado y borra `vendor/`). Requiere PAT con `write:packages`.
- Follow-ons: Home dinámico del host (catálogo), `@dentvega/ui-kit` publicado, iOS en device.
