# Activar los gates de compatibilidad de dependencias

Guía operacional para **encender** el sistema anti-drift/compat (Fases 1-4). Todo el
código está en prod pero en **modo warn** (loguea, no bloquea). Esta secuencia lo
lleva a **enforce** sin romper nada — cada paso es reversible y nada bloquea publishes
hasta el Paso 5.

> Fondo técnico: `docs/superpowers/specs/2026-07-29-dependency-compatibility-design.md`.
> Estado del código: memoria `dependency-compatibility.md`.

## Panorama

```
Paso 0  Secrets/config            (prereq)
Paso 1  Publicar el host contract → los gates warn empiezan con datos reales
Paso 2  Sincronizar la flota       (template-sync → cada miniapp recibe los scripts)
Paso 3  Backfill                   (re-publicar → manifests truthful en el registry)
Paso 4  Validar en sombra          (revisar warn logs; ¿alguien incompatible?)
Paso 5  ENFORCE                    (COMPAT_ENFORCE=1 + branch protection) ← acá sí bloquea
Paso 6  (opcional) republish + precisión de warn logs
```

**Regla de oro:** hasta el Paso 5, todo es warn-first — ningún publish se rompe.

---

## Paso 0 — Secrets y config

**0.1 — Generar el token del host contract** (dedicado; NO es el PUBLISH_TOKEN):
```bash
openssl rand -hex 32   # → <HOST_CONTRACT_TOKEN>
```

**0.2 — Backstage (Vercel env, production):**
```bash
vercel env add HOST_CONTRACT_TOKEN production   # pegás <HOST_CONTRACT_TOKEN>
vercel env add HOST_REPO production             # ej. DentVega/backstagereactnative
vercel --prod                                   # redeploy para tomar el env
```
(`BACKSTAGE_URL`, `GITHUB_TOKEN`, `KV_*`, `BLOB_*` ya están.)

**0.3 — Repo del host (`backstagereactnative`) → Settings → Secrets and variables → Actions:**
- Secret `BACKSTAGE_URL` = `https://<tu-backstage>` (para los workflows `host-contract` y `host-compat`).
- Secret `HOST_CONTRACT_TOKEN` = el mismo `<HOST_CONTRACT_TOKEN>` de 0.1.

**Verificación:**
```bash
vercel env ls production | grep -E "HOST_CONTRACT_TOKEN|HOST_REPO"
```

---

## Paso 1 — Publicar el host contract

Hace que Backstage tenga el contract REAL (versiones de los singletons + módulos nativos).
Sin esto, todos los gates degradan a "no contract → skip".

**Opción A (workflow):** en el repo del host, correr el workflow **Publish host contract**
(Actions → Run workflow / `workflow_dispatch`).

**Opción B (manual, desde `apps/host`):**
```bash
cd apps/host
BACKSTAGE_URL=https://<tu-backstage> HOST_CONTRACT_TOKEN=<...> \
  bash -c 'node scripts/gen-host-contract.mjs && node scripts/publish-host-contract.mjs'
```

**Verificación:**
```bash
curl -s https://<tu-backstage>/api/host-contract | python3 -m json.tool
# debe mostrar { contractVersion, reactNative, shared:{...}, nativeModules:[...] }
# nativeModules esperado: flash-list, safe-area-context, screens, @callstack/repack
```
Desde acá, el gate warn-mode de `/upload` y `resolveDefaultShared` usan datos reales.

---

## Paso 2 — Sincronizar la flota

Cada miniapp existente necesita los scripts del gate (`gen-manifest-shared.mjs`,
`check-compat.mjs`) + la dep `semver`. Llegan vía **template-sync** (Capa 2). Hasta que
una miniapp sincroniza, su gate se saltea (guard de existencia) — no rompe.

Para cada miniapp (o desde Backstage con el botón **"Actualizar desde template"**):
```bash
gh workflow run template-sync.yml --repo DentVega/miniapp-<id> --ref main
```
Se abre un PR de sync en cada repo → **revisás y mergeás** (trae los scripts + `semver`).

**Verificación:** en un repo de miniapp sincronizado, `ls scripts/gen-manifest-shared.mjs`
existe y `grep semver package.json` aparece.

---

## Paso 3 — Backfill (manifests truthful)

Hoy los manifests publicados tienen `shared` vacío/hand-written y sin `nativeModules`.
Re-publicar cada miniapp hace que su CI corra `gen-manifest-shared` → el manifest queda
**truthful** (shared derivado del lockfile ∩ contract + nativeModules autolinkeados).

Para cada miniapp sincronizada (Paso 2), disparar un publish — botón **Deploy** en
Backstage, o:
```bash
gh workflow run publish.yml --repo DentVega/miniapp-<id> --ref main
# (o ci.yml, según cómo dispare el publish tu miniapp)
```

**Verificación:**
```bash
curl -s https://<tu-backstage>/api/resolve?id=<id> | python3 -c \
  "import sys,json;m=json.load(sys.stdin)['manifest'];print('shared:',m.get('shared'));print('nativeModules:',m.get('nativeModules'))"
# shared ya NO debe ser null/vacío; nativeModules poblado si la miniapp usa nativos.
```
> Sin este paso, el blast-radius de Fase 4 y los gates están "ciegos" (manifests vacíos
> se tratan como at-risk). El backfill es lo que los hace ver de verdad.

---

## Paso 4 — Validar en sombra

Antes de enforce, confirmar que **nadie queda incompatible** con el contract actual.

- **Logs de Backstage (Vercel):** buscar `compat[...]: INCOMPATIBLE`. Si aparece alguna
  miniapp, migrala (ajustar su dep / pedir la capability nativa) ANTES de enforce.
- **Blast-radius manual (opcional):** en el repo del host, correr el gate contra la flota
  actual sin cambiar nada — debería dar 0 rotas:
  ```bash
  cd apps/host && BACKSTAGE_URL=https://<tu-backstage> node scripts/check-host-compat.mjs
  ```

Cuando los warn logs estén limpios (0 incompatibles), estás listo para enforce.

### Resultado shadow validation — 2026-08-03 ✅

Calculado contra el host contract live (`contractVersion 0.0.1`, RN 0.76.6):

| Miniapp | Veredicto vs contract |
|---|---|
| `cards_wallet` 0.1.5 | ✅ compatible (react ^18.3.1, RN ^0.76.6; nativo `@callstack/repack` provisto) |
| `hellow_widget` 0.1.5 | ✅ compatible (react ^18.3.0, RN ^0.76.0) |
| `account_dashboard` 0.7.0 | ✅ compatible (react/RN/react-query/flash-list, todos satisfechos) |

**Cero incompatibles → cero falsos positivos.** Enforce es seguro para los 3.

### Excepción conocida: `account_dashboard`

Repo **migrado** (no del template), NO enrolado en template-sync, publica por un
`publish.mjs` legacy que **saltea el gate del CI** (no tiene `publish.yml` reusable ni los
scripts). Decisión: **NO enrolarlo** (alto esfuerzo / bajo valor: tsconfig roto, repoUrl
falso). Su backstop es el **enforce server-side (5.3)** — y como hoy es compatible, ni
siquiera lo bloquearía. Si en el futuro se republica incompatible, el `/upload` lo frena.

---

## Paso 5 — ENFORCE (acá sí bloquea) 🔒

**5.1 — Gate de publish de miniapps** (Capa 1, aplica a todas): en el repo del **template**
(o a nivel org) → Settings → Secrets and variables → Actions → **Variables** → crear
`COMPAT_ENFORCE` = `1`.
Desde ahora, `check-compat` **falla el build** de una miniapp incompatible (en vez de warn).

**5.2 — Gate de gobernanza del host** (host→flota): en el repo del **host** → Settings →
Branches → Branch protection rule para `main` → marcar el check **`Host compat gate
(blast-radius)`** como **Required**.
Desde ahora, un cambio de deps del host que rompa la flota **no se puede mergear** (salvo
que se agregue el label `accept-breaking-contract`, que deja registro).

**5.3 — Backstop server-side** (`/upload` → 422): en **Vercel env (production)** setear
`COMPAT_ENFORCE=1` + redeploy. Desde ahora, el `/upload` **rechaza con 422** un manifest
incompatible (skew de shared o nativo faltante) — cubre repos que saltean el CI (ej.
`account_dashboard`) y cualquier POST directo al endpoint. Construido 2026-08-03 (commit
del server enforce). Rollout-safe: si el propio check crashea, loguea y NO bloquea; solo
frena una incompatibilidad real. Default (sin la var) sigue siendo warn.
```bash
vercel env add COMPAT_ENFORCE production   # valor: 1
vercel --prod
```

**Verificación:** un PR de prueba con un bump incompatible debe quedar con CI ❌ / merge
bloqueado (5.1/5.2); un POST directo a `/upload` con un manifest incompatible → HTTP 422
(5.3).

---

## Paso 6 — (Opcional) Precisión y belt extra

No hace falta para enforce, pero mejora:

- **Republish del contract package v0.3.0** + bump de la dep en `backstage-web` → el gate
  warn de `/upload` pasa a usar el `satisfiesShared` con **semver real** (hoy usa el
  mínimo de 0.1.0, que puede dar falsos incompatibles en warn logs con rangos raros).
  El host y las miniapps ya usan la lógica correcta (workspace / self-contained).
  _(El backstop server-side `/upload` → 422 ya está construido — ver Paso 5.3.)_

---

## Rollback / seguridad

- **Cada paso es reversible.** Volver a warn: borrar la var `COMPAT_ENFORCE` (o ponerla en
  `0`) y sacar el "required" del check del host.
- **Nada rompe hasta el Paso 5.** Los Pasos 1-4 solo agregan datos y loguean.
- **Emergencia en un publish de miniapp:** `SKIP_COMPAT_CHECK` no aplica (el gate ya es
  warn/enforce por var); para desbloquear, poné `COMPAT_ENFORCE=0` temporalmente.
- **Emergencia en un cambio del host que DEBE romper la flota:** agregá el label
  `accept-breaking-contract` al PR (queda registrado quién aceptó el break).

## Ver también

- [Actualizar desde template](/docs/actualizar-miniapp) — el Paso 2 de este
  runbook (sync de la flota) depende de este mecanismo para llegar a cada miniapp.
- [Compat gate](/docs/compat-gate) — el deep-dive conceptual: qué valida cada
  gate y por qué, más allá de los pasos operativos de acá.
- [Rotar PUBLISH_TOKEN](/docs/rotar-publish-token) — mismo patrón operativo
  (rollout gradual y reversible) aplicado a otra rotación.
- [Troubleshooting](/docs/troubleshooting) — sección "El compat gate te frena"
  si algo de este runbook no te dio el resultado esperado.
