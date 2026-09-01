# Changelog

Esto es el registro de hitos de **toda la plataforma** — Backstage web (control-plane), el host móvil
(`backstagereactnative`, React Native + Re.Pack) y el `miniapp-template` — no de un repo aislado. Está
pensado para que un integrador, el equipo interno o liderazgo pueda ver de un vistazo cómo evolucionó
la plataforma y qué hay disponible hoy.

> [!NOTE]
> Las fechas salen del historial de git real de los tres repos (`backstage-web`, `backstagereactnative`,
> `miniapp-template`). Es un registro **curado por hito**, no un dump de commits: varios commits
> relacionados (spec → plan → implementación → docs) se agrupan bajo la fecha en la que el hito quedó
> funcionando. No es exhaustivo — quedan afuera fixes menores, refactors internos y ajustes de estilo
> que no cambian una capacidad de la plataforma.

---

## 2026-09-01 · Firma de chunks — **activada y validada en producción**

La firma quedó **live end-to-end**. Las 3 miniapps de la flota publican chunks firmados que
**verifican** contra el trust bundle root-firmado (v1). El host verifica en modo **warn** por
default (monta + emite métrica ante una firma faltante/inválida) y pasa a **enforce** (bloquea)
vía el flag build-time `SIGNATURE_MODE`. El **rechazo se probó** end-to-end: una versión sin
firma → en warn incrementa `invalid-signature` en `/metrics`, en enforce muestra la pantalla
"no pudimos verificar la firma".

- **CI (template):** `scripts/publish.mjs` firma el chunk con el secret `MINIAPP_SIGN_KEY`
  (lee el container de disco, sin deps externas). Degrada seguro sin el secret.
- **Host:** verifica con `@noble/curves` contra la pubkey del trust bundle; razones de fallback
  `invalid-signature`/`unknown-key`; `ROOT_PUBLIC_KEY` + `SIGNATURE_MODE` pineados en el build.
- **Observabilidad:** `/metrics` ahora cuenta `invalid-signature`/`unknown-key`.
- **Operativa:** claves generadas (root + 3 miniapps), pubkeys registradas, trust bundle v1
  firmado y publicado. Ver [SETUP](/docs/setup) §7.5.

## 2026-08-27 · Firma de chunks — backend (autenticidad, no solo integridad)

Sobre el hash sha256 (que prueba **integridad**), la plataforma suma **firma** Ed25519 de
los chunks (prueba **autenticidad**: quién publicó). Cierra el caso de un atacante que
controle a la vez el storage y el registry — un hash recalculado no le alcanza sin la clave.
Modelo de dos niveles: cada miniapp firma con su clave privada por-repo, y el owner firma
la tabla `{miniapp→pubkey}` (*trust bundle*) con una clave **root** offline pineada en el
host. Ver [API Reference](/docs/api-reference) §5.7 y [Platform Overview](/docs/platform-overview) §6.

- **Backend (backstage-web, este hito):** `POST /upload` acepta un campo `signature` y lo
  guarda por versión/plataforma (sanity-verify best-effort contra la pubkey registrada);
  `/api/resolve` la sirve en `manifest.signature`; `PUT /api/miniapps/:id/public-key`
  registra/rota la pubkey de cada miniapp; `GET/PUT /api/trust-bundle` sirve y guarda la
  tabla firmada; CLI `scripts/keygen.mjs` + `scripts/sign-trust-bundle.mjs` para firmar
  offline. Aditivo, sin migración.
- **CI + host (completado 2026-09-01, ver el hito de arriba):** la firma en la CI de cada
  miniapp (`publish.mjs` + secret `MINIAPP_SIGN_KEY`, vía el template) y la **verificación en
  el host** (pin de la pubkey root, fetch+verify del trust bundle, warn→enforce).

## 2026-08-13 → 2026-08-14 · Dev-loop de un comando: `pnpm dev` + iPhone físico

El dev-loop deja de ser "N terminales + env vars + `adb reverse` a mano". Un **config
declarativo** por-miniapp (`dev-miniapps.config.mjs`) + un orquestador (`mprocs`) levantan
todo con un solo `pnpm dev`. Ver [Desarrollo local](/docs/local-dev).

- **`pnpm dev`** deriva del config `DEV_MINIAPP_PATHS` / `DEV_REMOTES` / los `adb reverse`, y
  arranca en un dashboard: el Host (Metro/Re.Pack), un dev server por remote, el Backstage
  opcional y procesos on-demand `app-android`/`app-ios`. `autostart` decide qué prende; el
  resto se prende/apaga en caliente desde el TUI. `DEV_DRY=1` imprime el plan sin arrancar.
- **Modo 1 multi-miniapp**: dev-mount de varias miniapps a la vez con un **selector (tabs)**
  en la pantalla Dev Mount — editar cualquiera Fast-Refreshea.
- **`pnpm dev:scan`** arma el config solo: detecta las miniapps hermanas (`../miniapp-*` con
  `manifest.json`) y las agrega preservando lo tuyo (preview por default, `--write` aplica).
- **Multi-device**: `app-android`/`app-ios` eligen device (o `ANDROID_SERIAL`/`IOS_UDID`), y
  el `adb reverse` recorre **todos** los devices conectados (adiós "more than one device").
- **Preflight**: si una miniapp no está `pnpm install`ada, corta con un mensaje claro en vez
  del error críptico de rspack.
- **iPhone / Android físico por LAN** (`pnpm dev --device`): los dev servers RN se bindean a
  la **IP LAN de la Mac** (no `0.0.0.0`), así el cliente de HMR del device apunta a esa IP y
  el **Fast Refresh anda por Wi-Fi, sin `iproxy`**. La IP sale de `--ip=` > `DEVICE_IP` >
  `device.ip` del config > auto-detección. En discos externos (`/Volumes`) el file watching
  cae a **polling** para que el HMR detecte las ediciones.

## 2026-08-12 · Sitio de docs: pulido final + mecanismo anti-drift

Última pasada sobre `/docs`: variantes de contenido, referencia de API completa, y un mecanismo para
que la documentación no se desactualice silenciosamente cuando cambia el código.

- Callouts (`Nota`/`Tip`/`Importante`/`Atención`/`Cuidado`) y nueva página [Quickstart](/docs/quickstart).
- Tabs (`:::tabs` / `:::tab`) para mostrar variantes en paralelo (por ejemplo Android vs iOS).
- Tema de código on-brand + barra de lenguaje y botón de copiar en los bloques de código.
- [API & Schema Reference](/docs/api-reference) y grupo "Referencia" en el nav.
- Se suman al sitio los docs que vivían solo en el repo del host (correr el host, montar miniapps).
- **docs-sync**: un mapa código→docs (`docs-map`), un hook que detecta drift cross-repo después de cada
  edición, y un skill que actualiza la doc afectada verificando contra el código real.
- Tutorial worked-example de punta a punta + sección "Próximos pasos", más una pasada de precisión y
  [Troubleshooting/FAQ](/docs/troubleshooting) y los deep-dives de [Host Contract](/docs/host-contract) y
  [Compat gate](/docs/compat-gate).

## 2026-08-11 · Nace el sitio de documentación público

Antes de esto, la documentación vivía como archivos `.md` sueltos en el repo. Este día se renderizan
como un sitio real en `/docs`.

- `/docs` sirve los `.md` del repo con una experiencia tipo Nextra: syntax highlighting, tabla de
  contenidos, anclas por sección, navegación prev/next y copiar-código.
- Búsqueda tipo command palette (Ctrl+K) sobre todas las docs.
- Diagramas ASCII reemplazados por diagramas HTML/CSS on-brand.
- Dos piezas nuevas para audiencias específicas: [Platform Overview](/docs/platform-overview) (mental
  model completo para equipos internos) e [Integration Guide](/docs/integration-guide) (para quien
  integra una miniapp desde afuera).

## 2026-08-10 · Soporte iOS end-to-end (#13)

La plataforma deja de ser Android-only. Corte vertical completo: registry, upload, resolve y el host
mismo distinguen plataforma.

- Registry: `iosUrl`/`iosIntegrity` en el manifest, attach en `publishVersion`.
- Upload: el campo `platform` en el form sube el chunk a un subfolder por plataforma con su propia
  integridad (sha256).
- `GET /api/resolve?platform=ios`.
- Host: el resolve manda `Platform.OS`; en dev, el dev-server sirve la plataforma pedida en el request.
- Template: el CI del miniapp buildea y publica el chunk iOS junto al de Android.
- Los tres miniapps de la flota (`hellow_widget`, `cards_wallet`, `account_dashboard`) terminan
  publicando iOS+Android.

Ese mismo día se sumaron otros tres hitos independientes:

**Autorización por miniapp (#3)** — hasta acá, crear una miniapp requería estar en el allowlist global
(platform-admins). Ahora existen *maintainers por miniapp*: ownership sin necesitar acceso global, con
autocompletado restringido a los colaboradores reales del repo de GitHub y el campo owner prellenado
con tu usuario.

**Fan-out del template-sync (#16)** — un botón dispara el "Actualizar desde template" (Capa 2) contra
toda la flota de miniapps de una sola vez, en vez de repo por repo. Ver
[Actualizar desde template](/docs/actualizar-miniapp).

**Poda y borrado de versiones (#11)** — al publicar se borran chunks viejos automáticamente (se
conservan las últimas N + la que está servida), y además existe borrado manual por versión desde la UI,
protegido para no borrar la versión pineada.

**Métricas: tooltips + leyenda fija** — la página de Metrics gana un tooltip explicativo por razón de
fallback (transitorio vs permanente) y una leyenda siempre visible con las 6 razones posibles, más un
tooltip explicativo por capability (`accounts:read`, `session:whoami`) en el detalle de la miniapp.

## 2026-08-09 · Métricas de la plataforma + resolve cache (#12)

- Página `/metrics`: telemetría de mount/fallback del host, ingest + contadores en KV, dashboard.
- Cache de resolve en memoria, keyed por versión, del lado del host (menos latencia en el path
  crítico de montaje).
- El host empieza a reportar esa telemetría a Backstage en cada montaje o fallback (esta pieza se
  mergeó un día después, el 08-10, junto con el resto del corte iOS).

## 2026-08-08 · El catálogo refleja la versión realmente servida

`servedVersion` se expone en el catálogo y la card del host muestra explícitamente cuándo una miniapp
está pineada/en rollback, en vez de mostrar siempre la última versión publicada.

## 2026-08-06 · Pin / rollback de versión por miniapp (#10)

Cada miniapp puede quedar pineada a una versión específica en vez de servir siempre la última —
la base para poder hacer rollback sin republicar.

## 2026-08-04 · Reconciliación de dependencias compartidas

El host reconcilia su `package.json` contra la clasificación de `SHARED_DEPS`, para detectar
divergencias antes de que se conviertan en un problema de compatibilidad real.

## 2026-08-03 · Borrar miniapp+repo, enforcement server-side, storage por miniapp, contrato 0.3.0

Día grande, cuatro capacidades distintas:

**Borrar miniapp + repo de GitHub** — control de "zona de peligro" en la UI (confirmación tipeada,
checkbox opcional para borrar también el repo). `DELETE ?repo=true` es repo-first y fail-safe;
`GitProvider.deleteRepo` maneja 204/404/403 explícitamente.

**Gate de compatibilidad: enforcement real** — hasta acá el gate solo advertía (warn-mode). Ahora
`COMPAT_ENFORCE=1` bloquea el publish con 422, y además el chequeo se corre en PR-time (shift-left)
sobre el repo del miniapp, con branch protection exigiéndolo en los miniapps públicos. Ver
[Compat gate](/docs/compat-gate).

**Storage por-miniapp** — además del storage provider global, se puede pinear un provider distinto
por miniapp individual (`PUT /api/miniapps/:id/storage-provider`).

**`@dentvega/miniapp-contract` 0.3.0** — se dropea la copia local de `HostContract` y se consume el
paquete publicado como única fuente de verdad, compartido entre Backstage, el host y el template.

## 2026-08-02 · Storage en Cloudflare R2

Segundo backend de storage además de Vercel Blob: adaptador R2 vía `aws4fetch`, con selección de
provider activo por API (`GET/PUT /api/storage-provider`) y preferencia guardada en KV.
`getStorage` prioriza R2 → Blob → filesystem local según lo configurado.

## 2026-07-29 → 2026-07-31 · Host Contract + Gates de compatibilidad de dependencias (Fase 1, warn-mode)

El hito más grande de gobernanza de la plataforma: evita que un miniapp incompatible con el host llegue
a producción, y evita que un cambio en el host rompa miniapps ya publicados.

- `HostContract`: tipo + store en KV/JSON, endpoint `GET/PUT` protegido por token, generado y publicado
  automáticamente por el host (`gen-host-contract.mjs`) en cada release.
- Gate en `/upload`, primero en modo warn (no bloquea, solo avisa).
- Paquete `@dentvega/miniapp-contract` con `HostContract`, `minHostContract` y comparación semver real
  (`satisfiesShared`).
- El template suma su propio compat gate en CI (`check-compat.yml`, warn-first, `COMPAT_ENFORCE` para
  bloquear).
- Chequeo de módulos nativos (`checkNativeModules`/`checkCompatibility`) y apertura automática de un
  issue de GitHub cuando una miniapp pide una capability nativa que el host no tiene.
- Gate de gobernanza del lado host ("blast-radius"): `GET /api/manifests` + `check-host-compat` bloquean
  un cambio de dependencias en el host si rompe algún miniapp ya publicado.
- Runbook para pasar cada gate de warn a enforce. Ver [Compat gates](/docs/compat-gates) y
  [Host Contract](/docs/host-contract).

## 2026-07-23 · Rotación de token, bootstrap de adopción, drift badge, dev-loop

Cuatro capacidades operativas que quedan disponibles el mismo día:

**Rotación de `PUBLISH_TOKEN` sin downtime** — tokens duales (`dual-token`) con comparación
timing-safe; se puede emitir un token nuevo, re-sembrar secrets, y recién después revocar el viejo, sin
ventana en la que el publish falle. Ver [Rotar PUBLISH_TOKEN](/docs/rotar-publish-token).

**Bootstrap de adopción** — un CLI (`bootstrap.mjs`, dry-run por default) que renombra scope/owner para
templatizar toda la plataforma en una empresa nueva, más la guía unificada SETUP.md. Ver
[Setup](/docs/setup).

**Badge de drift** — indicador en el catálogo y el detalle de cada miniapp que muestra si su copia de
`ci/` divergió del template.

**Dev-loop con hot reload** — Modo 1 (dev-mount) y Modo 2 (dev server) para iterar sobre una miniapp en
el host local sin publicar cada cambio. Ver [Desarrollo local](/docs/local-dev).

También se agrega CI (tsc + vitest) sobre pushes y PRs de `backstage-web`.

## 2026-07-21 · Template-sync "Capa 2" + Deploy button + paquetes @dentvega

- **Template-sync Capa 2**: PR de 3-way merge que propaga cambios del template a un miniapp existente
  sin pisar lo que el miniapp ya personalizó, con un botón "Actualizar desde template" en el detalle de
  Backstage.
- **Deploy button**: un click dispara el CI del miniapp (`workflow_dispatch`) desde la UI de Backstage.
- Los paquetes compartidos (`contract`, `ui-kit`) se publican bajo el scope `@dentvega` en GitHub
  Packages, reemplazando el scope genérico anterior.
- El scaffolder ahora siembra automáticamente `BACKSTAGE_URL` + `PUBLISH_TOKEN` como secrets del repo
  nuevo y habilita que las Actions puedan crear PRs — sin pasos manuales post-creación.

## 2026-07-18 · Home dinámica del host (catalog-driven)

La pantalla principal del host móvil deja de tener una lista fija de miniapps y pasa a construirse a
partir del catálogo real que expone Backstage.

## 2026-07-14 · Integridad de chunks (sha256)

Backstage calcula el sha256 de cada chunk al publicarlo; el host lo verifica antes de montarlo. Cierra
el hueco entre "lo que se publicó" y "lo que se ejecuta en el dispositivo".

## 2026-07-13 · Primera miniapp montada on-device + publish desde la UI

- El host logra resolver y montar una miniapp federada (Module Federation, Re.Pack) en un dispositivo
  real por primera vez, con un loader genérico y un playbook de montaje documentado.
- Backstage suma la posibilidad de publicar una nueva versión de una miniapp directamente desde la UI
  (antes era solo vía CI).

## 2026-07-10 · Nace la plataforma

Commit inicial de los tres repos el mismo día: Backstage web (registry + scaffolder + auth + estado de
CI), el host móvil (monorepo React Native + Re.Pack) y el `miniapp-template` (scaffold de un remote
federado). Ese mismo día:

- El host corre por primera vez en un dispositivo real (unblock de dependencias nativas + runtime de
  Module Federation).
- Backstage gana un flujo de creación de miniapp "reachable + validado" y un guard de autorización por
  allowlist de logins de GitHub para poder scaffoldear.
- Se aplica el sistema de diseño "Registry Console" a toda la UI.

---

*Rango cubierto por este changelog: 2026-07-10 (primer commit, los tres repos) → 2026-08-14 (último
commit al momento de escribir esto).*
