# Glosario

Referencia rápida de "¿qué significa esta palabra?" para quien es nuevo en la
plataforma. Cada término tiene una definición corta y, cuando existe, un link
al doc que profundiza. Si estás integrando una miniapp o operando el host y te
cruzás con un término que no entendés, empezá acá.

## Índice

- [Plataforma y arquitectura](#plataforma-y-arquitectura)
- [Distribución y montaje](#distribución-y-montaje)
- [Compatibilidad (Host Contract y gates)](#compatibilidad-host-contract-y-gates)
- [Publicación y versionado](#publicación-y-versionado)
- [Roles y tokens](#roles-y-tokens)
- [Mantenimiento de la flota](#mantenimiento-de-la-flota)

---

## Plataforma y arquitectura

**Miniapp** — una feature independiente, empaquetada como *remote* de Module
Federation, con su propio repo y su propio ciclo de release. Expone un punto
de entrada (`./Entry`) y declara en su `manifest.json` qué necesita del host
(shared deps, módulos nativos, capabilities). → [Platform Overview](/docs/platform-overview) · [Integration Guide](/docs/integration-guide)

**Host** — el único binario móvil (Android/iOS). No trae las miniapps
adentro: las carga **por red, en runtime**, vía Module Federation. Provee un
conjunto fijo de singletons compartidos y módulos nativos — ese conjunto es
el [Host Contract](/docs/host-contract).

**Backstage (control-plane)** — el nombre de este repo (`backstage-web`), la
app Next.js que actúa de registry: cataloga miniapps y versiones, sirve la
API de distribución (`/api/resolve`), corre el compat gate en cada publish, y
expone la UI de gestión (scaffold, pin, maintainers, storage). Nunca ejecuta
código de una miniapp — solo guarda metadata y bytes. → [Platform Overview](/docs/platform-overview)

**Registry** — la fuente de verdad que mantiene Backstage: por cada miniapp,
`id, name, owner, versions[], repoUrl, maintainers?, pinnedVersion?`; por
cada versión publicada, `version, url, manifest, publishedAt` (+ `iosUrl` /
`iosIntegrity` / `signature` / `iosSignature` si aplica). Es el dato, no la API —
la API que lo expone es `/api/miniapps` y `/api/resolve`.

**Module Federation** — la tecnología (de Re.Pack/webpack) que permite que un
bundle (el "host"/"shell") cargue código de otro bundle (un "remote") **en
runtime**, sin recompilar el primero. Es lo que hace posible que el host
móvil monte una miniapp sin subir una nueva versión a las stores.

**Remote** — terminología de Module Federation: un bundle que otro bundle
carga dinámicamente en runtime. Cada miniapp es un remote; el host móvil es
el shell que los consume.

**Chunk** — el bundle JS que produce el build de Re.Pack de una miniapp
(`<id>.container.js.bundle` + sub-chunks/vendor). Se guarda en storage bajo
`${id}/${version}/` para Android y `${id}/${version}/ios/` para iOS — mismo
nombre de archivo, contenido distinto por plataforma.

**Manifest** — el JSON que describe una versión publicada de una miniapp:
`id`, `version`, `entry`, `shared` (sus deps compartidas con `requiredRange`),
`capabilities`, `integrity?`, `signature?`, `minHostContract?`. No se escribe a
mano — lo genera `gen-manifest-shared.mjs` en la CI del template. → [API Reference](/docs/api-reference) §8

---

## Distribución y montaje

**Resolve** — `GET /api/resolve?id=&version=&range=&platform=` → `{url,
manifest}`. Es la pregunta que le hace el host a Backstage antes de montar
una miniapp: "¿qué versión te sirvo para esta plataforma?". Sin `version` ni
`range`, resuelve `pinnedVersion ?? latest`. Con `platform=ios` devuelve
`iosUrl` y pisa `manifest.integrity` con `iosIntegrity` (los bytes del chunk
difieren por plataforma). → [API Reference](/docs/api-reference) §2

**Integrity (sha256)** — cada chunk publicado lleva un hash sha256, calculado
**server-side** de los bytes reales del container (nunca se confía en un
valor que mande el cliente). El host lo verifica antes de montar; si no
coincide, es un fallback `integrity-failed`.

**Firma / Signature (Ed25519)** — sobre la integridad, un chunk puede llevar
una **firma** (`manifest.signature`). El hash prueba **integridad** (los bytes
no cambiaron); la firma prueba **autenticidad** (los publicó alguien
autorizado) — cierra el caso de un atacante que controle a la vez el storage y
el registry. Modelo de dos niveles: cada miniapp firma con su clave privada
por-repo, y el owner firma la tabla `{miniapp→pubkey}` con una clave **root**.
El backend ya acepta/sirve firmas; la verificación en el host se activa por
separado. → [API Reference](/docs/api-reference) §5.7

**Trust bundle** — la tabla `{miniapp → pubkey}` firmada por la clave **root**
del owner, servida por `GET /api/trust-bundle`. Es el ancla de confianza: el
host la trae, la verifica contra la pubkey root **pineada en su binario**, y de
ahí saca la pubkey con la que valida la firma de cada chunk. Su `version` es
monotónico (anti-rollback). → [API Reference](/docs/api-reference) §5.7

**Clave root / `ROOT_PUBLIC_KEY`** — el par Ed25519 del owner que firma el trust
bundle. La privada vive **offline** (nunca en Vercel); la pública va pineada en
el host y, opcionalmente, en `ROOT_PUBLIC_KEY` para que el server valide el
bundle antes de guardarlo.

**Capability** — un permiso **acotado y revocable** que el host otorga a una
miniapp (ej. `accounts:read`, `session:whoami`) — nunca un credential crudo.
La miniapp declara las que necesita en su `manifest.json`; el host las
otorga vía un `CapabilityGrant` (`{ granted, isRevoked() }`) inyectado como
prop de `./Entry`. Sin el grant correspondiente, la miniapp debe degradar a
su propia pantalla de acceso denegado. → [Integration Guide](/docs/integration-guide) §5.4

**Fallback reason** — la razón tipada por la que `<MiniappHost/>` (paquete
`host-runtime`) no pudo montar una miniapp y cayó a la pantalla "Miniapp no
disponible" (`packages/host-runtime/src/loaderState.ts`):

| Razón | Naturaleza | Significado |
|---|---|---|
| `resolve-failed` | transitorio | Falló `GET /api/resolve` (red, Backstage caído) |
| `download-failed` | transitorio | Falló la descarga del chunk |
| `integrity-failed` | transitorio | El sha256 descargado no coincide con el declarado |
| `invalid-manifest` | permanente | El manifest no tiene la forma esperada por el contrato |
| `skew` | permanente | El `shared` del manifest queda fuera de lo que el host provee hoy |
| `host-too-old` | permanente | El `minHostContract` de la miniapp exige un `contractVersion` mayor al del binario instalado |

Las **transitorias** habilitan botón Reintentar (`isRetryable()`); las
**permanentes** no — reintentar no cambia nada, hace falta una acción humana
(republicar la miniapp, o que el usuario actualice el host). → [Troubleshooting](/docs/troubleshooting) §2

---

## Compatibilidad (Host Contract y gates)

**Host Contract** — el documento versionado que declara qué le da el host a
cada miniapp: `shared` (singletons compartidos → versión concreta),
`nativeModules` (módulos nativos compilados en el binario) y
`contractVersion` (semver del contrato en sí). Se genera desde
`shared-deps.mjs` y se publica en `GET /api/host-contract`. Es la fuente de
verdad contra la que comparan ambos gates de compatibilidad. → [Host Contract](/docs/host-contract)

**Shared dep / Singleton** — una librería que el host carga **una sola vez**
y expone a todas las miniapps vía Module Federation
(`{ singleton: true, eager: true }`), para que no haya dos instancias
compitiendo por el mismo estado global o contexto de React (React, React
Query, Zustand, el `ThemeProvider` de `ui-kit`, navegación). Si una miniapp
duplica una de estas sin declararla singleton, rompe en runtime (ej.
`useTheme must be used within a <ThemeProvider>`). → [Integration Guide](/docs/integration-guide) §5.2

**requiredRange** — el campo de `SharedDepSpec` en el `manifest.json` de una
miniapp: el rango semver (ej. `^18.3.0`) que la miniapp necesita de una
shared dep. Se auto-genera como `^<versión instalada>` — nunca se escribe a
mano ni se elige el operador.

**satisfiesShared** — la función (`packages/miniapp-contract/src/shared.ts`)
que decide compatibilidad: usa el paquete `semver` real (`semver.satisfies`)
para chequear si la versión concreta que provee el host cae dentro del
`requiredRange` de cada dep del manifest. Cada dep queda `ok`, `missing`
(el host no la provee) o `incompatible` (la provee, pero fuera de rango). El
resultado es compatible solo si **todas** las entradas están en `ok`. La usan
el host al montar, el Gate 1 del `/upload`, y el Gate 2 de blast-radius. → [Host Contract](/docs/host-contract) § satisfiesShared

**Native module** — código Android/iOS ya compilado en el binario del host.
A diferencia de una shared dep, no se puede "traer" por red en runtime — si
el host no lo compiló, no existe en el dispositivo. Por eso el contrato lo
trata como **presencia binaria** (una lista plana de nombres, sin versión),
no como un rango. Si una miniapp necesita un nativo que el host no tiene, el
compat gate la marca incompatible y abre un issue automático pidiéndolo.

**Skew** — el nombre del `FallbackReason` (y también coloquial) para cuando
una shared dep del manifest queda **fuera del rango** que el host realmente
provee hoy. Es la manifestación en runtime de lo que `satisfiesShared`
detecta en build/publish time.

**Compat gate** — el chequeo automático que corre en `POST
/api/miniapps/:id/upload` (cada publish): compara el `manifest` de la
miniapp contra el Host Contract vigente vía `satisfiesShared` + chequeo de
`nativeModules`. Es el **Gate 1** de los dos gates de compatibilidad. → [Compat gate](/docs/compat-gate)

**Blast-radius (`findNewlyBroken`)** — el **Gate 2**, espejo del anterior: en
la CI del **host**, cuando un PR toca sus deps, `findNewlyBroken` chequea si
el contrato candidato rompería alguna miniapp que **ya era compatible** con
el contrato publicado. Si rompe algo, bloquea el merge salvo el label
`accept-breaking-contract`. Uno protege al host de una miniapp incompatible;
el otro protege a la flota de un host que cambia debajo suyo. → [Compat gate](/docs/compat-gate) § Gate 2

**WARN vs ENFORCE** — los dos modos del Gate 1, controlados por
`COMPAT_ENFORCE`. **WARN** (default, sin la var o distinta de `"1"`) loguea
la incompatibilidad y **deja publicar igual** — red de seguridad para
rollout. **ENFORCE** (`COMPAT_ENFORCE=1`) rechaza el publish con `422` y
`code: "COMPAT_INCOMPATIBLE"`. El Gate 2 (blast-radius) no tiene este
interruptor — siempre bloquea por default, salvo el label de excepción. → [Compat gate](/docs/compat-gate) § WARN vs ENFORCE

**contractVersion / minHostContract** — `contractVersion` es el semver del
Host Contract en sí (hoy `"0.1.0"`), independiente de la versión de React
Native o de la app. `minHostContract` (`{ reactNative, contractVersion }`) es
lo que una miniapp declara en su manifest: el contrato mínimo del host contra
el que fue construida, calculado como el máximo `capabilitySince` de todo lo
que usa. Si el binario del host instalado en el dispositivo es más viejo que
ese mínimo, el host cae al fallback `host-too-old`. → [Host Contract](/docs/host-contract) § minHostContract

> [!NOTE]
> No confundas [Compat gate](/docs/compat-gate) (el doc conceptual — qué hacen
> los gates y por qué) con [Compat gates — runbook](/docs/compat-gates) (la
> guía operacional paso a paso para **activarlos**, WARN → ENFORCE, secrets,
> backfill). Mismo tema, dos documentos distintos.

---

## Publicación y versionado

**Versioning** — el registro de versiones es **append-only e inmutable**:
re-publicar el mismo número de versión da `409` (`VERSION_EXISTS`). El
publish calcula el **auto-bump** del siguiente patch a partir de la
`latestVersion` del registro — no hay que bumpear a mano en cada release.

**Pin / Rollback (servedVersion vs latestVersion)** — `pinnedVersion` fija
qué versión sirve `/api/resolve` (rollback o freeze), sin ningún re-deploy
del host — se libera con `version: null` ("auto = última"). `servedVersion`
(el campo que ves en el catálogo) es el resultado ya calculado:
`pinnedVersion ?? latestVersion`. → [Integration Guide](/docs/integration-guide) §8

> [!TIP]
> `latestVersion` es siempre la más alta publicada, exista o no un pin.
> `servedVersion` es la que un usuario realmente recibe hoy — pueden diferir
> si hay un rollback activo. El campo `latestVersion` **nunca** refleja el pin.

---

## Roles y tokens

**Scaffold** — la acción de crear una miniapp nueva: `POST /api/scaffold`
genera el repo `github.com/<owner>/miniapp-<id>` desde `miniapp-template`, lo
registra en el catálogo, y siembra los secrets (`BACKSTAGE_URL`,
`PUBLISH_TOKEN`) y permisos de Actions — todo best-effort, sin pasos
manuales. Requiere ser **platform-admin**. → [Integration Guide](/docs/integration-guide) §4

**Maintainer vs platform-admin** — dos niveles de autorización.
**Platform-admin** (`SCAFFOLD_ALLOWED_LOGINS`, allowlist fail-closed) puede
crear miniapps y gestionar **cualquier** miniapp existente. **Maintainer**
(`MiniappRecord.maintainers`, por-miniapp) gestiona **solo** esa miniapp, sin
necesitar ser platform-admin — pero solo se puede asignar a alguien que ya es
**collaborator del repo de GitHub** de esa miniapp (Backstage lo valida
server-side contra la API de GitHub, nunca confía en el cliente).
`canManageMiniapp` autoriza si el login está en el conjunto admin ∪
maintainer de esa miniapp puntual. → [API Reference](/docs/api-reference) §1

**PUBLISH_TOKEN / HOST_CONTRACT_TOKEN** — dos tokens de servicio distintos.
`PUBLISH_TOKEN` autoriza `POST /api/miniapps/:id/upload` desde la CI de una
miniapp; soporta rotación dual-token (`PUBLISH_TOKEN` + `PUBLISH_TOKENS_OLD`
como CSV) para rotar sin downtime. `HOST_CONTRACT_TOKEN` es un token
separado, dedicado, que solo autoriza `PUT /api/host-contract` (publicar el
contrato del host) — nunca se comparten entre sí. → [Rotar PUBLISH_TOKEN](/docs/rotar-publish-token)

**MINIAPP_SIGN_KEY / clave root** — claves de **firma** (Ed25519), distintas de
los tokens de arriba. `MINIAPP_SIGN_KEY` será el secret por-repo con el que la CI
de cada miniapp firma su chunk (trabajo out-of-band, aún no en el template). La
**clave root** del owner firma el trust bundle y vive offline. Ver **Firma /
Signature** y **Trust bundle** más arriba. → [API Reference](/docs/api-reference) §5.7

---

## Mantenimiento de la flota

**Template-sync (Capa 2)** — el mecanismo por el que `miniapp-template`
propaga mejoras (scripts, config de build) a toda la flota de miniapps ya
creadas, vía PRs de **merge 3-way** disparados con un botón en Backstage
(fan-out a todos los repos con `sync-all`). `package.json` y los workflows
quedan **fuera** de ese sync (`.templatesyncignore`) — son "tuyos", nunca se
tocan. Es distinto de la "Capa 1" (CI reusable consumido en vivo por
referencia `@main`, sin ningún PR de por medio). → [Actualizar desde template](/docs/actualizar-miniapp)

## Próximos pasos

- [Platform Overview](/docs/platform-overview) — el mental model completo de
  la plataforma, con estos mismos conceptos en contexto.
- [Host Contract](/docs/host-contract) — el deep-dive del documento que hace
  posible toda la sección de Compatibilidad de este glosario.
- [Integration Guide](/docs/integration-guide) — la guía paso a paso para
  construir y publicar una miniapp cumpliendo el contrato.
