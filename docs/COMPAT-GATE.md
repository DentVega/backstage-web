# Compat gate

El compat gate es el mecanismo automático que impide que la flota de
miniapps y el host móvil se desincronicen sin que nadie lo note. No es un
gate — son **dos**, espejados, uno en cada dirección: uno protege al host de
una miniapp que pide algo que el host no da; el otro protege a la flota
publicada de un host que cambia sus deps debajo suyo. Los dos comparan
contra el mismo documento, el [Host Contract](/docs/host-contract), y los
dos comparten la misma lógica de comparación (`satisfiesShared`,
`checkCompatibility`, del paquete `@dentvega/miniapp-contract`). Si estás
depurando por qué un publish falló, o por qué un PR de deps del host no
mergea, este es el doc.

> [!NOTE]
> Para la guía operacional de cómo **activar** estos gates la primera vez
> (secrets, backfill, verificación) ver
> [Compat gates — runbook](/docs/compat-gates). Este doc explica **qué
> hacen y por qué**, no cómo prenderlos.

## Los dos gates, en una tabla

| | Gate 1 — Compat gate (publish) | Gate 2 — Blast-radius (`findNewlyBroken`) |
|---|---|---|
| **Dónde corre** | `POST /api/miniapps/:id/upload` (Backstage), cada vez que una miniapp publica | CI del repo del host (`backstagereactnative`), en cada PR que toca deps |
| **Pregunta que responde** | ¿Esta miniapp que se está publicando es compatible con el host de HOY? | ¿Este cambio de deps del host rompe alguna miniapp que YA está publicada? |
| **Compara** | `manifest.shared` / `manifest.nativeModules` de la miniapp vs. el Host Contract publicado | Host Contract publicado (baseline) vs. Host Contract candidato (lo que generaría el PR) |
| **Función clave** | `satisfiesShared` (vía el gate del `/upload` en `backstage-web`) | `findNewlyBroken` (en `apps/host/scripts/check-host-compat.mjs`) |
| **Código de error** | `COMPAT_INCOMPATIBLE`, HTTP 422 | Falla la CI (exit 1), bloquea el merge |
| **Override de emergencia** | Bajar `COMPAT_ENFORCE` a `0` (temporal) | Label `accept-breaking-contract` en el PR |
| **Sin contrato publicado** | Skip — loguea y no bloquea (rollout-safe) | Skip — "no hay baseline" (rollout-safe) |

También existe una **tercera instancia** del mismo chequeo, más temprana:
`scripts/check-compat.mjs` en el propio repo de cada miniapp (parte del
`miniapp-template`), que corre en su CI **antes** de publicar. Es la primera
línea de defensa — le avisa al equipo de la miniapp en su propio PR, antes
de que Backstage llegue a rechazar el `/upload`. La lógica es la misma
(`checkSkew` + `checkNatives`, comparando contra `GET /api/host-contract`),
solo que corre en otro repo.

## Gate 1 — Compat gate en el publish

Vive en `app/api/miniapps/[id]/upload/route.ts`, dentro del handler `POST`.
Corre en cada publish, después de subir los chunks pero antes de escribir la
versión en el registry:

1. Carga el Host Contract publicado (`getHostContractStore().load()`). Si
   no hay ninguno publicado todavía, **loguea y sigue** — no bloquea (el
   sistema es rollout-safe: sin contrato no hay contra qué comparar).
2. Si el manifest trae `shared` vacío, lo marca como "at-risk" (no puede
   verificar nada — probablemente un manifest viejo/hand-written).
3. Si trae `shared`, corre `satisfiesShared(contract.shared, m.shared)` —
   la misma función descripta en
   [Host Contract § cómo `satisfiesShared` decide compatibilidad](/docs/host-contract).
   Cada entrada que no quede `ok` se junta en `compatProblems`.
4. Chequea `nativeModules`: cualquier nativo que la miniapp declare y el
   host **no** tenga en su `HostContract.nativeModules` se suma a
   `compatProblems` — y además dispara `openCapabilityRequests`, que abre
   (o reutiliza, con dedup) un issue en el repo del host pidiendo ese
   módulo, con el label `capability-request`. Esto es best-effort: si falla
   abrir el issue, se loguea y no aborta el publish.
5. Si `compatProblems` no está vacío, decide según `COMPAT_ENFORCE`:

```ts
const compatEnforce = process.env.COMPAT_ENFORCE === "1";
if (compatProblems.length > 0) {
  const mode = compatEnforce ? "ENFORCE → rechazando (422)" : "warn mode, not blocking";
  console.warn(`compat[${id}@${version}]: INCOMPATIBLE with host — ${compatProblems.join(", ")} [${mode}]`);
  if (compatEnforce) {
    return NextResponse.json(
      { error: `incompatible with host contract — ${compatProblems.join(", ")}`, code: "COMPAT_INCOMPATIBLE" },
      { status: 422 },
    );
  }
}
```

> [!IMPORTANT]
> El nombre real de la env var es **`COMPAT_ENFORCE`**, leída directo de
> `process.env` en el handler (no pasa por `lib/config.ts`). El valor que
> activa enforce es exactamente el string `"1"` — cualquier otro valor
> (incluido `"true"`) deja el gate en warn.

Todo el bloque de chequeo está envuelto en un `try/catch` que loguea y
**no bloquea** si el chequeo mismo revienta — un bug del gate nunca debe
tumbar un publish legítimo; solo una incompatibilidad real detectada debe
bloquear.

### WARN vs ENFORCE

| Modo | `COMPAT_ENFORCE` | Comportamiento |
|---|---|---|
| **WARN** (default) | no seteada, o cualquier valor ≠ `"1"` | Loguea `compat[id@version]: INCOMPATIBLE ... [warn mode, not blocking]` y el publish **sigue** normalmente (201) |
| **ENFORCE** | `"1"` | El publish se **rechaza** con `422` y `{ error, code: "COMPAT_INCOMPATIBLE" }` |

El mismo interruptor existe, con el mismo nombre, en dos lugares más:

- **`scripts/check-compat.mjs`** (CI de cada miniapp) — mismo patrón: sin
  `COMPAT_ENFORCE=1`, avisa y sale con código 0; con la var, sale con código
  1 y falla el build.
- **`apps/host/scripts/check-host-compat.mjs`** (blast-radius, ver abajo) —
  usa su propio interruptor, `ACCEPT_BREAKING`, no `COMPAT_ENFORCE` (ese
  gate por diseño siempre bloquea salvo override explícito por PR).

Encender `COMPAT_ENFORCE=1` en producción (Vercel env de `backstage-web`) es
el **Paso 5.3** del runbook de activación — ver
[Compat gates — runbook](/docs/compat-gates) para la secuencia completa
(por qué conviene hacerlo último, después de backfill y validación en
sombra).

## Gate 2 — Blast-radius (`findNewlyBroken`)

Vive en `apps/host/scripts/check-host-compat.mjs`, en el repo del host. Es
el gate de **gobernanza**: corre en la CI cuando un PR toca las deps del
host (bump de una lib compartida, agregar/quitar un nativo), y responde una
pregunta que el Gate 1 no puede responder — Gate 1 solo ve una miniapp *en
el momento en que publica*; este gate ve **toda la flota ya publicada**
contra un contrato que todavía no existe (el candidato del PR).

```js
export function findNewlyBroken(publishedContract, candidateContract, manifests) {
  const broken = [];
  for (const m of manifests) {
    const shared = m.shared ?? [];
    const natives = m.nativeModules ?? [];
    const was = checkCompatibility(publishedContract, shared, natives).compatible;
    const now = checkCompatibility(candidateContract, shared, natives).compatible;
    if (was && !now) {
      const report = checkCompatibility(candidateContract, shared, natives);
      const reason = [
        ...report.skew.entries.filter((e) => e.status !== "ok").map((e) => `${e.name} (${e.status})`),
        ...report.native.missing.map((n) => `${n} (native missing)`),
      ].join("; ");
      broken.push({ id: m.id, reason });
    }
  }
  return broken;
}
```

La definición de "romper" es precisa y deliberadamente estrecha: una
miniapp está "recién rota" solo si **era compatible con el contrato
publicado** (`was === true`) y **deja de serlo con el candidato**
(`now === false`). Una miniapp que ya era incompatible antes del PR no
cuenta — el gate no castiga al PR por un problema preexistente que no
causó.

El flujo completo, en `check-host-compat.mjs` como CLI:

1. Corre `gen-host-contract.mjs` de verdad para generar el contrato
   **candidato** — el que resultaría de mergear este PR (no un mock).
2. Trae el contrato **publicado** (baseline) de `GET /api/host-contract`.
   Si no hay ninguno todavía, **skip** — no hay transición que medir.
3. Trae la lista de manifests de toda la flota (`GET /api/manifests`). Si
   falla, **skip** (no bloquea por un problema de red).
4. Corre `findNewlyBroken(published, candidate, manifests)`.
5. Si la lista de rotas está vacía → verde. Si no:

```js
if (acceptBreaking) { console.warn(`${msg}\n[ACCEPT_BREAKING=true → allowed with record]`); process.exit(0); }
console.error(`${msg}\n[migrate them, or add the 'accept-breaking-contract' label to override]`);
process.exit(1);
```

Este gate **siempre bloquea por default** si detecta rotas — a diferencia
del Gate 1, no tiene un modo warn separado (`COMPAT_ENFORCE` no aplica acá).
El único override es explícito por PR: el label **`accept-breaking-contract`**
en GitHub, que deja pasar el merge **con registro** de quién lo aceptó (el
label queda en el historial del PR).

En la práctica, este check se conecta como **branch protection required
check** sobre `main` del repo del host (Paso 5.2 del runbook) — así un
cambio de deps que rompe la flota literalmente no se puede mergear sin la
decisión consciente de poner el label.

## Native modules: por qué no se pueden federar arbitrariamente

Un módulo nativo (código Android/iOS compilado, no solo JS) **no llega por
red** como el resto de un chunk de Module Federation — tiene que estar
compilado dentro del binario del host de antemano. Por eso el contrato no
trata los nativos como un rango de versión (como `shared`), sino como
**presencia binaria**: `HostContract.nativeModules` es una lista plana de
nombres, sin versión.

Ambos gates chequean lo mismo para nativos: ¿todo `nativeModules` que la
miniapp autolinkea está en `HostContract.nativeModules`? La comparación es
un set-difference simple (`checkNativeModules`, en `compat.ts`):

```ts
export function checkNativeModules(
  hostNativeModules: readonly string[],
  miniappNativeModules: readonly string[],
): NativeCheckResult {
  const host = new Set(hostNativeModules);
  const missing = miniappNativeModules.filter((m) => !host.has(m));
  return { compatible: missing.length === 0, missing };
}
```

Si una miniapp necesita un nativo que el host no tiene:

- El **Gate 1** (publish) lo marca incompatible y, automáticamente, abre
  (o reutiliza, con dedup) un **GitHub issue** en el repo del host —
  `openCapabilityRequests` — con el label `capability-request`, pidiendo que
  se agregue esa dependencia nativa. Esto es **coordinación**, no un bypass:
  la miniapp sigue bloqueada (en ENFORCE) hasta que el host efectivamente
  compile ese nativo y publique un contrato nuevo que lo incluya.
- El **Gate 2** (blast-radius) detecta el caso simétrico: si un PR del host
  **quita** un nativo (por ejemplo, deprecarlo), y alguna miniapp publicada
  lo usa, ese PR queda marcado como rotura — no se puede mergear sin el
  label de excepción.

> [!WARNING]
> No hay forma de "declarar" un nativo nuevo y que el gate lo acepte por
> confianza. La única vía es que el host lo compile de verdad, lo autolinkee,
> y `gen-host-contract.mjs` lo detecte vía `react-native config` — el
> contrato nunca miente sobre lo que el binario realmente trae (ver
> [Host Contract § cómo se genera](/docs/host-contract)).

## Diagnosticar un fallo del gate

**Si tu publish de miniapp vuelve `422` con `code: "COMPAT_INCOMPATIBLE"`:**

1. Leé el mensaje de error — lista cada dep problemática con su estado
   (`incompatible, needs ^X.Y.Z` o `native module not in host`).
2. Consultá el Host Contract vigente:
   ```bash
   curl -s https://<tu-backstage>/api/host-contract | python3 -m json.tool
   ```
3. Para un skew de `shared`: tu `requiredRange` (auto-generado como
   `^<versión instalada>`) queda fuera de lo que el host provee. Alineá tu
   dependencia instalada a algo compatible y volvé a correr
   `gen-manifest-shared.mjs` antes de publicar — no edites `manifest.json`
   a mano.
4. Para un nativo faltante: coordiná con el equipo del host (el gate ya
   abrió el issue automáticamente) — no hay atajo del lado de la miniapp.
5. Mientras tanto, si el gate está en modo **WARN** (default), el publish
   de todos modos pasa — el `422` solo ocurre con `COMPAT_ENFORCE=1`
   activo en Backstage.

**Si un PR de deps del host falla en `check-host-compat` (blast-radius):**

1. El mensaje lista qué miniapps quedarían rotas y por qué (mismo formato
   de `reason` que el Gate 1).
2. Opción A — coordinar la migración: avisale al equipo de cada miniapp
   rota que actualice su dependencia antes de que tu cambio se mergee.
3. Opción B — aceptar el break conscientemente: agregá el label
   `accept-breaking-contract` al PR. Queda registrado en el historial de
   GitHub quién lo puso y cuándo — es una decisión explícita, no un bypass
   silencioso.
4. Si el check dice "no hay contrato publicado — skipping" o "manifests
   fetch failed — skipping", no es un fallo real: el gate se saltea por
   falta de baseline (rollout-safe), revisá que `BACKSTAGE_URL` esté bien
   seteado en el workflow.

## Ver también

- [Host Contract](/docs/host-contract) — qué es el documento que ambos
  gates comparan, cómo se genera, y el shape real verificado.
- [Compat gates — runbook](/docs/compat-gates) — la secuencia operacional
  completa para encender el sistema (WARN → ENFORCE), secrets, backfill y
  validación en sombra.
- [Integration Guide](/docs/integration-guide) — guía para equipos externos
  que integran una miniapp nueva contra esta plataforma.
- [API Reference](/docs/api-reference) — schemas y tabla de códigos de
  error. Ojo: `COMPAT_INCOMPATIBLE` (422, este doc) es distinto de
  `NO_COMPATIBLE_VERSION` (404) — ese último es un error de **resolve**
  (`GET /api/resolve`, ninguna versión publicada satisface el `range` o
  `version` pedido), no del compat gate de Host Contract.
