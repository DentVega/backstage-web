# Firma de chunks (Opción B: firma en CI + root del owner)

**Fecha:** 2026-08-26
**Estado:** Diseño aprobado — listo para plan
**Roadmap:** ítem #2 (Seguridad / production-hardening), hasta ahora DIFERIDO.

## Problema

Hoy cada chunk se protege con un hash de integridad: al publicar, el server calcula
`sha256-<hex>` de los bytes reales del container (`lib/integrity.ts`) y lo guarda
(`manifest.integrity` para Android; `iosIntegrity` para iOS). El host descarga el chunk,
recalcula el sha256 y compara contra ese hash.

El chunk vive en **R2** (storage) y el hash de referencia vive en **KV** (registry): dos
canales separados. Esto ya rechaza un **swap de un solo canal** (chunk cambiado en R2 sin
tocar KV, o al revés). Pero **no** cubre al atacante que controla **los dos canales a la vez**
(mete el chunk malicioso en R2 **y** recalcula su sha256 en KV): el host descarga el chunk
malo, le saca el hash, compara contra el hash malo, coinciden, lo monta. El hash no tiene
secreto — cualquiera que escriba en KV puede recalcular un hash válido.

**La firma agrega autenticidad:** un secreto (clave privada) que el atacante no tiene. El hash
prueba integridad ("estos bytes no cambiaron respecto a ese hash"); la firma prueba
autenticidad ("este chunk lo publicó alguien autorizado").

## Decisión de fondo: dónde vive la clave

Se evaluaron tres opciones (análisis previo 2026-08-10):

- **A — firma server-side** (clave en env de Vercel). ~1 día. Cierra el escenario "R2+KV sin
  Vercel", pero **no** cubre server comprometido ni `PUBLISH_TOKEN` robado (el server tiene la
  clave).
- **B — firma en CI, clave privada por-repo** (secret de cada miniapp). El server nunca ve la
  clave. **Elegida.** Única que cubre también server comprometido / token robado.
- **C — keyless/OIDC (Sigstore-style)**. Descartada: infra de PKI + log de transparencia +
  verificador X.509 en el host; pensada para escala npm/PyPI (miles de publishers desconocidos),
  no para un owner único con miniapps propias.

### El punto crítico de B: ancla de confianza de las pubkeys

En B cada miniapp firma con su privada; el host verifica con la **pubkey** correspondiente. Si
esa pubkey se sirviera desde el mismo **KV** que no confiamos, el atacante que controla KV
cambiaría también la pubkey por la suya → firma con su clave → el host verifica contra la
pubkey del atacante → **B roto** (degrada por debajo de A). Por eso el ancla **no puede ser KV**.

**Decisión: jerarquía de dos niveles con root del owner.**

| Nivel | Clave privada vive en… | Firma qué | Pública la conoce… |
|---|---|---|---|
| **Root (owner)** | máquina del owner (offline, **nunca** Vercel) | la tabla `{miniapp→pubkey}` | el host, **pineada en el binario** |
| **Miniapp (CI)** | GH secret `MINIAPP_SIGN_KEY` de cada repo | el chunk de esa miniapp | el host, vía la tabla firmada por root |

El atacante no tiene la privada root → no puede fabricar una tabla válida → no puede inyectar su
propia pubkey. Esto es lo que salva a B de un KV/server comprometido.

### Activación: enforce directo

El host exige firma válida **desde el día uno** (sin modo warn). Requiere republicar las 3
miniapps firmadas **antes** de soltar el host nuevo. Es más simple de codear y el riesgo se
maneja con la secuencia de rollout (§Rollout), porque el enforce está gateado naturalmente por
el release nativo del host (el host viejo ignora las firmas y sigue andando).

## Cripto y qué se firma

- **Algoritmo:** Ed25519. Host: `@noble/ed25519` (JS puro, sin nativo). Backend y CLI:
  `node:crypto` (soporta Ed25519). Firmas de 64 bytes, pubkeys de 32 bytes, codificadas en
  **base64**.
- **Mensaje que firma el CI:** el string canónico `"<id>:<platform>:<integrity>"`, donde
  `integrity` es el `sha256-<hex>` que ya se calcula. Firmar el hash (no los bytes crudos)
  encadena con la verificación de integridad que el host ya hace.
- **`version` NO va en el mensaje** — a propósito: el server auto-bumpea la versión, así que el
  CI no la conoce al firmar. El binding `id:platform:integrity` igual ata la firma a esos bytes
  exactos de esa miniapp/plataforma.
  - **Residual aceptado:** alguien podría re-servir un chunk *legítimo* bajo otro número de
    versión (replay de código legítimo, no inyección). Las versiones inmutables + enforce lo
    hacen irrelevante.

## Trust bundle (tabla de confianza)

Cuerpo:

```jsonc
{
  "version": 3,               // monotónico; el host rechaza un rollback a versión menor
  "updatedAt": "2026-08-26T…",
  "keys": {
    "hellow_widget": "<pubkey b64>",
    "cards_wallet":  "<pubkey b64>",
    "account_dashboard": "<pubkey b64>"
  }
}
```

Servido junto a su firma root:

```jsonc
{ "bundle": { …cuerpo… }, "signature": "<firma root sobre el JSON canónico del cuerpo>" }
```

- Se guarda en **KV** bajo la key `trust-bundle`. Servirlo desde KV es seguro: se auto-valida
  con la firma root (pubkey root pineada en el host).
- `version` monotónico → revocación / anti-rollback. El host guarda el `version` más alto visto
  y rechaza uno menor.
- **Canonicalización:** el cuerpo se serializa con claves ordenadas de forma determinística
  (mismo algoritmo en CLI que firma y en host que verifica) para que la firma sea estable.

## Cambios de datos y contrato

Aditivos, sin migración (mismo patrón que `iosIntegrity`/`iosUrl`).

**`lib/registry/types.ts`:**

```ts
export interface PublishedVersion {
  // …existentes…
  readonly signature?: string;    // firma Ed25519 del chunk Android (b64)
  readonly iosSignature?: string; // firma del chunk iOS (b64)
}

export interface MiniappRecord {
  // …existentes…
  readonly publicKey?: string;    // pubkey actual de la miniapp (b64) — SOLO conveniencia
}
```

> `MiniappRecord.publicKey` vive en KV (no confiable). **No es la autoridad** — sirve para la UI
> y para que la CLI arme el borrador del bundle. La autoridad es la tabla firmada por root, que
> el owner revisa (diff) antes de firmar.

**Contrato `@dentvega/miniapp-contract`** (bump de versión del paquete):

```ts
export interface Manifest {
  // …existentes…
  readonly integrity?: string;
  readonly signature?: string;    // nuevo — devuelto por el resolve; iOS spreadea iosSignature
}
```

## Cambios en backstage-web (alcance de este plan)

1. **`lib/crypto/ed25519.ts`** (nuevo, puro) — `sign(msg, privKey)`, `verify(msg, sig, pubKey)`,
   `canonicalBundleMessage(body)`. Backend usa `node:crypto`.
2. **Upload route** (`app/api/miniapps/[id]/upload/route.ts`) — lee el form field `signature` y
   lo guarda en la versión (por plataforma, igual que `integrity`). **Sanity-check best-effort:**
   si `MiniappRecord.publicKey` existe y la firma no valida `id:platform:integrity` → `400`
   (feedback temprano al publisher). El host sigue siendo la autoridad final.
3. **`publishVersion`** (`lib/registry/registry.ts`) — input `+= signature?`; se adjunta por
   plataforma (Android en la versión nueva, iOS attach a la existente).
4. **Resolve** (`resolveMiniapp` + `/api/resolve`) — incluye `signature` en `manifest`; iOS hace
   spread de `iosSignature` (igual que hoy con `iosIntegrity`).
5. **Registro de pubkey** — `setMiniappPublicKey(reg, id, pubkey|null)` +
   `PUT /api/miniapps/:id/public-key` (gate `canManageMiniapp` → admin o el maintainer). Sirve
   para registrar y para **rotar**.
6. **Trust bundle endpoints** — `GET /api/trust-bundle` (público, sirve el bundle firmado desde
   KV) + `PUT /api/trust-bundle` (gate `canScaffold`, guarda el bundle que produjo la CLI). Store
   en KV bajo `trust-bundle`.

## CLI de firma (offline, en la máquina del owner)

Scripts en `scripts/` — corren local; el root private key **nunca se commitea ni toca Vercel**.

- **`scripts/keygen.mjs`** — genera un par Ed25519 (para el root una vez; para cada miniapp).
- **`scripts/sign-trust-bundle.mjs`** — lee las pubkeys actuales (de `/api/miniapps`), arma el
  cuerpo del bundle, muestra el **diff contra el bundle live** para revisión, firma con el root
  private key (leído de un archivo/env local que pasa el owner), bumpea `version`, y hace
  `PUT /api/trust-bundle`.

Rotar/revocar = re-generar o quitar la pubkey y re-correr `sign-trust-bundle` (bump de versión).
La misma herramienta cubre alta, rotación y revocación.

## CI / template (out-of-band, vía Capa 2 — descrito, no ejecutado en este plan)

- **`scripts/publish.mjs`** (template): antes de subir, calcula el sha256 del container, firma
  `id:platform:integrity` con `MINIAPP_SIGN_KEY` (GH secret) y manda el form field `signature`,
  por plataforma (Android e iOS cada una). **Degradación:** publish.mjs viejo sin el secret →
  sube sin firma → el host nuevo la rechaza (enforce), que es lo buscado.
- **Alta de claves:** `keygen` una vez por miniapp → privada al secret `MINIAPP_SIGN_KEY` del
  repo, pública registrada vía el endpoint (§backstage 5). Para miniapps **nuevas**,
  `scaffoldSecrets()` genera el par y siembra el secret automáticamente.

## Host (out-of-band, repo separado — descrito, no ejecutado en este plan)

- Pinea `ROOT_PUBLIC_KEY` (constante en código del host).
- Al arrancar: `GET /api/trust-bundle` → verifica firma root con la pubkey pineada → cachea.
  Anti-rollback: guarda el `version` más alto visto (AsyncStorage) y rechaza uno menor.
- Al montar: saca la pubkey de la miniapp del bundle (ausente → `unknown-key`, no-retryable).
  Verifica integridad (sha256, ya lo hace) **y** la firma Ed25519 sobre `id:platform:integrity`
  contra esa pubkey (falla → `invalid-signature`, no-retryable). **Enforce siempre.**
- Dependencia `@noble/ed25519`.

## Rollout (enforce directo exige orden)

1. **Deploy backstage-web** (acepta/sirve firmas + endpoints de bundle). Aditivo — el host viejo
   ignora los campos nuevos.
2. **Keygen** de las 3 miniapps + registrar pubkeys + correr `sign-trust-bundle` (primer bundle).
3. **Template `publish.mjs` firmado** → propagar por Capa 2 → **republicar las 3 miniapps
   firmadas** (la versión servida de cada una queda firmada).
4. **Recién ahí, release del host nuevo** que hace enforce.

> ⚠️ Con enforce directo, al salir el host nuevo la **versión servida** de cada miniapp tiene que
> estar firmada (paso 3) o esa miniapp queda rota. Versiones viejas sin firma pedidas explícitas
> con `?version=` fallarían — aceptable.

## Testing (en este repo)

- **Unit:** `ed25519` sign/verify; canonicalización + verificación de firma root del bundle;
  upload guarda `signature`; resolve devuelve `signature` (Android + spread iOS);
  `setMiniappPublicKey` set/rotación; store/serve del bundle; binding `id:platform:integrity`
  (rechaza mensaje alterado).
- **CLI:** test golden de que `sign-trust-bundle` firma determinísticamente el mismo cuerpo.

## Qué NO cubre (fuera de alcance)

- **Repo/CI de una miniapp comprometido**: publica algo malicioso *firmado legítimamente*. Se
  defiende con branch protection + code review, no con firma.
- Rotación automática programada de claves (se hace manual con la CLI cuando haga falta).
- HSM / custodia avanzada del root key (vive en la máquina del owner; suficiente para la escala
  actual de owner único).

## Relación con otros ítems

- Reemplaza el estado DIFERIDO del roadmap #2. Ver `platform-roadmap`.
- Se apoya en Capa 2 (`capa2-template-sync`) para propagar `publish.mjs` firmado a la flota.
- El host es repo separado; el trabajo del host va coordinado out-of-band (patrón de #9, #13).
