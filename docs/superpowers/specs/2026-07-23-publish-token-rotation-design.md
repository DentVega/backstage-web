# Rotación de `PUBLISH_TOKEN` (dual-token + reseed)

**Fecha:** 2026-07-23
**Estado:** Diseño aprobado — listo para plan de implementación
**Owner:** DentVega
**Roadmap:** #1 (🔴 seguridad / production-hardening)

## 1. Contexto y objetivo

Hoy el `PUBLISH_TOKEN` es `dev-publish-secret`: un valor débil, **compartido** entre
todas las miniapps y **auto-distribuido** por el scaffolder al secret de Actions de
cada repo al crearlo. Cualquiera con el token puede publicar chunks al registry.

**Objetivo:** rotarlo a un token fuerte, con una rotación **cero-downtime** (ninguna
miniapp falla al publicar durante el cambio) y **reutilizable** (la próxima rotación
debe ser trivial). No es el token por-miniapp revocable (ese es el paso grande,
roadmap #1-futuro) — es la base que lo habilita.

### Estado actual (mapa)

- **Validación:** `lib/auth.ts:11-18` `requirePublishToken(req)` — lee
  `Authorization: Bearer <token>`, compara con `process.env.PUBLISH_TOKEN` vía `!==`
  plano (**no timing-safe**), lanza `AuthError` → HTTP 401. Sin fallback hardcodeado.
- **Consumidores del guard:** `app/api/miniapps/[id]/upload/route.ts` (vía
  `authorizeUpload` local: sesión allowlisted **o** `requirePublishToken`) y
  `app/api/seed/route.ts` (`requirePublishToken` directo).
- **Hueco:** `app/api/miniapps/[id]/publish/route.ts` (publish JSON al registry) **no
  tiene ningún check de auth**.
- **Seeding:** `lib/scaffold.ts:63-74` itera `scaffoldSecrets()` (`lib/config.ts:19-26`
  → `{ BACKSTAGE_URL, PUBLISH_TOKEN }` desde env) y llama
  `gitProvider.setSecret` (libsodium sealed-box, `lib/git/github.ts:93-141`) por
  secret. **Solo corre al crear el repo** — no hay re-seed.
- **Registry:** `getStore().load()` → `Record<id, MiniappRecord>` con `owner`/`repoUrl`;
  el repo se reconstruye como `miniapp-${id}` (convención de `lib/scaffold.ts:44`).

## 2. Decisiones tomadas

1. **Estrategia:** dual-token + reseed (cero-downtime), no swap simple ni per-miniapp.
2. **Re-seed:** endpoint admin en Backstage (`POST /api/admin/reseed-secrets`),
   reutilizable, no un script one-off.
3. **Hardening adyacente foldeado:** comparación timing-safe **y** cerrar el hueco de
   auth en `/publish`.
4. **Valores de token:** nunca en el repo/spec/docs/memoria. El runbook usa
   placeholders; el owner genera y setea los valores (`vercel env`, `.env.local`).

## 3. Componentes

### 3.1 Validación dual-token + timing-safe — `lib/auth.ts`

`requirePublishToken` valida contra un **conjunto** de tokens válidos:

- `PUBLISH_TOKEN` — el token fuerte (primario).
- `PUBLISH_TOKENS_OLD` — lista separada por comas de tokens viejos aún aceptados
  durante la transición. Ausente/vacío en estado estable.

```ts
function validPublishTokens(): string[] {
  const primary = process.env.PUBLISH_TOKEN ?? "";
  const old = (process.env.PUBLISH_TOKENS_OLD ?? "")
    .split(",")
    .map((t) => t.trim());
  return [primary, ...old].filter((t) => t.length > 0);
}

function safeEqual(a: string, b: string): boolean {
  const ah = crypto.createHash("sha256").update(a).digest();
  const bh = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(ah, bh);
}

export function requirePublishToken(req: Request): void {
  const valid = validPublishTokens();
  if (valid.length === 0) throw new AuthError("PUBLISH_TOKEN not configured");
  const header = req.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!valid.some((v) => safeEqual(token, v))) throw new AuthError();
}
```

- El sha256-de-cada-lado antes de `timingSafeEqual` fija la longitud → evita el throw
  de `timingSafeEqual` por largos distintos y no filtra la longitud del token.
- El comportamiento observable no cambia para el caller: sigue lanzando `AuthError`
  (→ 401) en token inválido/ausente, y `AuthError("PUBLISH_TOKEN not configured")`
  si no hay ningún token configurado.

### 3.2 Guard compartido `authorizeUpload` — `lib/auth.ts`

Hoy `authorizeUpload` vive local en `upload/route.ts`. Se **mueve a `lib/auth.ts`** y se
exporta, sin cambiar su semántica (sesión allowlisted vía `canScaffold`, **o** fallback
a `requirePublishToken`). `upload/route.ts` pasa a importarlo. Esto lo hace reusable en
`/publish` (§3.4).

### 3.3 Helper de seeding reutilizable — `lib/scaffold.ts`

El loop de seeding inline (`lib/scaffold.ts:63-74`) se extrae a una función exportada:

```ts
export async function seedRepoSecrets(
  gitProvider: GitProvider,
  owner: string,
  repo: string,
  secrets: Record<string, string>,
): Promise<void> {
  for (const [name, value] of Object.entries(secrets)) {
    try {
      await gitProvider.setSecret({ owner, repo, name, value });
    } catch (err) {
      console.warn(`setSecret ${name} failed for ${owner}/${repo}:`, err);
    }
  }
}
```

`scaffoldMiniapp` pasa a llamar `seedRepoSecrets(gitProvider, input.owner, repo, secrets)`
en vez del loop inline (comportamiento idéntico: best-effort por secret, no aborta el
scaffold). El reseed (§3.4) reusa el mismo helper.

### 3.4 Endpoint de reseed — `app/api/admin/reseed-secrets/route.ts`

```
POST /api/admin/reseed-secrets
```

- **Guard:** sesión allowlisted (`canScaffold`) — **no** el publish token. Es una acción
  administrativa. Sin sesión válida → 401/403 (mismo patrón que las rutas de scaffold).
- **Cuerpo:** ninguno.
- **Lógica:** carga el registry (`getStore().load()`), y por cada
  `rec` en `Object.values(reg)`:
  - repo = `miniapp-${rec.id}` (convención de scaffold).
  - `await seedRepoSecrets(gitProvider, rec.owner, repo, scaffoldSecrets())`.
  - Best-effort **por repo**: envuelto en try/catch; un repo que falla no aborta el
    resto, se acumula en `failed`.
- **Respuesta:** `{ reseeded: string[]; failed: { id: string; error: string }[] }`
  (`reseeded` = ids sembrados ok; `failed` = ids con su error).
- `gitProvider = githubProvider(githubToken())`, igual que la ruta de scaffold.

Siembra el `PUBLISH_TOKEN` **actual** del env de Backstage — por eso el runbook setea el
token nuevo en el env **antes** de llamar a este endpoint.

### 3.5 Cerrar el hueco de auth — `app/api/miniapps/[id]/publish/route.ts`

Agregar `authorizeUpload(req)` (el guard compartido de §3.2) al inicio del handler,
antes de tocar el registry. Mismo criterio que `upload`: sesión allowlisted **o**
`PUBLISH_TOKEN`. En fallo → 401 (vía `statusForError`).

## 4. Runbook de rotación (operacional)

El owner ejecuta los cambios de env; el código soporta la secuencia sin downtime.

1. **Generar** el token fuerte: `openssl rand -hex 32`.
2. **Setear env** en Backstage (Vercel): `PUBLISH_TOKEN` = `<nuevo>`,
   `PUBLISH_TOKENS_OLD` = `<viejo>` (ej. el `dev-publish-secret` actual). **Deploy.**
   → El server ahora acepta ambos tokens: nada falla.
3. **Re-sembrar:** como usuario allowlisted, `POST /api/admin/reseed-secrets`.
   → Cada repo existente recibe el token nuevo en su secret de Actions. Verificar
   `failed: []` (reintentar los que fallen).
4. **Verificar** un publish (disparar el CI de una miniapp o el botón Deploy) → 200.
5. **Quitar** `PUBLISH_TOKENS_OLD` del env. **Deploy.** → El token viejo deja de ser
   aceptado. Rotación completa.
6. **Dev:** actualizar `PUBLISH_TOKEN` en `.env.local`.

> Los valores reales (`<nuevo>`, `<viejo>`) **no se escriben** en el repo ni en la
> memoria — solo en el gestor de secrets (Vercel env / `.env.local` gitignored).

## 5. Estructura de archivos

**Crear:**
- `app/api/admin/reseed-secrets/route.ts`
- Tests: `lib/__tests__/auth.test.ts` (o el path de tests existente),
  `app/api/admin/reseed-secrets/__tests__/route.test.ts`,
  test del `/publish` guard, test de `seedRepoSecrets`.
- Runbook: `docs/rotar-publish-token.md`.

**Modificar:**
- `lib/auth.ts` — dual-token + timing-safe + `authorizeUpload` movido/exportado.
- `app/api/miniapps/[id]/upload/route.ts` — importar `authorizeUpload` de `lib/auth`.
- `lib/scaffold.ts` — extraer/exportar `seedRepoSecrets`; `scaffoldMiniapp` lo usa.
- `app/api/miniapps/[id]/publish/route.ts` — agregar `authorizeUpload(req)`.

## 6. Testing

- **`requirePublishToken`** (mock `req` + env): token nuevo aceptado; token viejo (en
  `PUBLISH_TOKENS_OLD`) aceptado; ambos configurados → ambos aceptados; token
  desconocido → `AuthError`; header ausente/mal formado → `AuthError`; sin ningún
  token en env → `AuthError("PUBLISH_TOKEN not configured")`; `PUBLISH_TOKENS_OLD` con
  espacios/comas vacías se limpia.
- **`seedRepoSecrets`** (mock provider): llama `setSecret` por cada secret; un secret
  que lanza no aborta los demás (best-effort).
- **`POST /api/admin/reseed-secrets`** (mock registry + provider + sesión): sin sesión
  allowlisted → 401/403; con sesión → itera todos los repos y devuelve
  `{reseeded, failed}`; un repo cuyo `setSecret` lanza aparece en `failed`, los otros en
  `reseeded`.
- **`/publish` guard:** sin auth → 401; con token válido o sesión → pasa.

## 7. Manejo de errores (invariantes)

- **Cero-downtime:** mientras `PUBLISH_TOKENS_OLD` contenga el token viejo, los repos
  aún no re-sembrados siguen publicando ok. El paso 5 del runbook solo se hace después
  de confirmar el reseed.
- **Reseed best-effort:** un repo que falla (borrado, sin permisos, rate-limit) no
  rompe el reseed de los demás — aparece en `failed` para reintento.
- **Sin leak de secretos:** los `console.warn` de seeding nunca logean el valor del
  token, solo el nombre del secret y el repo.
- **Timing-safe:** la validación no filtra información por tiempo ni por longitud.

## 8. Fuera de alcance (YAGNI)

- Token por-miniapp revocable (roadmap #1-futuro) — proyecto aparte.
- Rotación automática programada (cron) — el runbook manual alcanza.
- Botón de reseed en la UI (por ahora el endpoint se llama directo; la UI es otro item).
- Firma de chunks (roadmap #2) — ortogonal.
