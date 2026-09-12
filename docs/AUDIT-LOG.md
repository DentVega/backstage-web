# Audit log

Registro **append-only y tamper-evidente** de quién hizo qué en el control-plane:
publicaciones y cambios de gestión. Sirve para trazabilidad y seguridad — saber qué
usuarios interactúan con las publicaciones y auditar cambios sensibles.

## Qué registra

Cada **mutación** del control-plane deja un evento. Las lecturas **no** se registran.

| Acción | Cuándo | `details` |
|---|---|---|
| `publish` | se publica una versión (`upload` o `publish`) | `{ version, platform, integrity, signed }` |
| `register` | se registra una miniapp | `{}` |
| `scaffold` | se crea una miniapp desde el template | `{ repo }` |
| `pin` | pin/rollback de la versión servida | `{ from, to }` |
| `patch` | se edita metadata (`repoUrl`/`owner`) | `{ fields }` |
| `delete-miniapp` | se borra una miniapp | `{ versions, repoDeleted }` |
| `delete-version` | se borra una versión | `{ version }` |
| `set-maintainers` | cambian los maintainers | `{ added, removed }` |
| `set-storage-provider` | cambia el storage override | `{ provider }` |
| `set-public-key` | alta/rotación/baja de la pubkey de firma | `{ hasKey }` (nunca la llave) |
| `seed` | se siembra el catálogo | `{ count }` (cadena global) |

> `details` **nunca** incluye secretos (llaves privadas, tokens). `set-public-key`
> solo registra si quedó o no una llave (`hasKey`).

## Atribución (quién)

- **UI** (sesión): el evento se atribuye al `login` de GitHub de la sesión
  (`{ type: "user", login }`).
- **CI** (publish con `PUBLISH_TOKEN`): el CI reporta `github.actor` + commit + repo
  → `{ type: "ci", login: "<actor>", commit, repo }`. El template
  (`scripts/publish.mjs`) los manda automáticamente desde las env-vars de GitHub
  Actions (`GITHUB_ACTOR`/`GITHUB_SHA`/`GITHUB_REPOSITORY`). Si un repo aún no
  sincronizó el template, el evento cae a `{ type: "ci", login: "ci" }` (sin persona).

## Cómo se ve

- **Página `/audit`** (solo admins): feed global con filtros por acción y actor, y un
  banner de integridad de las cadenas.
- **Panel "Historial"** en el detalle de cada miniapp: su cadena, visible para los
  **maintainers** de esa miniapp (o admins).
- **API**: `GET /api/audit` (`?miniapp=&actor=&action=&limit=`) y `GET /api/audit/verify`.
  Ver [API Reference](/docs/api-reference#6-observabilidad).

## Acceso

Los **admins de auditoría** se configuran con la env var `AUDIT_ADMIN_LOGINS` (CSV de
logins de GitHub). Vacía → **fail-closed**: nadie ve el feed global. Los maintainers de
una miniapp siempre ven la cadena de **su** miniapp (`?miniapp=<id>`), sin necesidad de
estar en la allowlist.

## Integridad — tamper-evidente (no tamper-proof)

El log es un **hash-chain por cadena** (una por miniapp + una global): cada evento
incluye el hash del anterior. Si alguien borra o edita una entrada en KV, la cadena se
rompe en ese punto y `GET /api/audit/verify` lo detecta (`brokenAt: <seq>`), señalado en
rojo en `/audit`.

> [!WARNING]
> Esto es tamper-**evidente**, no tamper-**proof**. Detecta borrados y ediciones
> parciales o accidentales. Un administrador con acceso **total** a la base KV que
> recompute una cadena entera podría reescribirla sin dejar rastro. Blindar ese caso
> requeriría exportar cada evento a un sink externo append-only — hoy fuera de alcance.

## Retención

Las cadenas se guardan **completas** (no se truncan — cortar rompería el hash-chain y
perdería historia de seguridad). El volumen es bajo (publicaciones/cambios por día).

## Notas

- En **producción** el log vive en Upstash KV. En **desarrollo** (sin credenciales KV)
  usa un store en memoria efímero — el historial se pierde al reiniciar el proceso.
- El registro es **fire-and-forward**: si un append falla, se loguea pero **no** tumba
  la operación de negocio (el publish/cambio ya está cometido).
