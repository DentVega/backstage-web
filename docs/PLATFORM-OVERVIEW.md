# Platform Technical Overview

> Documento de referencia para **ingenieros técnicos** — de nuestro equipo o de
> equipos externos — que necesitan el **modelo mental completo** de la
> plataforma sin tener que leer el código. Si vas a integrar una miniapp,
> operar el host, o extender el control-plane, empezá acá; después andá a los
> docs profundos linkeados en cada sección.

---

## 1. Qué es

Es una plataforma tipo **"Spotify de miniapps"**: un **host móvil** (una
super-app) donde equipos independientes publican **features (miniapps)** que
se montan **en runtime**, sin que el host se recompile ni se vuelva a subir a
las tiendas. Un **control-plane web (Backstage)** orquesta la creación,
versión, distribución y gobernanza de esas miniapps.

Para levantar tu propia instancia, ver [Setup](/docs/setup).

Cada miniapp es un equipo con su propio repo, su propio CI, su propio ciclo de
release — publica una versión nueva cuando quiere, y esa versión llega al
usuario **sin ningún deploy del host**. El host, a su vez, puede evolucionar
sus capacidades (versiones de librerías, módulos nativos) sin romper miniapps
que ya están en producción, porque hay gates automáticos que lo verifican
antes de que el cambio se mergee.

---

## 2. Arquitectura — los 3 planos

La plataforma vive en tres planos que **solo se hablan a través del
registry** (Backstage). Ninguno conoce los internals de los otros.

<div class="dgm dgm-arch">
<div class="dgm-plane">
<span class="dgm-plane-label">① Repos de miniapp (+ CI)</span>
<ul>
<li>código + <code>./Entry</code></li>
<li><code>rspack.config.mjs</code> · <code>manifest.json</code></li>
<li>CI: build <b>android + iOS</b> → publish (<code>PUBLISH_TOKEN</code>)</li>
</ul>
<span class="dgm-plane-foot">repo propio</span>
</div>
<div class="dgm-arrow">publish</div>
<div class="dgm-plane dgm-accent">
<span class="dgm-plane-label">② Backstage · control-plane</span>
<ul>
<li>Registry (versiones, urls por-plataforma)</li>
<li>Catálogo (served version, badges drift/CI)</li>
<li>Scaffolder · Compat gate (Host Contract)</li>
<li>Storage (R2/Blob/fs) · Métricas</li>
</ul>
<span class="dgm-plane-foot">Next.js · backstage-web</span>
</div>
<div class="dgm-arrow">resolve</div>
<div class="dgm-plane">
<span class="dgm-plane-label">③ Host móvil</span>
<ul>
<li>resuelve por id: <code>GET /api/resolve</code></li>
<li>descarga el chunk · verifica sha256</li>
<li>monta <code>&lt;MiniappHost/&gt;</code></li>
<li>fallback tipado + auto-retry · cache</li>
</ul>
<span class="dgm-plane-foot">RN + Re.Pack · backstagereactnative</span>
</div>
</div>

**El flujo por el registry, en una frase:** un repo de miniapp **publica** un
chunk versionado a Backstage; el host **resuelve** un id contra Backstage y
recibe `{url, manifest}`; el host **descarga y monta** ese chunk. Backstage
nunca ejecuta código de la miniapp — solo guarda metadata y bytes. El host
nunca sabe cómo se construyó la miniapp — solo consume el contrato.

**Por qué importa:** los equipos de miniapp shippean de forma independiente
(repo propio, CI propio, cadencia propia) mientras el host se mantiene
delgado y las carga en runtime. Cero rebuild del host para actualizar una
miniapp.

---

## 3. Conceptos clave

Esta es la sección central — cada concepto se referencia todo el tiempo en el
resto del documento.

**Miniapp** — un *remote* de Module Federation (expone `./Entry`), en su
propio repo, con su propio ciclo de release. Se declara compatible con el
host vía un `manifest.json` (shared deps + módulos nativos + capabilities que
necesita).

**Host** — el único binario móvil (Android/iOS). No trae las miniapps
adentro: las carga **por red, en runtime**, vía Module Federation. Provee un
conjunto fijo de singletons compartidos y módulos nativos — eso es el **Host
Contract** (ver abajo).

**Registry** — la fuente de verdad de Backstage. Por cada miniapp guarda:
`id, name, owner, versions[], repoUrl, maintainers?, pinnedVersion?,
storageProvider?`. Por cada versión publicada: `version, url` (chunk
android), `iosUrl?`, `iosIntegrity?`, `manifest, publishedAt`.

**Chunk** — el bundle JS que Re.Pack construye (`<id>.container.js.bundle` +
sub-chunks/vendor), guardado en el storage bajo `${id}/${version}/` para
Android y `${id}/${version}/ios/` para iOS.

**Host Contract** — lo que el host **provee**, expresado como dato versionado:
`shared` (cada singleton compartido → su **versión concreta**),
`nativeModules` (los módulos nativos compilados en el binario),
`contractVersion` (semver del contrato en sí) y `capabilitySince` (en qué
`contractVersion` se introdujo cada capability). Se genera desde las deps
reales del host (`gen-host-contract.mjs`, fuente única `shared-deps.mjs`) y
se publica en `GET /api/host-contract`.

**Compat gate** — al publicar una versión, Backstage compara el `manifest`
de la miniapp (sus `shared` con `requiredRange`, sus `nativeModules`) contra
el Host Contract vigente. `satisfiesShared` usa el paquete **semver** real
(soporta `^`, `~`, rangos compuestos). Por default corre en modo **WARN**
(loguea, no bloquea); con `COMPAT_ENFORCE=1` **rechaza con 422**. Un módulo
nativo que la miniapp necesita y el host no tiene → se marca incompatible y
se abre automáticamente un issue en el repo del host pidiéndolo.

**Blast-radius** — el gate del lado **host**: en un PR que cambia las deps
del host, la CI corre `findNewlyBroken` — chequea si el cambio rompería
alguna miniapp **ya publicada** contra el Host Contract nuevo. Si rompe algo,
**bloquea el merge** (salvo el label `accept-breaking-contract`, que lo deja
pasar mientras registra quién aceptó el break). Es el espejo del compat gate:
uno protege al host de miniapps incompatibles, el otro protege a la flota de
un host que cambia debajo suyo.

**Capabilities** — permisos **acotados y revocables** que el host otorga a
una miniapp (ej. `accounts:read`, `session:whoami`) — nunca un credential
crudo. La miniapp **declara** las que necesita en su manifest; el host las
**otorga acotadas a la sesión actual** e inyecta un `CapabilityGrant` (con
`granted` + `isRevoked()`) como prop de `./Entry`. Es un set semilla,
pensado para extenderse.

**Versioning** — append-only e **inmutable**: re-publicar el mismo número de
versión da `409`. El publish hace **auto-bump** del patch siguiente a partir
de la `latestVersion` del registro, así que no hay que bumpear a mano en cada
iteración. `pinnedVersion` es un **rollback/freeze instantáneo** — se sirve
sin ningún re-deploy del host. La versión que efectivamente se sirve es
`servedVersion = pinnedVersion ?? latest`.

**Resolve** — `GET /api/resolve?id=&version=&range=&platform=` → `{url,
manifest}` para la plataforma pedida. Con `platform=ios` devuelve `iosUrl` y
pisa `manifest.integrity` con `iosIntegrity` (los bytes del chunk difieren
por plataforma, así que la integridad también). Sin `platform` (o
`platform=android`) resuelve el chunk Android.

**Template-sync (Capa 2)** — `miniapp-template` propaga mejoras (scripts,
config de build) a toda la flota de miniapps vía PRs de **merge 3-way** +
fan-out, disparados con un botón en Backstage. `package.json` y los workflows
quedan **fuera** de ese sync (out-of-band / `.templatesyncignore`) — son
"tuyos", nunca se tocan. Ver `docs/actualizar-miniapp.md` para el detalle.

**Storage** — el backend que guarda los bytes de los chunks. Se elige por
presencia de env vars, en el orden **R2 (default) → Blob → fs**, con override
por-miniapp y un selector en la UI de Backstage.

**Ownership/seguridad** — dos niveles: **platform-admins**
(`SCAFFOLD_ALLOWED_LOGINS`, gestionan cualquier miniapp) y **maintainers
por-miniapp** (gestionan solo la suya, y solo pueden ser **collaborators del
repo** de esa miniapp — verificado server-side). `PUBLISH_TOKEN` autoriza el
publish desde CI. Cada chunk lleva integridad **sha256**.

**Observabilidad** — métricas de mounts por miniapp y de fallbacks por razón
(cada razón clasificada como **transitoria** o **permanente**), badge de
drift (¿está al día con el template?) y badge de CI por miniapp en el
catálogo.

---

## 4. El ciclo de vida end-to-end

<div class="dgm">
<div class="dgm-flow">
<div class="dgm-step"><span class="dgm-step-n">1 · scaffold</span><span class="dgm-step-t">Crear el repo</span><span class="dgm-step-d"><code>POST /api/scaffold</code> → repo desde el template + registro en el catálogo.</span></div>
<div class="dgm-arrow"></div>
<div class="dgm-step"><span class="dgm-step-n">2 · desarrollar</span><span class="dgm-step-t">Código + dev local</span><span class="dgm-step-d"><code>./Entry</code>; dev-loop (LOCAL-DEV).</span></div>
<div class="dgm-arrow"></div>
<div class="dgm-step"><span class="dgm-step-n">3 · publicar (CI)</span><span class="dgm-step-t">Build + publish</span><span class="dgm-step-d">build android+iOS → zip → upload (<code>PUBLISH_TOKEN</code>). <span class="dgm-gate">compat gate</span></span></div>
<div class="dgm-arrow"></div>
<div class="dgm-step"><span class="dgm-step-n">4 · resolve</span><span class="dgm-step-t">El host pregunta</span><span class="dgm-step-d"><code>GET /api/resolve?id=&amp;platform=</code> → <code>{url, manifest}</code>.</span></div>
<div class="dgm-arrow"></div>
<div class="dgm-step dgm-accent"><span class="dgm-step-n">5 · mount</span><span class="dgm-step-t">Montar</span><span class="dgm-step-d">download → verify sha256 → mount → fallback si falla.</span></div>
</div>
<div class="dgm-notes">
<div class="dgm-note"><b>Compat gate</b> — en el publish (paso 3): el manifest de la miniapp vs el Host Contract. Warn por default; 422 con <code>COMPAT_ENFORCE=1</code>.</div>
<div class="dgm-note"><b>Blast-radius gate</b> — en cada PR que toca deps del host: <code>findNewlyBroken</code> bloquea el merge si el cambio rompe una miniapp ya publicada.</div>
</div>
</div>

1. **Scaffold** — `POST /api/scaffold` (o el form en `/create`) genera el
   repo `github.com/<owner>/miniapp-<id>` desde el template y lo registra en
   el catálogo (sin versiones todavía). El scaffolder también siembra los
   secrets `BACKSTAGE_URL` + `PUBLISH_TOKEN` en el repo nuevo y habilita el
   permiso de Actions para que `template-sync.yml` pueda abrir PRs — todo
   best-effort, sin pasos manuales por miniapp.

2. **Desarrollar** — el equipo de la miniapp trabaja localmente. El inner
   loop **no tiene hot-reload del remote federado**: como el host carga por
   URL resuelta contra Backstage, cada cambio pasa por build estático → zip →
   publish → reabrir en el host (hay dos modos de dev más rápidos —
   dev-mount con Fast Refresh y remotes federados en vivo — ver
   `LOCAL-DEV.md` §6b).

3. **Publicar (android + iOS)** — la CI del repo de la miniapp (`ci.yml` →
   `publish.yml` reutilizable del template) construye el chunk estático para
   **ambas plataformas**, calcula la versión siguiente (auto-bump) **una
   sola vez**, y publica ambos chunks **a la misma versión** — el build de
   iOS es best-effort (si falla, no bloquea el publish de Android). Acá
   **actúa el compat gate**: el `manifest` publicado se compara contra el
   Host Contract vigente.

4. **Resolve** — el host pide `GET /api/resolve?id=&platform=` y recibe
   `{url, manifest}` para la plataforma que corresponde (`Platform.OS`
   decide automáticamente). Backstage devuelve la versión más alta
   compatible, o la `pinnedVersion` si el admin fijó una.

5. **Mount** — `MiniappHost` (del paquete `host-runtime`) hace el ciclo
   completo: descarga el chunk, verifica su **sha256**, lo monta como remote
   federado inyectando el `CapabilityGrant` correspondiente, y si algo falla
   muestra un fallback tipado (con auto-retry en las razones transitorias).

**Dónde actúan los dos gates, en una línea:** el **compat gate** corre en el
`/upload` de cada publish de miniapp (¿esta miniapp es compatible con el host
de hoy?); el **blast-radius** corre en el CI del **host** cuando sus deps
cambian (¿este host nuevo rompe alguna miniapp que ya está publicada?). Son
las dos caras de la misma garantía: la flota y el host nunca se desincronizan
sin que alguien lo note.

---

## 5. Multiplataforma (Android + iOS)

Cada versión publicada puede llevar **un chunk por plataforma**:

- El registro guarda, por versión: `url` + `manifest.integrity` para
  **Android**, y opcionalmente `iosUrl` + `iosIntegrity` para **iOS** (misma
  versión, dos artefactos — la integridad es **por-plataforma** porque los
  bytes del chunk difieren).
- En storage, el chunk Android vive en `${id}/${version}/` y el iOS en el
  subfolder `${id}/${version}/ios/` — mismo nombre de container
  (`<id>.container.js.bundle`) en ambos, distinto contenido.
- `GET /api/resolve?platform=ios` devuelve `iosUrl` con `manifest.integrity`
  **pisado** por `iosIntegrity`; sin ese parámetro (o `platform=android`)
  resuelve el chunk Android, exactamente como antes de que existiera iOS.
- El publish soporta **un upload por plataforma**, adjuntado a la misma
  versión (`platform=android` primero fija la versión vía auto-bump,
  `platform=ios` se adjunta después) — o un solo upload si la miniapp todavía
  no publica iOS (compatible hacia atrás).
- El host detecta la plataforma automáticamente (`Platform.OS`) — nada que
  configurar de su lado. Verificado end-to-end en iPhone real; los tres
  miniapps de referencia (`hellow_widget`, `cards_wallet`,
  `account_dashboard`) publican ambas plataformas.

---

## 6. Seguridad y ownership

**Dos niveles de autorización:**
- **Platform-admins** (`SCAFFOLD_ALLOWED_LOGINS`, CSV de logins de GitHub,
  case-insensitive) — pueden crear miniapps y gestionar **cualquier**
  miniapp existente (publish/deploy/pin/borrar/maintainers). Vacío = nadie
  puede (fail-closed por diseño).
- **Maintainers por-miniapp** (`MiniappRecord.maintainers`) — gestionan
  **solo** esa miniapp, sin necesitar ser platform-admin. `canManageMiniapp`
  autoriza si el login está en el conjunto admin ∪ maintainer de esa miniapp.
  **Restricción dura:** solo se puede asignar como maintainer a alguien que
  ya es **collaborator del repo de GitHub** de esa miniapp — el server lo
  valida en `PUT /api/miniapps/:id/maintainers` (rechaza con `400` cualquier
  login que no lo sea).

**Tokens de servicio:**
- `PUBLISH_TOKEN` — el que valida cada CI de miniapp al publicar
  (`/upload`). Soporta rotación **dual-token** (`PUBLISH_TOKEN` +
  `PUBLISH_TOKENS_OLD` como CSV) para rotar sin downtime, con un endpoint
  admin (`POST /api/admin/reseed-secrets`) que resiembra el token nuevo en
  todos los repos del registry.
- `HOST_CONTRACT_TOKEN` — separado del anterior; solo autoriza `PUT
  /api/host-contract` (publicar el contrato del host).
- `GITHUB_TOKEN` del server — necesita los scopes `repo` + `workflow` +
  `delete_repo` + `read:packages` para poder crear repos desde el template,
  administrar Actions (permisos + secrets), leer contenidos (drift), abrir
  issues (capability requests), borrar repos, e instalar el paquete privado
  del contrato en el build.

**Integridad de artefactos:** cada chunk publicado lleva un hash **sha256**;
el host lo verifica antes de montar — si no coincide, es un
`integrity-failed` (fallback transitorio, ver §7).

**Autenticidad (firma de chunks):** sobre la integridad, la plataforma soporta
**firmar** los chunks (Ed25519). El sha256 prueba que los bytes no cambiaron;
la firma prueba que los publicó alguien autorizado — cierra el caso de un
atacante que controle a la vez el storage y el registry. Modelo de dos niveles:
cada miniapp firma con su clave privada por-repo, y el owner firma la tabla
`{miniapp → pubkey}` (el *trust bundle*, `GET /api/trust-bundle`) con una clave
**root** offline pineada en el host. Está **live y validado en producción**: las 3
miniapps de la flota publican chunks firmados que verifican contra el trust bundle
root-firmado (v1). El host verifica en modo **warn** por default (monta igual +
métrica) y pasa a **enforce** (bloquea sin firma válida) vía el flag build-time
`SIGNATURE_MODE`. (Sin `ROOT_PUBLIC_KEY` pineada la verificación está off — pero en
prod ya está pineada.) Ver `docs/API-REFERENCE.md` §5.7.

**Capabilities como modelo de permisos:** en vez de exponer credenciales
crudas a una miniapp, el host le inyecta un `CapabilityGrant` acotado a la
sesión actual, con soporte de revocación (`isRevoked()`). La miniapp declara
qué capabilities necesita en su manifest; sin el grant correspondiente,
muestra su propia pantalla de acceso denegado — el host nunca decide la UX
de eso, solo otorga o no el permiso.

---

## 7. Observabilidad

**Métricas:**
- **Mounts por miniapp** — cuántas veces se montó cada una, útil para saber
  qué se usa.
- **Fallbacks por razón** — cada fallo de montaje se clasifica y cuenta por
  su causa.

**Taxonomía de fallback del host** (definida en `host-runtime`):

| Razón | Naturaleza | Significado |
|---|---|---|
| `resolve-failed` | transitorio | Backstage no respondió o no encontró la miniapp/versión |
| `download-failed` | transitorio | Falló la descarga del chunk (red, CDN) |
| `integrity-failed` | transitorio | El sha256 descargado no coincide con el declarado |
| `invalid-manifest` | permanente | El manifest tiene una forma inválida |
| `skew` | permanente | El manifest no es compatible con lo que el host provee hoy |
| `host-too-old` | permanente | La miniapp requiere un `minHostContract` mayor al `contractVersion` de este binario |

Los **transitorios** habilitan auto-retry en el host; los **permanentes**
no — necesitan una acción humana (republicar la miniapp, actualizar el
host).

**Badges en el catálogo:**
- **Drift** — si la miniapp está desactualizada respecto al template
  (candidata a `template-sync`).
- **CI** — último resultado de GitHub Actions del repo de esa miniapp
  (con fallback resiliente a `unknown`, nunca rompe la UI).

---

## 8. Mapa de repos

| Repo | Rol |
|---|---|
| **`backstage-web`** | Control-plane (Next.js). Registry, catálogo, scaffolder, compat gate, storage (R2/Blob/fs), métricas, API de distribución (`/api/resolve`). |
| **`backstagereactnative`** | Host móvil (RN + Re.Pack, Module Federation v2). Contiene los paquetes `host-runtime` (loader: resolve→verify→mount→fallback), `miniapp-contract` (tipos + contrato compartido) y `ui-kit` (primitivas de UI compartidas). |
| **`miniapp-template`** | Repo GitHub **template** (público). Scaffold base + CI reutilizable (`publish.yml`) + mecanismo de Capa 2 (template-sync). |
| **`miniapp-hellow_widget`**, **`miniapp-cards_wallet`**, **`miniapp-account-dashboard`** | Miniapps de referencia — cada una su propio repo, generado desde el template (o migrado, en el caso de `account_dashboard`), publicando Android + iOS. |

---

## 9. Glosario

- **Miniapp** — feature independiente empaquetada como remote de Module
  Federation, en su propio repo.
- **Host** — el binario móvil único que carga y monta miniapps en runtime.
- **Registry** — la base de datos de Backstage: miniapps, versiones, urls,
  manifests.
- **Chunk** — el bundle JS federado que produce el build de una miniapp.
- **Host Contract** — declaración versionada de lo que el host provee
  (shared singletons + módulos nativos + contractVersion).
- **Compat gate** — chequeo automático al publicar: ¿el manifest de la
  miniapp es compatible con el Host Contract actual?
- **Blast-radius** — chequeo automático en el CI del host: ¿un cambio de
  deps del host rompe alguna miniapp ya publicada?
- **Capability** — permiso acotado y revocable que el host otorga a una
  miniapp (nunca un credential crudo).
- **Served version / pinned version** — la versión que efectivamente se
  resuelve (`pinnedVersion ?? latest`); pinnear congela/rollbackea sin
  redeploy.
- **Capa 2 (template-sync)** — el mecanismo de PRs de 3-way merge que
  propaga mejoras del template a la flota de miniapps ya creadas.
- **Remote / federation** — terminología de Module Federation: un "remote"
  es un bundle que otro bundle (el "host"/"shell") carga dinámicamente en
  runtime; cada miniapp es un remote, el host móvil es el shell.

---

## 10. Ver también

- [Tutorial](/docs/tutorial) — ejemplo de punta a punta con código real, para
  practicar los conceptos de este mental model con las manos en el teclado
  (próximamente).
- [`docs/SETUP.md`](./SETUP.md) — levantar toda la plataforma desde cero
  para una empresa nueva (cuentas, provisioning, env vars, checklist final).
- [`docs/LOCAL-DEV.md`](./LOCAL-DEV.md) — el inner loop de desarrollo local
  (build→publish→ver-en-host, y los modos de hot-reload).
- [`docs/miniapps-guide.md`](./miniapps-guide.md) — ciclo de vida completo de
  una miniapp: crear → publicar → usar.
- [`docs/actualizar-miniapp.md`](./actualizar-miniapp.md) — cómo un equipo de
  miniapp trae mejoras del template (Capa 2, template-sync).
- [`docs/activar-compat-gates.md`](./activar-compat-gates.md) — runbook para
  encender los gates de compatibilidad (warn → enforce).
- [`docs/rotar-publish-token.md`](./rotar-publish-token.md) — rotar el
  `PUBLISH_TOKEN` sin downtime.
- `backstagereactnative/apps/host/RUN.md` — cómo correr el host en los 4
  escenarios (dev/prod × Android/iOS) + los modos de dev-loop de miniapps.
- `backstagereactnative/docs/mounting-miniapps.md` — playbook para montar una
  miniapp en cualquier punto del host + troubleshooting del lado nativo.
- `INTEGRATION-GUIDE.md` — guía de integración para equipos externos que
  quieren publicar una miniapp contra esta plataforma (contrato, manifest,
  capabilities, checklist de publish).
