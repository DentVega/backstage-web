# `pnpm dev` — orquestador declarativo del dev-loop — diseño

**Fecha:** 2026-08-14
**Repo:** `backstagereactnative` (host). **Estado:** aprobado (brainstorming en sesión).
**Referencia:** patrón de `rimac-phase-support` (RN + Re.Pack + MF v2 + `mprocs`), adaptado.

## Problema

Correr el dev-loop hoy son muchos comandos y env vars a mano: Modo 1 (`DEV_MINIAPP_PATHS=…`),
Modo 2 (arrancar N dev servers en puertos distintos + `adb reverse` por puerto + `DEV_REMOTES=…`
+ host). Queremos **un comando** manejado por un **config declarativo** por-miniapp.

## Diferencia con la referencia

Rimac tiene las miniapps **en el monorepo** y **cablea remotes estáticamente**. Nosotros las
tenemos en **repos separados** (hermanos) y el host resuelve **dinámico** (Backstage `/api/resolve`
+ override `DEV_REMOTES` + alias de dev-mount) — ADR-009: montar *cualquier* miniapp sin cablearla.
→ Adoptamos **la capa config + orquestador**, NO el cableado estático. El config apunta a los
**paths de los repos hermanos** (el dev los mantiene a mano) + puerto + modo + autostart.

## Componentes

### 1. Config — `apps/host/dev-miniapps.config.mjs` (fuente única, gitignored)
Array declarativo; se commitea `dev-miniapps.config.example.mjs` como plantilla.
```js
export const devMiniapps = [
  { id: 'hellow_widget',     path: '../../miniapp-hellow_widget',     mode: 'mount',  autostart: true },
  { id: 'cards_wallet',      path: '../../miniapp-cards_wallet',      mode: 'remote', port: 9000, autostart: true },
  { id: 'account_dashboard', path: '../../miniapp-account-dashboard', mode: 'remote', port: 9001, autostart: false },
];
```
- `id`: id de la miniapp (= id de catálogo / manifest).
- `path`: relativo (desde `apps/host`) o absoluto al repo hermano. Mantenido a mano.
- `mode`: `'mount'` (dev-mount, Fast Refresh, va al bundle del host) | `'remote'` (dev server federado en `port`).
- `port`: requerido si `mode:'remote'`.
- `autostart`: si arranca prendida. Remotes → autostart de su dev server (togglable en el TUI). Mount → incluida en `DEV_MINIAPP_PATHS` al arrancar.

### 2. Helper puro — `apps/host/scripts/dev-plan.mjs`
`buildDevPlan(config, resolvePath)` → plan validado:
```
{
  mountPaths: string[],        // mode:'mount' && autostart, abs, capado a MAX_DEV_MINIAPPS (6)
  remotes: [{id, port, cwd, autostart}],   // mode:'remote'
  devMiniappPathsEnv: string,  // mountPaths.join(',')
  devRemotesEnv: string,       // "id=http://localhost:port,…" (TODOS los remotes)
  adbPorts: number[],          // [3999, ...puertos de remotes] deduped
}
```
Valida: `remote` requiere `port`; puertos únicos entre remotes; `path` presente; warn (no error) si hay >6 mounts (se capa). Es puro → **node:test**.

### 3. Orquestador — `apps/host/scripts/dev.mjs` (`pnpm dev`)
1. Importa el config (`.mjs`; si falta, usa `.example` con un warning claro).
2. Resuelve paths a absolutos (relativo al dir del config).
3. `buildDevPlan(...)`.
4. Genera la config de **mprocs** desde el plan:
   - `setup-adb` (autostart): `adb reverse` de `3999` + cada puerto de remote (así togglear un remote luego ya tiene el puerto reenviado).
   - `Host` (autostart): `pnpm --filter @app/host start` con `env` `DEV_MINIAPP_PATHS` + `DEV_REMOTES` del plan.
   - 1 proc por `remote`: `react-native webpack-start --port <port>` con `cwd` = path del repo, `autostart` del config.
   - `android` / `ios` (autostart:false): `pnpm --filter @app/host android|ios` para (re)instalar la app cuando quieras.
5. Corre `mprocs -c <yaml generado>`.

### 4. Wiring
- `apps/host/package.json`: script `"dev": "node scripts/dev.mjs"` + devDep `mprocs` (+ serializador YAML si hace falta).
- `.gitignore`: `apps/host/dev-miniapps.config.mjs` + el YAML generado (`apps/host/.mprocs.generated.yaml`).

## Alcance v1

- **Ambos modos** (mount + remote), mezclables.
- **Android emulador + iOS simulador** (localhost; iOS sim no necesita `adb reverse`).
- **iPhone físico** (DEVICE_IP + `--host 0.0.0.0`) → **v2** (anotado, fuera de v1).
- **Backward-compat**: `DEV_MINIAPP_PATHS`/`DEV_REMOTES` manuales siguen andando; `pnpm dev` es aditivo.

## Manejo de errores / bordes

- Config faltante → usar `.example` + warning (no crash).
- `remote` sin `port` o puertos duplicados → error claro antes de arrancar mprocs.
- >6 mounts → se capa a 6 con warning (límite de slots del dev-mount).
- Remote con dev server apagado (autostart:false, no togglead) → el host muestra su fallback normal (resolve/download-failed); no rompe.

## Testing

`dev-plan.test.mjs` (node:test) sobre `buildDevPlan`: mount→paths, remote→env+adb, validación (port faltante, puertos duplicados), cap de 6, mezcla. El `dev.mjs` (I/O + spawn de mprocs) queda fuera de test unitario (verificación manual: `pnpm dev` levanta el dashboard).

## Fuera de alcance (YAGNI)

Generar los `--port` en cada `package.json` de miniapp (los pasa el orquestador), fallback-plugin de MF nuevo (el host ya tiene fallback reasons), scaffolding con auto-puerto, iPhone físico.

## Doc

`backstage-web/docs/LOCAL-DEV.md` §6: nueva sección "Un comando: `pnpm dev`" con el config + el flujo.
