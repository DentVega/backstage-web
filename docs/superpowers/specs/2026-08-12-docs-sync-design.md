# docs-sync — hook + skill para mantener la doc al día — Design

**Fecha:** 2026-08-12
**Estado:** Aprobado (listo para plan)
**Repo:** `backstage-web` (el `.claude/` vive acá; el hook mira también repos hermanos)
**Owner:** <owner>

---

## Goal

Que la documentación (`backstage-web/docs/*.md`, que alimenta el sitio `/docs`) no se
desincronice del código a medida que cambia el proyecto. Dos piezas que trabajan juntas:
un **hook** que **detecta** el drift y avisa, y un **skill** que **hace la actualización
bien** (verificando contra el código). Ambos comparten una **fuente única**: el docs-map.

## Componentes

1. **`.claude/docs-map.json`** — la fuente única: mapea patrones de código → docs afectadas.
2. **`.claude/hooks/docs-drift.mjs`** + wiring en `.claude/settings.json` — el hook que detecta.
3. **`.claude/skills/docs-sync/SKILL.md`** — la procedura para actualizar.

Todo vive en `backstage-web/.claude/` y se commitea al repo.

---

## 1. `.claude/docs-map.json` — el docs-map

Estructura: una lista de reglas. Cada regla tiene `paths` (globs relativos a
`backstage-web/`, con `../` para repos hermanos), y **o** `docs` (docs a revisar) **o**
`action` (un comando a correr, ej. re-sincronizar), más `why`.

```json
{
  "rules": [
    { "paths": ["app/api/**/route.ts"], "docs": ["docs/API-REFERENCE.md"], "why": "endpoints" },
    { "paths": ["lib/registry/types.ts"], "docs": ["docs/API-REFERENCE.md", "docs/PLATFORM-OVERVIEW.md"], "why": "schemas + conceptos" },
    { "paths": ["lib/registry/registry.ts"], "docs": ["docs/API-REFERENCE.md"], "why": "resolve/publish + errores" },
    { "paths": ["lib/http.ts"], "docs": ["docs/API-REFERENCE.md"], "why": "tabla de códigos de error" },
    { "paths": ["lib/scaffold-authz.ts", "lib/auth-paths.ts"], "docs": ["docs/INTEGRATION-GUIDE.md", "docs/API-REFERENCE.md"], "why": "auth/ownership" },
    { "paths": ["lib/config.ts"], "docs": ["docs/SETUP.md", "docs/API-REFERENCE.md"], "why": "env vars" },
    { "paths": ["lib/storage/**"], "docs": ["docs/SETUP.md"], "why": "selección de storage" },
    { "paths": ["../backstagereactnative/apps/host/shared-deps.mjs"], "docs": ["docs/INTEGRATION-GUIDE.md", "docs/PLATFORM-OVERVIEW.md"], "why": "Host Contract / singletons" },
    { "paths": ["../backstagereactnative/packages/miniapp-contract/src/types.ts"], "docs": ["docs/API-REFERENCE.md", "docs/PLATFORM-OVERVIEW.md", "docs/INTEGRATION-GUIDE.md"], "why": "Manifest/contract" },
    { "paths": ["../backstagereactnative/apps/host/RUN.md"], "action": "pnpm sync:host-docs", "docs": ["docs/HOST-RUN.md"], "why": "espejo del host" },
    { "paths": ["../backstagereactnative/docs/mounting-miniapps.md"], "action": "pnpm sync:host-docs", "docs": ["docs/HOST-MOUNTING.md"], "why": "espejo del host" },
    { "paths": ["../miniapp-template/scripts/publish.mjs", "../miniapp-template/.github/workflows/publish.yml"], "docs": ["docs/INTEGRATION-GUIDE.md", "docs/QUICKSTART.md", "docs/miniapps-guide.md"], "why": "flujo de publish" }
  ]
}
```

Principio: **alto-señal** — solo paths cuyo cambio suele implicar un cambio de doc. No
vigilar componentes de UI internos ni tests. La lista se mantiene: al agregar un doc o un
área de código nueva, se suma una regla (el skill lo recuerda).

## 2. El hook — `PostToolUse` sobre `git commit`

**Por qué `PostToolUse`-en-commit y no `Stop`:** en este workflow se **commitea dentro del
turno**, así que el momento correcto de chequear es justo después de un commit. `PostToolUse`
puede inyectar `additionalContext` (que Claude ve, **sin bloquear**) — mejor que un `Stop`
que forzaría continuar. (Refinamiento del diseño que decía "Stop"; misma intención: detectar
drift sobre lo recién commiteado.)

**Wiring** (`.claude/settings.json`):
```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "Bash", "hooks": [ { "type": "command", "command": "node .claude/hooks/docs-drift.mjs" } ] }
    ]
  }
}
```

**`.claude/hooks/docs-drift.mjs`** (Node, sin deps):
1. Lee el JSON del hook por stdin. Si `tool_input.command` **no** contiene `git commit`, sale silencioso (exit 0).
2. Para cada repo vigilado (backstage-web = `.`; y los hermanos que aparecen en el docs-map: `../backstagereactnative`, `../miniapp-template`): obtiene los archivos del **último commit** con `git -C <repo> show --name-only --format= HEAD` (+ el SHA de HEAD).
3. Dedup: lee `.claude/.docs-drift-state.json` (git-ignored) con el último SHA avisado por repo. Si el HEAD de todos los repos ya fue avisado, sale.
4. Mapea los archivos cambiados contra las reglas del docs-map (glob match, con los `../` resueltos por repo). Junta las `docs` y `action` afectadas.
5. Excluye las docs que **también** cambiaron en ese mismo commit (no hay drift si ya se tocaron).
6. Si queda algo: imprime `{"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": "⚠ Docs drift: el commit tocó <paths> → revisá <docs> (por: <why>). Corré el skill /docs-sync."}}` y guarda el/los SHA en el state. Si no, exit 0 sin output.

**Robustez:** todo best-effort — si un `git` falla (repo hermano ausente, etc.) se ignora
esa parte, nunca rompe el flujo (siempre exit 0). El state file evita re-avisar el mismo commit.

## 3. El skill — `.claude/skills/docs-sync/SKILL.md`

Procedura para actualizar la doc **bien**. Estructura (frontmatter `name: docs-sync`,
`description: …`):

1. **Cuándo usarlo:** después de implementar un cambio que afecta comportamiento documentado,
   o cuando el hook avisó drift. (Anunciar "usando docs-sync".)
2. **Detectar el alcance:** `git diff --name-only` del rango relevante (el/los commits desde la
   última sync de docs, o el working tree) en backstage-web + los repos hermanos del docs-map.
3. **Mapear:** por cada archivo cambiado, consultar `.claude/docs-map.json` → docs/acciones.
4. **Actualizar con precisión:** por cada doc afectada, **leer el código real Y la sección del
   doc**, verificar que coincidan, y corregir. Precisión > velocidad — nunca adivinar shapes,
   endpoints ni valores.
5. **Espejos del host:** si cambió un source espejado (RUN.md / mounting-miniapps.md), correr
   `pnpm sync:host-docs`.
6. **Doc nuevo:** si se agregó un `.md` a `docs/`, cablearlo en `lib/docs/nav.ts` (grupo + slug).
7. **Verificar + commit:** `pnpm build` (valida que el sitio renderiza) y commit de las docs.

El skill **referencia el docs-map** como su tabla de mapeo (no lo duplica).

---

## Verificación

- **Hook detecta:** commitear un cambio en `app/api/**/route.ts` sin tocar docs → el próximo
  paso de Claude ve el `additionalContext` de drift nombrando `API-REFERENCE.md`. Commitear
  tocando también `docs/API-REFERENCE.md` → sin aviso. Un segundo commit idéntico de SHA ya
  avisado → sin re-aviso (dedup).
- **Hook no-intrusivo:** un commit que no toca paths del docs-map → sin output. Un `git status`
  (no-commit) → sin output. Falla de `git` en un repo hermano → no rompe (exit 0).
- **Skill:** invocar `/docs-sync` tras un cambio → detecta, mapea, actualiza la doc correcta
  (verificada contra el código), corre `sync:host-docs` si aplica, y buildea OK.
- **docs-map válido:** JSON parseable; los `docs` apuntan a archivos existentes.

## Fuera de alcance (YAGNI)

- Actualización 100% automática sin humano (el skill lo hace Claude, con revisión).
- Un hook en el repo del host (`backstagereactnative/.claude`) — el de backstage-web ya nota
  los commits recientes del host la próxima vez que Claude trabaja acá.
- CI check (un GitHub Action que falle si hay drift) — posible follow-up, no ahora.
- Vigilar UI/tests/componentes internos (bajo-señal).

## Archivos afectados

- Crear: `.claude/docs-map.json`, `.claude/hooks/docs-drift.mjs`, `.claude/settings.json`,
  `.claude/skills/docs-sync/SKILL.md`, `.gitignore` (+= `.claude/.docs-drift-state.json`).
