# Host Contract

El Host Contract es el documento versionado que dice, con precisión de
versión concreta, **qué le da el host móvil a cada miniapp**: qué librerías
compartidas trae (y en qué versión exacta), qué módulos nativos están
compilados en el binario, y qué "contrato" (semver propio) representa ese
conjunto. Es la pieza que hace posible que un host único cargue miniapps de
equipos que nunca se coordinaron entre sí sin que dos copias de React choquen
en runtime, sin binarios rotos por un nativo que falta, y sin que nadie tenga
que adivinar una versión. Si integrás una miniapp o operás el host, este es
el documento del que depende todo lo demás — el [Compat gate](/docs/compat-gate)
y el gate de blast-radius son, en el fondo, comparaciones contra este
contrato.

> [!NOTE]
> Este doc es el deep-dive conceptual. Para la guía paso a paso de cómo
> declarar `shared` en tu miniapp, ver [Integration Guide](/docs/integration-guide)
> §5.2-5.5. Para los schemas HTTP exactos, ver [API Reference](/docs/api-reference) §8.

## Por qué existe

Module Federation permite que un host cargue código de otro bundle en
runtime, pero **no resuelve por sí solo el problema de versiones duplicadas**.
Si el host trae React 18.3.1 y una miniapp fue compilada asumiendo React
18.2.0 con hooks que cambiaron de firma, el resultado no es un error de
build — es un crash en producción, o peor, un bug silencioso de estado
compartido roto (por ejemplo, dos instancias de React Query con cachés
aisladas e inconsistentes).

El Host Contract resuelve esto invirtiendo quién es la fuente de verdad: **el
host declara, de forma pública y verificable, exactamente qué versión de cada
singleton compartido trae**. Cualquier miniapp puede consultarlo (`GET
/api/host-contract`) antes de publicar, y el [Compat gate](/docs/compat-gate)
lo usa para rechazar automáticamente una miniapp que declare requerir algo
fuera de ese rango. Sin este contrato, la única forma de detectar un skew de
versiones sería un crash reportado por un usuario.

El contrato también resuelve un segundo problema: **qué pasa cuando el host
mismo evoluciona**. Cuando el host bumpea una dependencia compartida o agrega
un módulo nativo, ¿qué miniapps ya publicadas se rompen? Eso es lo que
responde el gate de blast-radius (`findNewlyBroken`, ver
[Compat gate](/docs/compat-gate)) comparando el contrato viejo contra el
candidato.

## Qué provee, en concreto

Tres cosas, todas versionadas:

| Provee | Qué es | Por qué importa |
|---|---|---|
| **Singletons compartidos** (`shared`) | Librerías que el host carga UNA sola vez y expone a todas las miniapps vía Module Federation (`singleton: true, eager: true`) | Evita instancias duplicadas de librerías con estado global o contexto de React (React, React Query, Zustand, `ui-kit`'s `ThemeProvider`, navegación) |
| **Módulos nativos** (`nativeModules`) | Código Android/iOS ya compilado en el binario del host | Un módulo nativo no se puede "traer" en runtime como el JS de una miniapp — si el host no lo compiló, no existe en el dispositivo |
| **`contractVersion`** | Semver del contrato en sí (no de la app del host) | Permite que una miniapp declare "necesito al menos esta versión del contrato" (`minHostContract`), independiente de la versión de React Native |

## Cómo se genera

La fuente única es
`backstagereactnative/apps/host/shared-deps.mjs`. Ahí vive:

- **`SHARED_DEPS`** — la lista de singletons compartidos, con su
  `requiredVersion` (la que Module Federation exige a cualquier chunk que
  provea esa lib) y si hay que advertir la versión resuelta
  (`provideVersion`).
- **`CONTRACT_VERSION`** — el semver actual del contrato (hoy `"0.1.0"`).
- **`CAPABILITY_SINCE`** — en qué `contractVersion` se introdujo cada
  singleton y cada nativo (la procedencia que permite calcular
  `minHostContract` con precisión — ver más abajo).

Este mismo archivo alimenta dos cosas: el bloque `shared` que
`rspack.config.mjs` pasa a `ModuleFederationPluginV2` (vía `buildMfShared`,
que arma `{ singleton: true, eager: true, requiredVersion, version? }` por
cada dep), y el script generador del contrato,
`apps/host/scripts/gen-host-contract.mjs`. Antes esta lista estaba
duplicada entre ambos consumidores; ahora hay una sola fuente.

`gen-host-contract.mjs` corre en la CI del host (o manual) y hace, en orden:

1. Resuelve la versión **instalada** de cada dep de `SHARED_DEPS` leyendo su
   `package.json` (`require(\`${name}/package.json\`).version`) — no confía en
   lo declarado, confía en lo que realmente está instalado.
2. Enumera los módulos nativos autolinkeados corriendo `react-native config`
   y filtrando los deps con `platforms.android` o `platforms.ios` no-null
   (`parseAutolinkedNatives`).
3. **Fail-loud** en dos casos: si `nativeModules` sale vacío sin que se pase
   `ALLOW_NO_NATIVES=1` (un contrato con nativos vacíos marcaría como
   incompatible a CUALQUIER miniapp con un nativo — falso positivo masivo del
   gate), y si falta procedencia en `CAPABILITY_SINCE` para algún singleton o
   nativo detectado (`missingProvenance`).
4. Agrega procedencia de diagnóstico: `generatedAt` (ISO timestamp) y
   `hostCommit` (el SHA del commit del host que lo generó).
5. Escribe `apps/host/host-contract.json`.

Después, `apps/host/scripts/publish-host-contract.mjs` lo sube con `PUT
/api/host-contract` (autenticado con `HOST_CONTRACT_TOKEN`, un token
dedicado — no el `PUBLISH_TOKEN` de las miniapps). Backstage lo guarda y lo
expone público en `GET /api/host-contract`.

> [!TIP]
> El runbook operacional completo (cómo activarlo la primera vez, secrets,
> verificación) está en [Compat gates (runbook)](/docs/compat-gates).

## El shape real

Este es el `host-contract.json` publicado hoy (generado el 2026-08-03, commit
`<host-commit-sha>`), verificado contra el archivo real del repo del host:

```json
{
  "contractVersion": "0.1.0",
  "reactNative": "0.76.6",
  "shared": {
    "react": "18.3.1",
    "react-native": "0.76.6",
    "@tanstack/react-query": "5.101.2",
    "@shopify/flash-list": "1.7.6",
    "zustand": "5.0.14",
    "@react-navigation/native": "7.3.8",
    "@react-navigation/native-stack": "7.17.10",
    "@dentvega/ui-kit": "0.1.0"
  },
  "nativeModules": [
    "@shopify/flash-list",
    "react-native-safe-area-context",
    "react-native-screens",
    "@callstack/repack"
  ],
  "capabilitySince": {
    "shared": {
      "react": "0.1.0",
      "react-native": "0.1.0",
      "@tanstack/react-query": "0.1.0",
      "@shopify/flash-list": "0.1.0",
      "zustand": "0.1.0",
      "@react-navigation/native": "0.1.0",
      "@react-navigation/native-stack": "0.1.0",
      "@dentvega/ui-kit": "0.1.0"
    },
    "native": {
      "@shopify/flash-list": "0.1.0",
      "react-native-safe-area-context": "0.1.0",
      "react-native-screens": "0.1.0",
      "@callstack/repack": "0.1.0"
    }
  },
  "generatedAt": "2026-08-03T10:16:57.304Z",
  "hostCommit": "<host-commit-sha>"
}
```

El tipo TypeScript (`packages/miniapp-contract/src/types.ts`, la ubiquitous
language compartida entre host, miniapps y Backstage) es:

```ts
export interface HostContract {
  contractVersion: string;
  reactNative: string;
  shared: Readonly<Record<string, string>>;
  nativeModules: readonly string[];
  readonly generatedAt?: string;
  readonly hostCommit?: string;
  readonly capabilitySince?: {
    readonly shared: Readonly<Record<string, string>>;
    readonly native: Readonly<Record<string, string>>;
  };
}
```

Notá que `shared` en el `HostContract` es un `Record<string, string>` —
**nombre → versión concreta instalada** (no un rango). El rango vive del
otro lado, en lo que la miniapp declara.

## Cómo la miniapp declara lo que necesita

El manifest de cada miniapp (`manifest.json`) lleva su propio arreglo
`shared`, con la forma `SharedDepSpec`:

```ts
export interface SharedDepSpec {
  readonly name: string;          // ej. "react-native"
  readonly requiredRange: string; // ej. "^18.3.0" — semver range
  readonly singleton: boolean;
}
```

Este arreglo **no se escribe a mano** en el flujo normal. Lo genera
`scripts/gen-manifest-shared.mjs` (parte del `miniapp-template`, corre en la
CI de cada miniapp antes de publicar). Su lógica (`deriveShared`):

```js
export function deriveShared(contractShared, resolveVersion) {
  const out = [];
  for (const name of Object.keys(contractShared ?? {})) {
    const v = resolveVersion(name);
    if (v) out.push({ name, requiredRange: `^${v}`, singleton: true });
  }
  return out;
}
```

Es decir: para cada singleton que el Host Contract expone, si la miniapp
tiene esa dependencia **instalada** (`resolveVersion` lee su
`package.json`), agrega una entrada con `requiredRange: "^<versión
instalada>"`. Si la miniapp no usa esa lib, no aparece — el manifest solo
declara lo que realmente se usa (no las ocho por default).

> [!IMPORTANT]
> El `^` no es arbitrario: es el operador semver estándar (permite
> parches y minors más nuevos, no majors). Como el rango se auto-genera
> desde la versión instalada, **vos nunca elegís el operador** — solo
> controlás qué versión tenés instalada de cada dep compartida.

El generador también intersecta con lo que el host realmente expone
(`Object.keys(contractShared)`), así que una dep que la miniapp tiene
instalada pero que el host **no** provee como singleton simplemente no entra
en `shared` — no tiene sentido declarar un rango contra algo que el host no
va a chequear.

## Cómo `satisfiesShared` decide compatibilidad

La función vive en `packages/miniapp-contract/src/shared.ts` y es el
corazón del chequeo — la usan el host (al montar, en `evaluateManifest`), el
gate del `/upload` de Backstage, y el gate de blast-radius del host:

```ts
export function satisfiesShared(
  hostProvided: Readonly<Record<string, SemVer>>,
  miniappShared: readonly SharedDepSpec[],
): SkewResult {
  const entries: SkewEntry[] = miniappShared.map((dep) => {
    const providedVersion = hostProvided[dep.name];
    if (providedVersion === undefined) {
      return { name: dep.name, status: "missing", requiredRange: dep.requiredRange };
    }
    const inRange = semver.satisfies(providedVersion, dep.requiredRange, { includePrerelease: false });
    const status: SkewStatus = inRange ? "ok" : "incompatible";
    return { name: dep.name, status, requiredRange: dep.requiredRange, providedVersion };
  });

  return { compatible: entries.every((e) => e.status === "ok"), entries };
}
```

Usa el paquete **`semver`** de verdad (`semver.satisfies`), no un parser
casero — soporta caret (`^1.2.3`), tilde (`~1.2.3`), rangos compuestos
(`>=1.2.0 <2.0.0`), OR (`1.x || 2.x`), y todo lo que `semver` entiende. Cada
dep del manifest queda en uno de tres estados:

| Status | Significa |
|---|---|
| `ok` | El host provee esa lib y su versión concreta cae dentro del `requiredRange` |
| `missing` | El host no provee esa lib como singleton (no está en `HostContract.shared`) |
| `incompatible` | El host la provee, pero la versión concreta queda fuera del rango pedido |

El resultado global (`compatible`) es `true` solo si **todas** las entradas
están en `ok`. Una sola dep `missing` o `incompatible` marca a la miniapp
entera como incompatible con ese host.

> [!NOTE]
> Existe una segunda función, `satisfiesRange`, en el mismo archivo — un
> comparador de rangos *minimal* (exacto, `^`, `~`, `*`) mantenido aparte
> para un badge de drift más barato de calcular. La decisión de
> compatibilidad real siempre pasa por `satisfiesShared` + `semver`.

## `minHostContract` y el versionado del contrato

Además del skew de `shared`, una miniapp puede declarar el **mínimo
contrato de host** contra el que fue construida:

```ts
minHostContract?: {
  readonly reactNative: string;
  readonly contractVersion: string;
};
```

Se calcula así (`deriveMinContractVersion`, en `gen-manifest-shared.mjs`):
para cada singleton y cada nativo que la miniapp **usa**, se busca en
`capabilitySince` en qué `contractVersion` del host se introdujo. El
`minHostContract.contractVersion` final es el **máximo** de esos valores
(la capability más nueva que la miniapp toca fija el piso). Si la miniapp no
usa nada introducido después de la versión base, cae en `"0.0.0"` — cualquier
host sirve.

Esto habilita el guard **host-too-old**, que corre del lado del host móvil
(`evaluateManifest`, en `host-runtime`) al momento de montar:

```ts
const min = manifest.minHostContract;
if (min !== undefined && hostContractVersion !== undefined) {
  const cvOk = gteVersion(hostContractVersion, min.contractVersion);
  const rnOk = gteVersion(hostProvided["react-native"] ?? "", min.reactNative);
  if (!cvOk || !rnOk) {
    return { ok: false, reason: "host-too-old", detail: `host too old: ...` };
  }
}
```

Es el caso inverso del skew: no es que la miniapp pida una versión de una
lib fuera de rango, es que el **binario del host instalado en el
dispositivo del usuario** es más viejo que lo que la miniapp necesita — algo
que solo se detecta en runtime (el usuario no actualizó la app), nunca en CI.

**Política de bump del `contractVersion`** (documentada en
`shared-deps.mjs`):

- **minor** (`0.1.0 → 0.2.0`) — agregar un singleton o un módulo nativo
  nuevo. Aditivo: las miniapps viejas siguen funcionando; las nuevas pueden
  requerirlo vía `minHostContract`.
- **major** (`0.x.y → 1.0.0`) — quitar o cambiar de forma incompatible un
  singleton/nativo, o bump mayor de React Native. Rompe miniapps que
  dependían de lo viejo.
- **patch** — cambios que no afectan el contrato en sí.

## Ejemplo concreto: compatible vs. no compatible

Con el `host-contract.json` de arriba (`react: "18.3.1"`, `@tanstack/react-query:
"5.101.2"`):

**Compatible** — una miniapp con este `shared`:

```json
[
  { "name": "react", "requiredRange": "^18.3.0", "singleton": true },
  { "name": "@tanstack/react-query", "requiredRange": "^5.0.0", "singleton": true }
]
```

`18.3.1` satisface `^18.3.0` (mismo major, `>=` minor.patch) → `ok`.
`5.101.2` satisface `^5.0.0` (mismo major) → `ok`. Resultado:
`compatible: true`.

**No compatible** — una miniapp con este `shared`:

```json
[
  { "name": "react", "requiredRange": "^19.0.0", "singleton": true }
]
```

El host provee `react: "18.3.1"`, que **no** cae dentro de `^19.0.0`
(major distinto) → `status: "incompatible"`. Resultado: `compatible: false`,
y el [Compat gate](/docs/compat-gate) en el `/upload` la marca como
`COMPAT_INCOMPATIBLE` (o solo la loguea, según el modo — ver ese doc).

## Ver también

- [Compat gate](/docs/compat-gate) — cómo se usa este contrato para
  bloquear (o avisar) publishes incompatibles, y el gate espejo de
  blast-radius del lado del host.
- [Compat gates (runbook)](/docs/compat-gates) — cómo encender el sistema
  paso a paso (secrets, backfill, WARN → ENFORCE).
- [Integration Guide](/docs/integration-guide) §5.2-5.5 — cómo declarar
  `shared` en tu `rspack.config.mjs` y por qué tu `manifest.json` no se
  escribe a mano.
- [API Reference](/docs/api-reference) §8 — el schema `HostContract` y
  `Manifest` completos, más `GET`/`PUT /api/host-contract`.
