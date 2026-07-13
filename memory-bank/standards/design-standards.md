# Design Standards

> Read during the Construction **Design** and **Implement** stages.
>
> **Scope note:** This repo ships a **web UI** (the "Registry Console" design
> system). The token/theming discipline below applies to both, but the concrete
> stack differs: web = CSS (globals + modules); the mobile host/miniapps = RN
> themed primitives. The token *principles* are shared; the *primitives* differ.

## Design tokens (single source of truth)
Define tokens once; never hardcode raw values in components.
- **Color:** semantic names, not raw hex — `background`, `surface`, `text`, `textMuted`, `primary`, `danger`, `border`. Each maps to a light and dark value.
- **Spacing:** a fixed scale (`xs 4 · sm 8 · md 12 · lg 16 · xl 24 · 2xl 32`). No arbitrary margins.
- **Typography:** a scale (`caption · body · title · heading · display`) with size + weight + line-height.
- **Radii / elevation:** a small fixed set.

## This repo — web ("Registry Console")
- Tokens live in the global stylesheet (`app/globals.css`) as CSS custom properties; components consume them via `page.module.css` / CSS modules — never inline raw hex.
- **Light/dark from day one:** a `ThemeToggle` exists; respect the OS `prefers-color-scheme` by default and allow an in-app override. Dark values must meet WCAG AA.
- Keep the console consistent: cards, badges (CI status), catalog list, detail — compose the existing shared components rather than one-off styles.

## Mobile side — RN themed primitives
- A single `ThemeProvider` exposes the active theme; components read tokens via `useTheme()`, never a raw palette.
- Wrap raw `Text`/`View`/`Pressable` in themed primitives (`AppText`, `Box`, `Button`, `Card`). Screens compose primitives, not raw components with inline styles.
- Styling approach: pick one (NativeWind or StyleSheet + tokens) and record it in `tech-stack.md`. Don't mix ad-hoc.

## Accessibility (baseline, both surfaces)
- Minimum touch/hit target **44×44 pt**.
- Every interactive element has an accessible label/role; meaningful images have labels.
- Text respects Dynamic Type / font scaling — avoid fixed heights that clip scaled text.
- WCAG AA contrast in **both** themes.

## Motion
- Web: prefer CSS transitions on cheap properties; respect `prefers-reduced-motion`.
- Mobile: animate only `transform` and `opacity` on the UI thread (Reanimated); respect "reduce motion".

## Fill in per project
- Icon set: `<TBD>`.
- Brand palette source: the "Registry Console" system (`app/globals.css`).
- Font family: `<system default currently>`.
