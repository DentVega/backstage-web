# Rotar el PUBLISH_TOKEN (cero-downtime)

El `PUBLISH_TOKEN` es el token de servicio que cada miniapp usa para publicar sus
chunks a Backstage (`Authorization: Bearer <token>`). Backstage lo valida y el
scaffolder lo siembra en el secret de Actions de cada repo. Esta es la rotación
sin downtime, apoyada en el soporte **dual-token** del server.

## Cómo funciona el dual-token

`requirePublishToken` (en `lib/auth.ts`) acepta un **conjunto** de tokens:

- `PUBLISH_TOKEN` — el token primario (el nuevo, tras rotar).
- `PUBLISH_TOKENS_OLD` — lista CSV de tokens viejos aún aceptados durante la transición.

Mientras el viejo siga en `PUBLISH_TOKENS_OLD`, los repos no re-sembrados publican ok.
La comparación es timing-safe (no filtra el token por tiempo ni por longitud).

## Pasos

1. **Generar el token fuerte:**
   ```bash
   openssl rand -hex 32
   ```

2. **Setear el env en Vercel (prod)** y redeployar:
   - `PUBLISH_TOKEN` = `<nuevo>` (el de openssl)
   - `PUBLISH_TOKENS_OLD` = `<viejo>` (el `dev-publish-secret` actual)
   ```bash
   vercel env add PUBLISH_TOKEN production        # pegás <nuevo>
   vercel env add PUBLISH_TOKENS_OLD production    # pegás <viejo>
   vercel --prod   # o el redeploy que uses
   ```
   → El server ahora acepta **ambos**: ningún publish falla.

3. **Re-sembrar el token nuevo en todos los repos** — como usuario allowlisted
   (logueado en Backstage con un login de `SCAFFOLD_ALLOWED_LOGINS`):
   ```bash
   curl -X POST https://<tu-backstage>/api/admin/reseed-secrets \
     -H "cookie: <tu cookie de sesión de Backstage>"
   ```
   Respuesta: `{ "reseeded": ["hello_widget", ...], "failed": [] }`.
   Reintentá si algún id cae en `failed` (repo borrado, rate-limit, permisos).

4. **Verificar** que un publish real anda con el token nuevo: disparar el CI de una
   miniapp (o el botón Deploy) → debe dar 200/201.

5. **Quitar el token viejo** — solo cuando el paso 3 haya devuelto `failed: []`.
   ⚠️ Si algún repo quedó en `failed`, todavía tiene el token viejo: sacar
   `PUBLISH_TOKENS_OLD` ahora lo dejaría sin poder publicar. Resolvé esos repos
   (reintentá el reseed) antes de seguir. Con `failed` vacío:
   ```bash
   vercel env rm PUBLISH_TOKENS_OLD production
   vercel --prod
   ```
   → El token viejo deja de ser aceptado. Rotación completa.

6. **Dev local:** actualizar `PUBLISH_TOKEN` en `.env.local`.

## Notas

- **Nunca** commitees los valores de token. Viven solo en Vercel env y `.env.local`
  (gitignored).
- El endpoint `/api/admin/reseed-secrets` siembra el `PUBLISH_TOKEN` **actual** del
  env de Backstage — por eso el paso 2 (setear el nuevo) va **antes** del paso 3.
- El mismo endpoint también resiembra `BACKSTAGE_URL`, así que sirve para realinear
  cualquier repo cuyo secret haya quedado desactualizado.
- Si comprometen el token en el futuro: repetí esta rotación. El dual-token la hace
  segura y sin cortar publicaciones.
- A futuro: token por-miniapp revocable (roadmap #1-futuro) — cerraría el problema de
  raíz (revocar uno sin rotar todos).

Ver también: `docs/superpowers/specs/2026-07-23-publish-token-rotation-design.md`.
