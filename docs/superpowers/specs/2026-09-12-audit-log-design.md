# Audit log tamper-evidente — Design

> **Estado:** aprobado (brainstorming 2026-09-12). Próximo paso: writing-plans.

## Problema

Hoy no hay registro de **quién** hizo **qué** en el control-plane. Cuando se publica una
versión, se pinea/rollbackea, se borra una miniapp o se cambian maintainers, la acción ocurre
sin dejar rastro atribuible. Para seguridad y trazabilidad hace falta un historial: qué usuarios
publican/interactúan con las publicaciones, y qué cambió, cuándo y desde dónde.

## Objetivo

Un **audit log append-only, tamper-evidente**, que registre publishes + todas las mutaciones del
control-plane con **atribución real por-persona** (incluida la del CI), consultable por admins
(feed global) y por maintainers (historial de su miniapp).

## Decisiones (del brainstorming)

1. **Eventos:** publishes + todas las acciones de gestión (no lecturas).
2. **Actor del CI:** persona real vía `github.actor` (+ commit/repo); fallback a `ci` si no viene.
3. **Anti-tamper:** append-only + **hash-chain** (tamper-evidente). Sin sink externo.
4. **Acceso:** página `/audit` para admins (allowlist) + panel "Historial" por-miniapp para sus
   maintainers.

## Arquitectura

Módulo nuevo `lib/audit/`. Un **hash-chain append-only por cadena**:

- **Una cadena por miniapp:** `audit:chain:<id>` (lista de eventos, más nuevo primero) +
  `audit:head:<id>` (hash del último evento).
- **Una cadena global:** `_global` para acciones no ligadas a una miniapp específica (ej. `seed`).
- **Índice de cadenas:** set `audit:chains` con los ids de cadena existentes (incl. `_global`).

**Por qué por-cadena y no una sola lista global:** aliña con el registry por-miniapp — equipos en
miniapps distintas **no contienden** en el audit tampoco — y cada cadena se verifica de forma
independiente. El feed global de `/audit` se arma **mergeando** todas las cadenas por timestamp;
no es storage aparte.

### El hash-chain

Cada evento:

```ts
interface AuditActor {
  type: "user" | "ci";
  login: string;          // github login, o "ci" si el CI no mandó actor
  commit?: string;        // solo CI: GITHUB_SHA
  repo?: string;          // solo CI: repo que publicó
}

interface AuditEvent {
  seq: number;            // 1-based, por cadena
  ts: number;             // Date.now() al momento del append
  actor: AuditActor;
  action: AuditAction;    // "publish" | "pin" | "delete-miniapp" | ...
  chain: string;          // miniapp id o "_global"
  miniappId?: string;     // presente salvo acciones _global
  details: Record<string, unknown>; // específico de la acción (ver abajo)
  prevHash: string;       // hash del evento anterior en la cadena ("" para el primero)
  hash: string;           // sha256_base64url(prevHash + canonical(evento sin `hash`))
}
```

`hash = sha256_base64url(prevHash + canonicalize(evento_sin_campo_hash))`, donde `canonicalize`
serializa el evento con **claves ordenadas** (JSON determinístico) para que el hash sea estable.
`sha256` vía `node:crypto`, salida en base64url (consistente con el resto del proyecto, que ya usa
base64url para llaves/firmas).

### Append atómico (mismo patrón que `mutateApp`)

El append es una operación cross-key (LPUSH a la lista + SET de la cabeza) que debe ser atómica y
resistente a concurrencia. Se resuelve con **CAS+Lua**, idéntico en espíritu a `casSet`:

1. Leer `audit:head:<chain>` → `prevHash` (o `""` si no existe).
2. Leer `seq` actual (largo de la lista) para el nuevo `seq = len + 1`.
3. Construir el evento con `prevHash`, computar `hash`.
4. **Atómicamente (Lua):** si `audit:head:<chain>` sigue siendo `prevHash`, entonces
   `LPUSH audit:chain:<chain> <evento>` y `SET audit:head:<chain> <hash>`; sino, `0`.
5. Si el CAS falla (otro writer ganó), reintentar con backoff+jitter (`MAX_RETRIES=15`, misma
   constante y `backoffMs` que `kv.ts`). Si se agota, lanzar `ConflictError`.
6. En el primer evento de una cadena, `sadd(audit:chains, chain)`.

> El append audita **después** de que la mutación de negocio ya cometió (fire-and-forward). Si el
> append falla tras agotar reintentos, se loguea el error pero **no** se revierte ni se falla la
> request de negocio — el audit no debe tumbar un publish exitoso. (Trade-off explícito: preferimos
> no perder la acción de negocio; un fallo de append es raro y queda en logs.)

### Verificación

`verifyChain(events: AuditEvent[]): { ok: boolean; brokenAt?: number }` — pura. Recorre la cadena
del más viejo al más nuevo recomputando cada `hash` a partir de `prevHash`, y chequea que
`events[i].prevHash === events[i-1].hash`. Devuelve el primer `seq` donde se rompe. Un borrado o
edición en KV rompe la cadena en ese punto y se detecta.

## Honestidad de seguridad

Esto es tamper-**evidente**, no tamper-**proof**:

- ✅ Detecta borrados/ediciones **parciales** de entradas, y ediciones accidentales.
- ✅ No hay endpoint de borrado/edición desde la app (append-only por diseño).
- ⚠️ Un admin con acceso **total** a KV que recompute una cadena entera (todas las entradas + la
  cabeza) podría reescribirla sin dejar rastro. Blindar eso requería un **sink externo append-only**
  (opción descartada en el brainstorming por sumar infra/dependencia).

Esta limitación se documenta explícitamente en el doc de seguridad y el ADR.

## Actor

Helper `resolveActor(req, session): Promise<AuditActor>`:

- **UI:** si hay `session.githubLogin`, `{ type:"user", login }`.
- **CI:** si no hay sesión (Bearer `PUBLISH_TOKEN`), leer del request los campos `actor`/`commit`/
  `repo` que manda el CI → `{ type:"ci", login: actor ?? "ci", commit, repo }`. Si no vienen
  (repos aún sin sincronizar el template), `{ type:"ci", login:"ci" }`.

Reusa la misma lógica de `authorizeUpload` (`auth()` + `scaffoldAllowedLogins`/token) sin duplicar
la autorización — `resolveActor` se llama **después** de que la ruta ya autorizó.

### Cambio en el template (`miniapp-template/scripts/publish.mjs`)

El script de publish suma al request de upload los campos:

- `actor` ← `process.env.GITHUB_ACTOR`
- `commit` ← `process.env.GITHUB_SHA`
- `repo` ← `process.env.GITHUB_REPOSITORY`

(Los tres son env-vars auto-provistas por GitHub Actions; no requieren secrets nuevos.) Es un
cambio en `scripts/*.mjs`, que **es template-owned** → se propaga por template-sync a la flota.

## Eventos registrados y sus `details`

Wiring: una llamada explícita `recordAudit({ actor, action, miniappId, details })` en cada ruta
**después** de la mutación exitosa. Se elige esto sobre meterlo dentro de `mutateApp` porque la
semántica de la acción y sus `details` difieren por ruta, y mantiene el store puro.

| Acción (`action`) | Ruta | `details` |
|---|---|---|
| `publish` | `upload` | `{ version, platform?, integrity, signed: boolean }` |
| `register` | `register` | `{ }` |
| `pin` | `pin` | `{ from?, to }` (versión pineada anterior → nueva) |
| `patch` | `[id]` PATCH | `{ fields: string[] }` (qué campos cambiaron) |
| `delete-miniapp` | `[id]` DELETE | `{ versions: number }` (cuántas versiones tenía) |
| `delete-version` | `versions/[version]` | `{ version }` |
| `set-maintainers` | `maintainers` | `{ added: string[], removed: string[] }` |
| `set-storage-provider` | `storage-provider` | `{ provider }` |
| `set-public-key` | `public-key` | `{ hasKey: boolean }` (nunca la llave privada) |
| `scaffold` | `scaffold` | `{ template?, repo? }` |
| `seed` | `seed` | `{ count }` → cadena `_global` |

> `details` nunca incluye secretos (llaves privadas, tokens). `set-public-key` registra solo
> `hasKey`.

## Superficie / acceso

- `GET /api/audit?miniapp=&actor=&action=&limit=` — feed mergeado de todas las cadenas ordenado por
  `ts` desc, con filtros opcionales. Detrás de auth (sesión válida); si `miniapp` está presente, el
  caller debe ser admin **o** maintainer de esa miniapp; sin `miniapp` (feed global), solo admins.
- `GET /api/audit/verify` — corre `verifyChain` sobre cada cadena; devuelve `{ ok, chains: [{chain,
  ok, brokenAt?}] }`. Solo admins.
- Página **`/audit`** (server component): feed global con filtros (miniapp/actor/acción) + banner de
  integridad (verde "cadenas íntegras" / rojo "cadena X rota en seq N"). Solo **admins**
  (`AUDIT_ADMIN_LOGINS`).
- Panel **"Historial"** en el detalle de la miniapp (`app/miniapps/[id]`): su cadena, visible para
  sus **maintainers** (o admins).

### Allowlist de admins

`auditAdminLogins()` en `lib/config.ts` (env `AUDIT_ADMIN_LOGINS`, CSV) — clon del patrón
`scaffoldAllowedLogins()`. La verificación de acceso **reusa los checks existentes de
`lib/scaffold-authz.ts`** (sin duplicar lógica):

- **Admin (feed global / `/api/audit/verify` / página `/audit`):**
  `canScaffold(login, auditAdminLogins())`.
- **Por-miniapp (`/api/audit?miniapp=<id>` / panel "Historial"):**
  `canManageMiniapp(login, rec.maintainers, auditAdminLogins())` — true si es admin **o** maintainer
  de esa miniapp. Ya existe y es exactamente el check que necesitamos.

## Retención

Cadenas **completas** — no se hace `LTRIM` (cortar rompería el chain y perdería historia de
seguridad). El volumen es bajo (publishes/cambios por día × flota chica). Si el tamaño llega a
importar, se archiva por rango a Blob, nunca se trunca en caliente. Fuera de alcance por ahora.

## Estructura de archivos

**Nuevos:**
- `lib/audit/types.ts` — `AuditEvent`, `AuditActor`, `AuditAction`, `RecordAuditInput`.
- `lib/audit/chain.ts` — puro: `canonicalize(evt)`, `computeHash(prevHash, evt)`,
  `verifyChain(events)`.
- `lib/audit/log.ts` — `recordAudit(input)`, `readChain(chain)`, `readAll(filters)`,
  `verifyAudit()`. Usa el KvClient (`casAppend` + `lrange` + `smembers`).
- `lib/audit/actor.ts` — `resolveActor(req, session)`.
- `lib/audit/__tests__/{chain,log,actor}.test.ts`.
- `app/api/audit/route.ts`, `app/api/audit/verify/route.ts`.
- `app/audit/page.tsx` + `app/audit/audit-table.tsx` (client, filtros).
- ADR nuevo: **ADR-016** (audit log) — `memory-bank/bolts/<bolt-id>/adr-016.md` según la convención
  de `memory-bank/standards/system-architecture.md`; referenciado por número en el código.
- Doc de seguridad/auditoría en `docs/` + wire en `lib/docs/nav.ts`.

**Modificados:**
- `lib/registry/kv.ts` — sumar al `KvClient`: `lpush(key,value)`, `lrange(key,start,stop)`,
  `casAppend(headKey, listKey, expectedHead, newHead, entry)` (Lua Upstash + in-memory).
- `lib/config.ts` — `auditAdminLogins()`.
- Las ~11 rutas mutantes + `upload`: 1 línea `recordAudit(...)` tras la mutación.
- Componente de detalle de miniapp: panel "Historial".
- `miniapp-template/scripts/publish.mjs` — mandar `actor`/`commit`/`repo`.
- Docs (docs-sync): API-REFERENCE, PLATFORM-OVERVIEW, GLOSARIO.

## Manejo de errores

- Append falla tras `MAX_RETRIES` → se loguea, **no** se revierte la mutación de negocio ni se
  falla la request (el audit es secundario a la acción ya cometida).
- `GET /api/audit` sin permisos → 401/403 (`AuthError` → `statusForError`).
- Cadena rota detectada por `verify` → 200 con `ok:false` + `brokenAt` (no es un error HTTP; es un
  hallazgo de integridad que la UI muestra en rojo).

## Testing

- **`chain.ts` (puro):** append conceptual (computeHash encadena), `verifyChain` OK sobre cadena
  válida, `verifyChain` detecta (a) entrada editada, (b) entrada borrada del medio, (c) cabeza
  desalineada — devolviendo el `brokenAt` correcto. `canonicalize` estable ante orden de claves.
- **`actor.ts`:** UI → user; CI con actor → ci+login; CI sin actor → ci fallback.
- **`log.ts`:** `recordAudit` sobre in-memory KvClient crea cadena + índice; appends concurrentes
  simulados (CAS) no pierden eventos y mantienen la cadena verificable; `readAll` mergea+ordena;
  filtros por miniapp/actor/action.
- **Rutas:** cada mutación exitosa deja un evento con el `action`/`details` correcto (mock del
  KvClient/log); `/api/audit` global exige admin; con `miniapp` permite maintainer.
- El **in-memory KvClient** implementa `casAppend`/`lpush`/`lrange`, cubriendo el append atómico en
  tests sin Upstash real.

## Fuera de alcance (YAGNI)

- Sink externo append-only (tamper-proof real).
- Archivado/rotación de cadenas por tamaño.
- Auditar lecturas.
- Anti-rollback persistente / firma de la cadena con la root key (posible follow-up: firmar la
  cabeza de cada cadena con la root key para tamper-proof sin sink externo).
