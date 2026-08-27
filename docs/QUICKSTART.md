# Quickstart — tu primera miniapp en ~10 minutos

De cero a un feature tuyo **corriendo dentro de la app**, sin recompilar el host ni
pasar por las tiendas. Esta es la versión rápida; el detalle del contrato y cada paso
está en la [Integration Guide](/docs/integration-guide).

> [!NOTE]
> Una **miniapp** es un módulo (un *remote* de Module Federation) que expone `./Entry`
> y que el host móvil **descarga y monta en runtime**. Vos la desarrollás y publicás en
> **tu propio repo**; Backstage la cataloga, versiona y valida la compatibilidad.

---

## 1. Crear tu miniapp

Desde Backstage, andá a **`/create`**, poné un `id` (ej. `cards_wallet`) y un nombre. El
campo **owner** ya viene con tu usuario de GitHub. Apretá **Crear**.

Eso genera **tu repo** desde el template, con el **CI ya cableado** y los secrets
(`BACKSTAGE_URL`, `PUBLISH_TOKEN`) sembrados. Tu miniapp aparece en el catálogo (todavía
sin versión publicada).

> [!IMPORTANT]
> Crear miniapps requiere permiso de plataforma (`SCAFFOLD_ALLOWED_LOGINS`). Si no lo
> tenés, pedile a un platform-admin que la scaffoldee y te agregue como **maintainer**
> (solo se puede agregar de maintainer a un collaborator del repo).

---

## 2. Clonar y mirar qué te toca

```bash
git clone git@github.com:<owner>/miniapp-<id>.git
cd miniapp-<id>
pnpm install
```

Los dos archivos que vas a tocar:

| Archivo | Qué es |
|---|---|
| `src/Screen.tsx` | **Tu UI** — acá construís tu feature. |
| `src/Entry.tsx` | El punto de entrada federado (`./Entry`) que el host monta. Chequea tus capabilities. |

El resto (`manifest.json`, `rspack.config.mjs`, `scripts/`, `.github/workflows/`) ya viene
listo y **se mantiene solo** vía template-sync.

---

## 3. Escribir tu feature

Editá `src/Screen.tsx` — es React Native normal. Usá las librerías que el host **ya
provee** (no las bundlees vos):

> [!WARNING]
> Usá los **singletons compartidos** del host (`react`, `react-native`,
> `@react-navigation/*`, `@tanstack/react-query`, `zustand`, `@shopify/flash-list`,
> `@dentvega/ui-kit`) y **no agregues módulos nativos** que el host no tenga compilados.
> Si te salís del contrato, el **compat gate frena el publish**. El detalle está en la
> [Integration Guide §2](/docs/integration-guide).

---

## 4. Probarla local (opcional pero recomendado)

Montá tu miniapp contra el host antes de publicar con **dev-mount** (Fast Refresh).

**Recomendado — un comando:** agregá tu miniapp al `apps/host/dev-miniapps.config.mjs`
con `mode: 'mount'` y corré **`pnpm dev`** (levanta el host, la monta y arranca todo).
Detalle en [Desarrollo local](/docs/local-dev#un-comando-pnpm-dev-recomendado).

**A mano** (sin el orquestador): en una terminal, el dev server del host montando tu
miniapp local:

```bash
DEV_MINIAPP_PATH=/ruta/a/tu/miniapp-<id> pnpm --filter @app/host start
```

Y en otra terminal, buildeás e instalás en el device:

::::tabs

:::tab{label="Android"}
```bash
pnpm --filter @app/host android
```
:::

:::tab{label="iOS"}
```bash
pnpm --filter @app/host ios
```
:::

::::

> [!TIP]
> Para probar el camino **federado real** (como en prod) o **varias miniapps juntas**,
> usá el Modo 2 (`DEV_REMOTES`). Todo el dev-loop está en
> [Desarrollo local](/docs/local-dev) y en el `RUN.md` del host.

---

## 5. Publicar

```bash
git add -A && git commit -m "mi feature" && git push origin main
```

Un push a `main` dispara el CI, que **buildea android + iOS**, valida el compat gate, y
**publica ambos chunks a la misma versión** (auto-bump; el registro es inmutable). Sin
escribir nada de pipeline.

> [!NOTE]
> El publish sube a storage con integridad **sha256** (y, si está configurada, la **firma**
> del chunk — ver [API Reference](/docs/api-reference) §5.7). Verificá que quedó:
> ```bash
> curl "https://<tu-proyecto>.vercel.app/api/resolve?id=<id>"
> curl "https://<tu-proyecto>.vercel.app/api/resolve?id=<id>&platform=ios"
> ```

---

## 6. Verla en la app

Abrí el host (iOS o Android), entrá a tu miniapp desde el catálogo → el host la
**resuelve, verifica y monta**. Es la última versión publicada. Nadie actualizó la app.

---

## 7. Si algo sale mal — rollback instantáneo

Desde el detalle de tu miniapp en Backstage, **fijá** (pin) una versión anterior. El
rollback es **inmediato**, sin re-deployar el host: la próxima vez que alguien abre la
miniapp, ya está en la versión fijada.

> [!CAUTION]
> Las versiones son **inmutables**: no se re-publica la misma versión (da `409`). Para
> corregir, publicás una versión nueva o fijás una anterior — nunca pisás una existente.

---

## Y ahora qué

- **[Tutorial](/docs/tutorial)** — un ejemplo de punta a punta con código real, para
  afianzar lo que acabás de hacer con las manos en el teclado (próximamente).
- **[Integration Guide](/docs/integration-guide)** — el contrato completo, el compat gate y cómo pasarlo.
- **[Platform Overview](/docs/platform-overview)** — cómo funciona toda la plataforma.
- **[Desarrollo local](/docs/local-dev)** — el inner loop en detalle.
