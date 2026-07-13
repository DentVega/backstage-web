# Testing Standards

> Applied during the Construction **Test** stage.
>
> **Scope note:** This repo (control-plane) tests with **Vitest + React Testing
> Library** (web). The RNTL / agent-device layers below apply to the **mobile
> host / miniapp repos**. Use the layer that matches where the code lives.

## This repo — control-plane
- Tooling: **Vitest** (`pnpm test`, `vitest run`) + React Testing Library + jsdom.
- **Domain logic is unit-tested as pure functions** — registry resolution, semver-range matching, scaffold orchestration, authz. No renderer needed. This is the bulk of the 102 tests and the bar for new domain code.
- **Route handlers** get integration-style tests against the injected mocks (`git/mock`, `storage/mock`, registry store) — see `app/api/__tests__/`.
- **UI components** get RTL tests (`app/components/__tests__/`): query by role/accessible text; `getByTestId` last resort.
- A control-plane bolt is "done" only when `pnpm test` and `pnpm typecheck` are green.

## Mobile side — Layer 1: component / unit (`react-native-testing-library`)
- Jest + RNTL (skill auto-detects v13/v14). Query priority: `getByRole` > accessible > `getByTestId`.
- Use the `userEvent` API. v14: `render` is async — `await` it.
- Anti-patterns: wrapping everything in `act()`; side effects inside `waitFor`.
- **Every screen bolt ships at least one RNTL component test** for its main screen/flow — a screen bolt without one is NOT done.

## Mobile side — Layer 2: device E2E / smoke (`agent-device`)
- Drives a real simulator/emulator: snapshot → extract elements → tap/scroll/type (reference-based, not raw coordinates). Inspect (read-only) before acting.
- **Re.Pack-specific checks:** a remote chunk downloads and mounts, and the fallback path works when it can't. Run for user-facing flows before Operations.

## When to use which
- Control-plane logic/routes/components → Vitest (this repo).
- Mobile logic & component behavior → RNTL (Layer 1, CI).
- End-to-end flows, federation loading, native surfaces → agent-device (Layer 2).
