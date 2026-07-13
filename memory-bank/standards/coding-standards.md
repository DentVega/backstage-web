# Coding Standards

> Applied during the Construction **Implement** stage.
>
> **Scope note:** This repo is the Next.js control-plane. The RN performance
> skills below apply when working in the **mobile host / miniapp repos**, not
> when writing control-plane code here. Both rulesets are kept so an agent that
> crosses the boundary knows which applies.

## Skill precedence (read first)

These standards reflect **project decisions** and override any installed skill:

1. When a skill **contradicts** these standards (or `tech-stack.md`), the **standards win**. Example: a skill suggesting Metro config for the mobile side — ignore it; we use Re.Pack.
2. When a skill **complements** these standards (e.g. an FPS optimization), follow it.
3. If a skill's advice would break an architectural rule (federation boundaries, native-module placement, or the `@org/miniapp-contract` coupling rule), do **not** apply it silently — raise it with the user.

## Control-plane (this repo) — rules
- **Read the local Next docs first.** `node_modules/next/dist/docs/` — this Next.js has breaking changes vs. training data (`AGENTS.md`). Heed deprecation notices.
- **Everything injectable stays injectable.** `GitProvider`, `ChunkStorage`, `RegistryStore`, `CiStatusProvider` are interfaces with real + mock impls. New external dependencies follow the same pattern so the system stays testable without cloud infra.
- **Domain logic is framework-free.** Registry/version-resolution/scaffold logic lives in `lib/` as pure functions (no Next, no network) and is unit-tested. Route handlers are thin adapters.
- **Auth token never reaches the browser.** GitHub access token stays server-side (route handlers / server components only).
- **Fail-closed on authorization.** Empty allowlist = deny (see `scaffold-authz`). Don't loosen a security default to make a demo work; gate it by env instead.
- **Errors go through `lib/http`** (`errorBody` / `statusForError`) for consistent status codes.
- Strict TypeScript. **No `any` in domain code.**

## Mobile side (host / miniapp repos) — RN perf skills (delimited triggers)

| Skill | When | Role |
|---|---|---|
| `vercel-react-native-skills` | While **writing** RN components | Prescriptive RN ruleset. The default. |
| `react-native-best-practices` | While **debugging** a measured problem | Diagnostic/profiling (jank, leaks, TTI). |
| `react-best-practices` (Vercel) | While writing **React-general** logic | Re-renders, data-fetching, waterfalls. |
| `composition-patterns` (Vercel) | While designing **reusable components** | Compound components, render props. |

Baseline (mobile): FlashList for lists; memoize list items + callbacks; animate only `transform`/`opacity` on the UI thread; native navigators; keep the host bundle lean (heavy features → remotes); pin shared singletons across chunks.
