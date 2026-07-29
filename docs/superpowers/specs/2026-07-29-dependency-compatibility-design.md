# Gestión de compatibilidad de dependencias (Host Contract + gates)

**Fecha:** 2026-07-29
**Estado:** Diseño aprobado — listo para plan de implementación
**Owner:** DentVega
**Roadmap:** nuevo (🔴 estabilidad de plataforma) — complementa la estrategia anti-drift

## 1. Contexto y objetivo

En una arquitectura de miniapps federadas (Module Federation + React Native), un
autor de miniapp puede subir la versión de `react-native` o agregar librerías, y
esos cambios pueden **romper contra el host** o ser incompatibles. Queremos un
flujo **automatizado** que impida que una miniapp incompatible llegue al usuario.

### La verdad de RN que enmarca todo

`react` y `react-native` (y varios más) son **singletons que provee el host**. En
runtime la miniapp **recibe la versión del host**, no la suya. Además, **el código
nativo no viaja en el chunk JS** — está compilado en el binario del host. Por eso
el problema se parte en dos fallas:

- **Falla A — bump de un singleton compartido.** El autor sube `react-native` a
  0.77 y usa APIs nuevas → en runtime recibe el 0.76 del host → rompe.
- **Falla B — agrega una librería NATIVA** que el host no tiene → el módulo nativo
  no existe en el binario → crash ("native module not found"). Una lib **pure-JS**
  se bundlea en el chunk y es inofensiva.

### Qué ya existe (cimientos)

- `@dentvega/miniapp-contract` expone `satisfiesShared(hostProvided, manifest.shared)`
  → `SkewResult { compatible, entries[] }` con `ok | missing | incompatible`
  (`packages/miniapp-contract/src/shared.ts`). Función pura, portable.
- El host **ya la corre en runtime** antes de montar
  (`packages/host-runtime/src/evaluate.ts:27`) — última red en el device.
- `Manifest { id, version, entry, shared, capabilities, integrity }`
  (`miniapp-contract/src/types.ts`).

### Los huecos (lo que falta)

1. **No hay gate al publicar.** Backstage no valida compatibilidad en el upload; una
   miniapp incompatible entra al catálogo y recién falla en el celular del usuario.
2. **El `manifest.shared` se escribe a mano** (`manifest.json` del repo, leído por
   `miniapp-template/scripts/publish.mjs`). Si el autor sube RN en `package.json`
   sin tocar el manifest → el manifest miente.
3. **No hay un contrato del host canónico.** Las versiones del host están duplicadas
   en 3 lados (host `rspack.config`, `DEFAULT_SHARED` de Backstage
   `lib/manifest.ts:9`, runtime `hostProvided`) → pueden divergir.
4. **Las libs nativas nuevas no se detectan** (Falla B totalmente descubierta).

## 2. Decisiones tomadas

1. **Gate duro al publicar** (falla el CI de la miniapp + rechaza el upload en
   Backstage). Nada incompatible llega al catálogo.
2. **Libs nativas:** el host declara su capability set nativo; el gate detecta libs
   fuera del set vía autolinking de RN, **bloquea**, y **abre un pedido automatizado**
   (issue/PR contra el host). La release del host es el único paso humano.
3. **Gate simétrico de gobernanza del host:** todo cambio de deps en el host se gatea
   en su propio CI contra la flota de miniapps publicadas (blast-radius), con branch
   protection para que no se pueda saltear — ni a mano ni por un agente de IA.

### Refinamientos (review de completitud, 2026-07-29)

4. **Semver real:** el gate usa la lib `semver` (`satisfies()`), no el `satisfiesRange`
   mínimo actual (que solo entiende `exact/^/~/*` y daría falsos incompatibles con
   rangos reales `>=x <y`, `||`, `1.x`). El mínimo se queda para el badge; el GATE usa
   semver real.
5. **Auth del contract = admin, no el token compartido.** `PUT /api/host-contract` se
   valida con un `HOST_CONTRACT_TOKEN` **dedicado**, sembrado SOLO en el CI del host —
   nunca distribuido a las miniapps. Un contract equivocado bloquea/habilita todo, así
   que su publicación no puede depender del `PUBLISH_TOKEN` que tiene cada repo.
6. **Política de derivación del manifest, explícita:** `requiredRange` se deriva del
   **lockfile** (versión resuelta real, no el rango de `package.json`) como
   `^<versión>`. Para deps `0.x` (react-native) el caret bloquea el minor (semántica
   npm: `^0.76.6` ⇒ `>=0.76.6 <0.77.0`) — exactamente lo que querés para RN.
7. **Backfill de la flota (prerequisito real).** Los manifests publicados hoy tienen
   `shared` vacío → los gates y el blast-radius serían vacíos hasta re-publicar. El
   rollout incluye re-publicar todas las miniapps (vía el Deploy/dispatch existente)
   para que carguen su `shared` derivado. **Regla dura:** un manifest **sin `shared`
   se trata como "at-risk" (no provable-compatible)**, nunca como compatible vacuo.
8. **Módulos nativos versionados.** Los natives que exponen API JS
   (`react-native-screens`, `safe-area-context`, `reanimated`) pasan a ser
   **shared singletons con versión** (hoy faltan en el `shared` del host) → chequeo de
   skew. `nativeModules` (name-only) queda solo para natives sin API JS.
9. **Versión del host en el mundo real — límite conocido con red.** El resolve NO usa
   `hostVersion` hoy; los usuarios corren binarios de host viejos. Se hace lo mínimo
   correcto: el manifest declara `minHostContract` (RN/contractVersion mínimo que
   necesita) y el **runtime guard del host viejo lo frena** (muestra "necesitás
   actualizar", no crashea). El **resolve-por-hostVersion** (servir la última versión
   de la miniapp compatible con el host del usuario) se difiere y se ata a
   rollback/pinning (roadmap #10) — documentado, no olvidado.

10. **Construcción en 4 fases** (cada una entrega valor sola).

## 3. Arquitectura

### 3.1 Host Platform Contract — única fuente de verdad

Un `host-contract.json`, **auto-generado desde el build del host**:

```json
{
  "contractVersion": "1.0.0",
  "reactNative": "0.76.6",
  "shared": {
    "react": "18.3.1",
    "react-native": "0.76.6",
    "@tanstack/react-query": "5.51.0",
    "@shopify/flash-list": "1.7.1"
  },
  "nativeModules": [
    "react-native-screens",
    "react-native-safe-area-context",
    "react-native-reanimated"
  ]
}
```

- **`shared`**: nombre → versión concreta instalada, de los singletons declarados en
  el `ModuleFederationPluginV2({ shared })` del host. Generado leyendo la config MF +
  las versiones resueltas (no hardcodeado).
- **`nativeModules`**: el capability set nativo, enumerado con **`npx react-native
  config`** (autolinking) sobre el host — la lista de módulos nativos que el binario
  linkea. Es la misma herramienta que se usa del lado de la miniapp (§3.3.B),
  simétrica.
- **`contractVersion`**: SemVer que bumpea cuando cambia la plataforma (bump de RN,
  módulo nativo agregado/quitado).

- **`shared`** incluye ahora los natives con API JS (`react-native-screens`,
  `safe-area-context`, `reanimated`) — hoy faltan en el `shared` del host; se agregan
  para que tengan chequeo de versión (decisión §2.8). `nativeModules` queda para
  natives sin API JS (presencia only).

**Publicación:** el **CI del host** genera el contract en cada release y lo sube a
Backstage vía `PUT /api/host-contract`, validado con un **`HOST_CONTRACT_TOKEN`
dedicado** (sembrado solo en el CI del host, nunca en las miniapps — decisión §2.5).
Backstage lo guarda en KV y lo sirve en `GET /api/host-contract`.

### 3.2 Manifest que no puede mentir

El publish CI de la miniapp **deriva `manifest.shared` de las deps reales**,
intersectando con `host.shared`: para cada dep de la miniapp que el host comparte,
emite `{ name, requiredRange: "^" + <versión resuelta del LOCKFILE>, singleton: true }`
(política §2.6 — del lockfile, no del rango de package.json). Si el autor sube RN a
0.77, el manifest generado dice `react-native ^0.77.0` → el gate lo compara contra el
host 0.76 con semver real → incompatible.

El manifest también declara **`minHostContract`** (el `contractVersion`/`reactNative`
mínimo contra el que se construyó, §2.9) para que un host viejo pueda rechazar con
gracia. **Regla dura (§2.7):** un manifest **sin `shared`** se trata como *at-risk*
(no provable-compatible) en todo chequeo — nunca como compatible vacuo.

### 3.3 Cuatro puntos de enforcement (defensa en capas)

**A) Gate en el CI de publish (Capa 1 reusable) — el principal.**
Un paso nuevo en el **workflow reutilizable** del template → aplica a TODAS las
miniapps sin tocar cada repo. Un script `scripts/check-compat.mjs`:
```
1. fetch GET {BACKSTAGE_URL}/api/host-contract
2. lee deps de la miniapp (package.json/lockfile) + módulos nativos autolinkeados
   (npx react-native config → deps con platforms.android/ios != null)
3. SHARED SKEW: checkCompatibility(contract, manifestShared)  [reusa satisfiesShared]
4. NATIVO: cada módulo nativo de la miniapp que NO esté en contract.nativeModules
5. incompatible/missing → exit 1 con reporte claro (+ dispara el pedido, Fase 3)
6. ok → escribe el manifest.shared truthful y sigue al publish
```

**B) Gate server-side en `/upload` (belt & suspenders).**
`app/api/miniapps/[id]/upload/route.ts`, antes de publicar: corre
`checkCompatibility(storedHostContract, manifest.shared)` + check nativo (si el
manifest declara módulos nativos). Incompatible → **422** con el detalle. Atrapa lo
que evada el CI.

**C) Runtime guard (YA existe — alinear).**
`host-runtime/evaluate.ts` ya corre `satisfiesShared`. Se alinea para que su
`hostProvided` derive del mismo contract (el host puede leer su propio
`host-contract.json` embebido). Última red en el device.

**D) Flujo de capability nativa (automatizado, Fase 3).**
Al detectar una lib nativa faltante, el gate abre/actualiza un **pedido trackeable**
(issue o PR contra el repo del host) con el contexto (miniapp + versión + lib),
usando la infra `GitProvider` de Backstage. Plataforma agrega la lib + release del
host + regenera el contract → el próximo publish de la miniapp pasa.

### 3.4 Lógica compartida (en el contract package)

Para reusar en CI + upload + runtime, se extiende `@dentvega/miniapp-contract`:
```ts
export interface HostContract {
  contractVersion: string;
  reactNative: string;
  shared: Readonly<Record<string, string>>;   // name → concrete version
  nativeModules: readonly string[];
}
export interface NativeCheckResult {
  compatible: boolean;
  missing: readonly string[];                  // native modules not in the host
}
export function checkNativeModules(
  hostNativeModules: readonly string[],
  miniappNativeModules: readonly string[],
): NativeCheckResult;

export interface CompatReport {
  compatible: boolean;
  skew: SkewResult;                            // de satisfiesShared
  native: NativeCheckResult;
}
export function checkCompatibility(
  contract: HostContract,
  miniappShared: readonly SharedDepSpec[],
  miniappNativeModules: readonly string[],
): CompatReport;
```
`checkCompatibility` compone `satisfiesShared(contract.shared, miniappShared)` +
`checkNativeModules(contract.nativeModules, miniappNativeModules)`.

El chequeo de rangos dentro de `satisfiesShared` pasa a usar la lib **`semver`**
(`satisfies()`) en vez del `satisfiesRange` mínimo (§2.4). El mínimo se mantiene solo
para el badge de drift (no-gate). Esto suma `semver` como dep del contract package
(justificado: es EL estándar, y el package deja de ser "cero deps" solo por esto).

### 3.5 Gate de gobernanza del host (protege el eje)

Los 4 puntos de §3.3 validan **miniapp → host**. Pero el host es el eje: un cambio
de sus deps (bump de un singleton, quitar una lib nativa) puede **romper TODAS las
miniapps publicadas de una**. Este gate valida la dirección inversa: **host → flota**.

Corre en el **CI del repo del host**, en **todo PR que toque deps**
(`package.json` / lockfile / la config `shared` de MF):
```
1. regenera el host-contract CANDIDATO (del PR) con gen-host-contract.mjs
2. fetch el contract PUBLICADO (GET /api/host-contract)
3. fetch los manifests de la flota (GET /api/manifests — latest de cada miniapp)
4. BLAST-RADIUS: para cada manifest, checkCompatibility(candidato, manifest)
5. "breaking" ≡ ∃ miniapp que pasa de compatible → incompatible con el candidato
6. breaking → falla el CI del PR con la lista de miniapps afectadas y por qué
              (ej. "react-native 0.76→0.77 rompe: hello_widget (^0.76), cards_wallet (^0.76)")
   safe     → pasa; el diff sugiere el bump de contractVersion (major si breaking-aceptado)
```

**Clasificación (para el reporte humano):**

| Cambio en el contract | Veredicto |
|---|---|
| Agregar shared dep / módulo nativo nuevo | **safe** (solo expande capability) |
| Bump de versión dentro de los rangos declarados por la flota | **safe** |
| Bump de singleton fuera del rango de ≥1 miniapp | **breaking** |
| Remover un módulo nativo que ≥1 miniapp usa | **breaking** |
| Remover / bajar major-minor de un shared | **breaking** |

La definición operativa es el **blast-radius**: breaking ⇔ el candidato vuelve
incompatible a alguna miniapp hoy compatible. La tabla es solo para explicar el
porqué en el reporte.

**Por qué controla "con o sin IA":** el check es **automático en cada PR** de deps y,
con **branch protection** (el check obligatorio para mergear), **no se puede saltear**
— ni un humano apurado ni un agente. Un breaking change exige una **decisión
consciente** (migrar las miniapps afectadas, o aprobar el break con un label
explícito tipo `accept-breaking-contract` que el gate reconoce y deja pasar dejando
registro).

Reusa todo lo ya diseñado: el mismo `checkCompatibility`, `gen-host-contract.mjs`, y
los manifests que ya viven en el registry.

## 4. Fases

### Fase 1 — Contract + manifest truthful + gate de skew (cierra Falla A)

**Contract package** (`backstagereactnative/packages/miniapp-contract`):
- Agregar `HostContract` type + `minHostContract` al `Manifest` + tests.
- **`satisfiesShared` pasa a usar `semver.satisfies`** (§2.4); el `satisfiesRange`
  mínimo se conserva solo para el badge de drift.
- (El `checkNativeModules`/`checkCompatibility` se agregan en Fase 2; en Fase 1 el
  gate usa `satisfiesShared` directo.)

**Host** (`backstagereactnative/apps/host`):
- `scripts/gen-host-contract.mjs`: lee la config MF `shared` + versiones instaladas
  → escribe `host-contract.json` (sin `nativeModules` aún; campo `[]`).
- Agregar los natives con API JS (`screens`, `safe-area-context`, `reanimated`) al
  `shared` del host (§2.8) para que entren al contract con versión.

**Backstage** (`backstage-web`):
- `PUT /api/host-contract` (auth **`HOST_CONTRACT_TOKEN` dedicado**, §2.5) → guarda el
  contract en KV.
- `GET /api/host-contract` → lo sirve (o 404 si no hay).
- `lib/host-contract/` (store + tipos), reusa el patrón de `lib/registry`.
- `lib/manifest.ts`: `DEFAULT_SHARED` deja de estar hardcodeado — deriva del
  contract guardado (fallback al valor actual si no hay contract).

**Template CI** (`miniapp-template`):
- `scripts/gen-manifest-shared.mjs`: deriva `manifest.shared` del **lockfile** ∩
  contract.shared como `^<versión resuelta>` (§2.6), + `minHostContract`.
- `scripts/check-compat.mjs` (skew only en Fase 1): fetch contract + `satisfiesShared`
  (semver) → exit 1 si incompatible. Fail-closed si no hay contract (§5).
- Cablear ambos en el workflow reutilizable de publish.

**Backstage upload** (`backstage-web`):
- `/upload`: correr `satisfiesShared(contract.shared, manifest.shared)` → 422 si
  incompatible. Un manifest **sin `shared` → at-risk**, se rechaza (§2.7), no pasa vacuo.

**Backfill de la flota (§2.7):** re-publicar todas las miniapps existentes (vía el
Deploy/dispatch ya existente) para que sus manifests carguen el `shared` derivado —
sin esto los gates y el blast-radius (Fase 4) están vacíos. Se hace en el rollout
(§8), en modo warn primero.

### Fase 2 — Detección de libs nativas + bloqueo (cierra Falla B core)

**Contract package:** `checkNativeModules` + `checkCompatibility` + tests.

**Host:** `gen-host-contract.mjs` ahora popula `nativeModules` vía
`npx react-native config` (deps con config nativa android/ios).

**Template CI:** `check-compat.mjs` enumera los módulos nativos de la miniapp
(mismo `react-native config`) y usa `checkCompatibility` → bloquea si falta alguno.

**Backstage upload:** usa `checkCompatibility` completo (skew + nativo). El manifest
gana un campo opcional `nativeModules: string[]` (lo que la miniapp autolinkea) para
que el server pueda validar sin re-ejecutar autolinking.

### Fase 3 — Pedido automatizado + surfacing

**Template CI / Backstage:** al fallar por lib nativa, abrir/actualizar un pedido
(issue o PR) contra el repo del host vía `GitProvider` (nuevo método
`openCapabilityRequest` o reuso de `createPullRequest`/issues API).

**Backstage (opcional, YAGNI-check):** una vista de "pedidos de capability
pendientes" en la UI. Se evalúa al llegar a la fase; si agrega mucho, se difiere.

### Fase 4 — Gate de gobernanza del host (protege el eje, §3.5)

**Backstage** (`backstage-web`):
- `GET /api/manifests` → devuelve el manifest de la última versión de cada miniapp
  del registry (para el blast-radius). Reusa `getStore().load()` + el `latestVersion`
  que ya existe.

**Host** (`backstagereactnative/apps/host`):
- `scripts/check-host-compat.mjs`: regenera el contract candidato
  (`gen-host-contract.mjs`), fetch el contract publicado + `GET /api/manifests`, corre
  `checkCompatibility` por miniapp → exit 1 con la lista si hay breaking; respeta el
  label/flag `accept-breaking-contract` como override explícito (con log).
- `.github/workflows/host-compat.yml`: corre `check-host-compat.mjs` en PRs que toquen
  `package.json`/lockfile/`rspack.config.mjs`.

**Governance (repo del host):** marcar el check `host-compat` como **required** en la
branch protection de `main` (paso manual documentado, como el permiso de Actions PRs).

## 5. Manejo de errores (invariantes)

- **Fail-closed en el gate de CI:** si no se puede fetchear el contract (Backstage
  caído, red), el gate **falla el build** (no publica sin validar). Escape hatch:
  una var `SKIP_COMPAT_CHECK=1` documentada para emergencias, que loguea un warning
  ruidoso. El gate server-side de `/upload` es el backstop.
- **Contract ausente:** si Backstage no tiene contract publicado aún, `GET
  /api/host-contract` → 404; el gate lo trata como fail-closed (bloquea) con mensaje
  "el host todavía no publicó su contract". (En la transición, se publica el contract
  del host ANTES de activar el gate — ver orden de deploy.)
- **Nunca romper el catálogo:** el `/upload` que rechaza devuelve 422 con detalle; no
  afecta el resto del registry.
- **Runtime:** el guard existente sigue fail-soft (no monta incompatibles, muestra
  mensaje) — no se toca su comportamiento observable.

## 6. Testing

- **Contract package:** `checkNativeModules` (missing/ok), `checkCompatibility`
  (skew ok + native missing → incompatible; ambos ok → compatible). `HostContract`
  type guard. **`satisfiesShared` con semver real:** rangos `>=x <y`, `||`, `1.x`
  ahora resuelven bien (regresión del `satisfiesRange` mínimo).
- **At-risk / auth (§2.5, §2.7):** manifest sin `shared` → tratado como incompatible en
  `/upload` y blast-radius, nunca compatible vacuo; `PUT /api/host-contract` → 401 sin
  `HOST_CONTRACT_TOKEN`, 200 con él (y el `PUBLISH_TOKEN` de miniapp NO alcanza).
- **Derivación (§2.6):** `gen-manifest-shared` con un lockfile fixture → `^<resuelta>`;
  bump de RN en el lockfile se refleja en el rango + `minHostContract`.
- **gen-host-contract.mjs:** dado un config MF fixture + versiones → emite el JSON
  esperado; con un `react-native config` fixture → popula `nativeModules`.
- **gen-manifest-shared.mjs:** package.json fixture ∩ contract → manifest.shared
  derivado correcto (incluye el bump del autor).
- **check-compat.mjs:** contract + deps compatibles → exit 0; skew incompatible →
  exit 1; lib nativa faltante → exit 1; `SKIP_COMPAT_CHECK=1` → exit 0 con warning.
- **Backstage:** `PUT/GET /api/host-contract` (auth 401 sin token, 200 con token,
  round-trip); `/upload` rechaza 422 un manifest con skew/nativo incompatible, 201 el
  compatible; `DEFAULT_SHARED` deriva del contract guardado con fallback.
- **Fase 3:** el pedido se abre con el contexto correcto (mock `GitProvider`); no se
  duplica si ya existe uno abierto para la misma lib.
- **Fase 4:** `GET /api/manifests` devuelve el latest de cada miniapp;
  `check-host-compat.mjs` con fixtures: contract candidato safe → exit 0; candidato
  que baja RN con una miniapp en `^0.76` → exit 1 con esa miniapp en la lista;
  candidato safe (agrega nativo) → exit 0; override `accept-breaking-contract` →
  exit 0 con warning y registro.

## 7. Estructura de archivos (resumen por repo)

**`backstagereactnative/packages/miniapp-contract`:** `src/host-contract.ts`
(tipos + `checkNativeModules` + `checkCompatibility`), tests. Re-publicar el paquete.

**`backstagereactnative/apps/host`:** `scripts/gen-host-contract.mjs`, `host-contract.json`
(generado), alinear `evaluate.ts` para leer del contract; `scripts/check-host-compat.mjs`
+ `.github/workflows/host-compat.yml` (Fase 4).

**`backstage-web`:** `lib/host-contract/{types,store}.ts`,
`app/api/host-contract/route.ts` (GET+PUT), `app/api/manifests/route.ts` (GET, Fase 4),
`lib/manifest.ts` (DEFAULT_SHARED del contract),
`app/api/miniapps/[id]/upload/route.ts` (gate).

**`miniapp-template`:** `scripts/gen-manifest-shared.mjs`, `scripts/check-compat.mjs`,
workflow reutilizable de publish (cablear los pasos).

## 8. Orden de deploy (evitar romper publishes existentes)

1. Publicar el contract package nuevo + host genera y publica su `host-contract.json`
   a Backstage.
2. Deploy de Backstage con los endpoints + gate en `/upload` **en modo warn** (loguea
   pero no rechaza) — validación en sombra.
3. **Backfill de la flota (§2.7):** re-publicar todas las miniapps existentes para que
   carguen su `shared` derivado. Verificar en sombra que cada una queda compatible
   (o migrarla si no). Hasta acá el blast-radius y los gates están vacíos.
4. Cablear el gate en el CI del template (fail-closed).
5. Cuando todo esté verde en sombra, `/upload` pasa a rechazar (422).
6. (Fase 4) Marcar `host-compat` como required en la branch protection del host.

## 9. Fuera de alcance (YAGNI)

- **Release automática del host.** Es decisión humana (agregar código nativo + QA).
- **Dedup/optimización de deps pure-JS.** El bundling actual alcanza.
- **Análisis de compatibilidad transitiva profunda** (deps de deps nativas). Se
  chequea el set autolinkeado, que es la superficie real.

### Diferidos "con los ojos abiertos" (review de completitud — verlos después)

Documentados para no olvidarlos; NO se construyen en estas 4 fases:

- **Resolve por `hostVersion`** (servir la última versión de la miniapp compatible con
  el binario de host del usuario). Mitigado por `minHostContract` + runtime guard
  (§2.9); la solución completa se ata a rollback/pinning (roadmap #10).
- **Trust boundary de `/upload`:** si se evade el CI y se POStea un manifest que miente
  sobre su `shared`, el server no puede re-derivar sin el fuente. Protección real =
  manifest derivado-en-CI + integridad. (Review #7)
- **Natives requeridos dinámicamente** (require por nombre sin ser paquete
  autolinkeado) — el autolinking no los ve. (Review #8)
- **Rollback/versionado del contract guardado** si el host publica uno con bug.
  (Review #9)
- **Feedback local (`pnpm check-compat` / pre-push)** antes de pushear. (Review #10)
- **Métricas de decisiones del gate** (ata con roadmap #12); **badge de contract-drift**
  en Backstage (distinto del template-drift #7); **integración con el bootstrap** de
  adopción (el `gen-host-contract` en el flujo de la empresa nueva). (Review #12-14)

## 10. Riesgos / dependencias

- **Precisión del autolinking:** `react-native config` es la fuente canónica, pero su
  output puede variar por versión de RN. El generador del host y el checker de la
  miniapp usan la misma mecánica → simétrico. Se testea con fixtures.
- **Coordinación multi-repo:** el orden de deploy (§8) evita ventanas rotas.
- **Testing de detección nativa sin device:** se testea con fixtures del output de
  `react-native config`, no con un build real (fuera de alcance del unit test).
