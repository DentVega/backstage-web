# Deploy de Backstage a Vercel

Backstage (Next.js) corre en Vercel con **Vercel Blob** (chunks/CDN) y **Upstash Redis / KV**
(registry). En local usa `jsonStore` + `fsStorage`; en prod, KV + Blob por env (automático).

## Pasos (manuales — requieren tu cuenta Vercel)
```bash
# 1. CLI + login
npm i -g vercel
vercel login

# 2. Enlazar el proyecto (desde backstage-web/)
vercel link

# 3. Provisionar servicios (Marketplace) — setean BLOB_/KV_ envs automáticamente
#    Vercel Dashboard → Storage → añadir:
#      - Blob            → BLOB_READ_WRITE_TOKEN
#      - Upstash Redis   → KV_REST_API_URL, KV_REST_API_TOKEN

# 4. Env/secrets restantes
vercel env add PUBLISH_TOKEN           # token de servicio (mismo secret en la CI de cada miniapp)
vercel env add GITHUB_TOKEN            # scaffolder: crear repos (scope repo)
vercel env add MINIAPP_TEMPLATE_REPO   # p.ej. tu-org/miniapp-template
vercel env add BACKSTAGE_PUBLIC_URL    # la URL del deploy (para fsStorage — no crítico en prod)

# 5. Deploy
vercel deploy --prod                   # → https://<tu-proyecto>.vercel.app

# 6. Seed del catálogo (una vez)
curl -X POST https://<tu-proyecto>.vercel.app/api/seed \
  -H "authorization: Bearer $PUBLISH_TOKEN"

# 7. Smoke
curl https://<tu-proyecto>.vercel.app/catalog
curl "https://<tu-proyecto>.vercel.app/api/resolve?id=account_dashboard"
curl -X POST https://<tu-proyecto>.vercel.app/api/miniapps/x/upload   # → 401 (sin token)
```

## Conectar la CI de las miniapps
En cada repo de miniapp (secrets):
- `BACKSTAGE_URL` = la URL del deploy.
- `PUBLISH_TOKEN` = el mismo token de servicio.

## Conectar el host (app móvil)
Buildear el host con la URL de prod:
```bash
BACKSTAGE_URL=https://<tu-proyecto>.vercel.app pnpm --filter @app/host bundle:android
```
El `DefinePlugin` inyecta `__BACKSTAGE_URL__`; en dev cae a `http://localhost:3999`.

## Selección de storage/store (automática por env)
- `getStore()`: KV si hay `KV_REST_API_URL`+`KV_REST_API_TOKEN`; si no, `jsonStore` (dev).
- `getStorage()`: Blob si hay `BLOB_READ_WRITE_TOKEN`; si no, `fsStorage` (dev, `public/chunks/`).
