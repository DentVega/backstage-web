---
name: docs-sync
description: Use when code changed and the docs (backstage-web/docs/*.md that feed the /docs site) may be stale — after implementing a feature, or when the docs-drift hook flags it. Maps changed code to affected docs via .claude/docs-map.json and updates them verified against the code.
---

# docs-sync — mantener la doc al día

**Anunciá al empezar:** "Usando docs-sync para actualizar la documentación afectada."

Mantené `backstage-web/docs/*.md` (que alimentan el sitio `/docs`) en sync con el código.
La fuente del mapeo código→docs es `.claude/docs-map.json`.

## Procedura

1. **Detectar el alcance.** Mirá qué cambió: los commits recientes / el working tree que
   motivan la sync, en backstage-web **y** en los repos hermanos del docs-map
   (`../backstagereactnative`, `../miniapp-template`):
   ```bash
   git -C . show --name-only --format= HEAD
   git -C ../backstagereactnative show --name-only --format= HEAD   # si aplica
   ```
   (Si el hook de drift ya nombró docs concretas, usá esa lista como punto de partida.)

2. **Mapear.** Por cada archivo cambiado, buscá la regla que lo matchea en
   `.claude/docs-map.json` → obtené las `docs` a revisar y las `action` a correr.

3. **Actualizar con precisión.** Por cada doc afectada:
   - **Leé el código real Y la sección del doc.** Verificá que coincidan.
   - Corregí lo que quedó viejo. **Nunca adivines** shapes, endpoints, versiones ni valores —
     verificá contra el código. Precisión > velocidad.
   - Mantené el tono y el formato del doc (callouts `> [!TIPO]`, tabs `:::tabs`, tablas).

4. **Espejos del host.** Si cambió un source espejado (una regla con `action`), corré:
   ```bash
   pnpm sync:host-docs
   ```

5. **Doc nuevo.** Si agregaste un `.md` a `docs/`, cablealo en `lib/docs/nav.ts` (grupo + slug +
   blurb) — si no, no aparece en el sitio.

6. **Verificar + commit.**
   ```bash
   pnpm build   # valida que el sitio renderiza los .md sin romper
   git add docs/ lib/docs/nav.ts
   git commit -m "docs: sync con <lo que cambió>"
   ```

## Mantener el docs-map

Si aparece un área de código nueva que impacta docs (o una doc nueva), agregá una regla a
`.claude/docs-map.json` (alto-señal: solo lo que de verdad necesita doc).

## Qué NO hacer

- No reescribir docs enteras por un cambio chico — tocá solo lo afectado.
- No inventar contenido para "completar" — si no estás seguro, leé el código.
