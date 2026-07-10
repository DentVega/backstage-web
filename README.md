# Backstage Web

"Spotify for miniapps" — registro y distribución de miniapps para el host React Native + Re.Pack.
**Repositorio separado** del monorepo móvil (otro equipo, CI/CD y deploy propios).

## Acoplamiento con el móvil
El único acoplamiento es el contrato **`@org/miniapp-contract`**:
- **Dev:** dependencia `file:` al paquete del monorepo → hay que **compilar el contrato primero**:
  ```bash
  # en el monorepo móvil
  pnpm --filter @org/miniapp-contract build
  # luego aquí
  pnpm install
  ```
- **Prod:** GitHub Packages (ADR-002).

## Scripts
- `pnpm dev` — servidor de desarrollo.
- `pnpm build` / `pnpm start` — build y arranque de producción.
- `pnpm test` — Vitest (dominio del registry + Route Handlers + CatalogList).
- `pnpm typecheck` — `tsc --noEmit`.

## API
- `POST /api/miniapps` — registrar una miniapp `{ id, name, owner }`.
- `POST /api/miniapps/:id/publish` — publicar versión `{ version, url, manifest }`.
- `GET /api/resolve?id=&version=&range=` — el host resuelve qué montar → `ResolveResponse`.
- `GET /catalog` — catálogo (UI).

## Store
JSON en fs (`data/registry.json`) detrás de `RegistryStore` (MVP, ADR-006). Swappable por SQLite/DB.
`data/registry.json` viene sembrado con la miniapp `account_dashboard` del Bolt 3.
