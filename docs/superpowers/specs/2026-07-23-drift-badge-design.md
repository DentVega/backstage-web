# Badge de drift disponible en Backstage

**Fecha:** 2026-07-23
**Estado:** Diseño aprobado — listo para plan de implementación
**Owner:** DentVega

## 1. Contexto y objetivo

Cierra visualmente el loop de la **Capa 2** (template-sync): hoy un dev se entera
de que su miniapp quedó atrás respecto al template solo porque plataforma le avisa.
El badge muestra, por miniapp, si está **al día** con el template o si tiene una
**actualización disponible** (drift) — directo en Backstage.

**Mecanismo:** comparar el `baseSha` del marcador `.template-sync` de cada miniapp
(el commit del template al que está sincronizada) contra el **HEAD actual** del
template (`DentVega/miniapp-template` main). Igual → al día; distinto → drift.

**Decisión tomada:** el cálculo usa el **`githubToken()` del scaffolder**
(server-side, siempre disponible) — es un chequeo de plataforma, no depende de la
sesión del usuario. El badge se muestra siempre.

## 2. Patrón: espeja `lib/ci/`

Ya existe `lib/ci/` (un módulo limpio: `types.ts`, `github.ts`, `mock.ts`,
`cache.ts`, `index.ts`, `resolve.ts`) que hace exactamente esto para el estado de
CI: estado por-miniapp desde GitHub, cacheado ~60s, fail-soft, con
`resolveCiStatuses(items, token)` consumido por `app/catalog/page.tsx` y un
`CiBadge` presentacional. **`lib/drift/` es un espejo 1:1 de ese patrón.**

Diferencia clave: el CI resolver recibe el token de sesión; el drift resolver **no
recibe token** — usa `githubToken()` internamente (siempre disponible).

## 3. Módulo `lib/drift/`

### 3.1 `types.ts`
```ts
export type DriftStatus = "up_to_date" | "drift" | "untracked" | "unknown";

export interface DriftProvider {
  /** SHA del HEAD actual del template (fetch 1 vez, compartido entre miniapps). */
  getTemplateHead(): Promise<string>;
  /** baseSha del .template-sync del repo, o null si no existe (no enrolada). */
  getBaseSha(repoFullName: string): Promise<string | null>;
}
```
(Reusa `repoFullNameFor` de `lib/ci/types` — misma forma `{id, owner, repoUrl}`.)

### 3.2 `github.ts` (provider real)
- `getTemplateHead()`: `GET https://api.github.com/repos/DentVega/miniapp-template/commits/main` (Bearer `githubToken()`) → `.sha`. El repo del template sale de `MINIAPP_TEMPLATE_REPO` (config) — no hardcodear `DentVega/miniapp-template`.
- `getBaseSha(repoFullName)`: `GET /repos/{repoFullName}/contents/.template-sync` → si 404 → `null` (untracked); si 200 → base64-decode `content` → `JSON.parse(...).baseSha`.
- Ambos con los headers estándar (`Accept: application/vnd.github+json`, `X-GitHub-Api-Version`).

### 3.3 `mock.ts`
Provider inyectable para tests (`getTemplateHead`/`getBaseSha` configurables).

### 3.4 `cache.ts` + `index.ts`
- Reusar `withCache` de `lib/ci/cache.ts` **si es genérico** (memo con TTL ~60s); si está acoplado a CI, crear un `withCache` propio en `lib/drift/cache.ts` con la misma forma.
- `getDriftProvider()`: env-selected (real vs mock), envuelto en el cache (`getTemplateHead` + `getBaseSha` cacheados por key). Singleton como `getCiProvider()`.

### 3.5 `resolve.ts`
```ts
export async function resolveDriftStatuses(
  items: readonly { id: string; owner: string; repoUrl?: string }[],
): Promise<Record<string, DriftStatus>> {
  // provider = getDriftProvider()
  // head = await provider.getTemplateHead()   // 1 vez
  // por item: base = await provider.getBaseSha(repoFullNameFor(item))
  //   base === null → "untracked"
  //   base === head → "up_to_date"
  //   else          → "drift"
  //   throw/err     → "unknown"   (fail-soft, por item; nunca rompe el render)
}
```
Si `getTemplateHead()` falla globalmente → todos `unknown` (fail-soft, sin lanzar).

## 4. UI

### 4.1 `app/components/DriftBadge.tsx` (presentacional, espeja `CiBadge`)
```tsx
const LABELS: Record<DriftStatus, string> = {
  up_to_date: "Al día",
  drift: "Actualización disponible",
  untracked: "Sin sync",
  unknown: "Desconocido",
};
export function DriftBadge({ status }: { status: DriftStatus }) { /* span estilado */ }
```
- `role="status"`, `aria-label`, clases `drift-badge is-<status>`. Sin red (recibe el status por prop).
- CSS `.drift-badge` en el stylesheet global (colores: al-día=verde, drift=ámbar, sin-sync=gris, desconocido=gris tenue).

### 4.2 Catálogo (`app/catalog/page.tsx`)
- `const driftById = await resolveDriftStatuses(entries);` junto al `resolveCiStatuses` existente.
- `<CatalogList entries={entries} statusById={statusById} driftById={driftById} />`.
- `CatalogList` renderiza `<DriftBadge status={driftById[id]} />` por card (junto al `CiBadge`).

### 4.3 Detalle (`app/miniapp/[id]/page.tsx`)
- Calcular el drift del miniapp (`resolveDriftStatuses([entry])[id]`) y mostrar el `DriftBadge` en `MiniappHeader` (junto al `CiBadge`).
- Cuando `status === "drift"`, el CTA es el botón **"Actualizar desde template"** que YA existe (gated por `canScaffold`). El badge es informativo; opcionalmente un texto "hay una actualización — usá el botón de abajo".

## 5. Estructura de archivos

**Crear:**
- `lib/drift/types.ts`, `lib/drift/github.ts`, `lib/drift/mock.ts`, `lib/drift/index.ts`, `lib/drift/resolve.ts`
- `lib/drift/cache.ts` (solo si `withCache` de ci no es reutilizable)
- `app/components/DriftBadge.tsx`
- Tests: `lib/drift/__tests__/resolve.test.ts`, `app/components/__tests__/DriftBadge.test.tsx`

**Modificar:**
- `app/catalog/page.tsx` (computar + pasar `driftById`)
- `app/components/CatalogList.tsx` (prop `driftById` + render `DriftBadge`)
- `app/miniapp/[id]/page.tsx` + `app/components/MiniappHeader.tsx` (badge en detalle)
- El stylesheet global (clases `.drift-badge`)
- `lib/config.ts` — helper para el template repo si no existe (`MINIAPP_TEMPLATE_REPO` ya está)

## 6. Testing

- **`resolveDriftStatuses`** (mock provider): `base===head` → `up_to_date`; `base!==head` → `drift`; `base===null` → `untracked`; provider lanza en `getBaseSha` → `unknown` para ese item; `getTemplateHead` lanza → todos `unknown`.
- **`DriftBadge`**: renderiza el label correcto por cada status (espeja `CiBadge.test`).
- **`github` provider** (opcional, si el patrón de ci lo testea): parse del `.template-sync` (base64→JSON→baseSha) + 404 → null.

## 7. Manejo de errores (invariante)

- El drift **nunca rompe** el render del catálogo/detalle: cualquier fallo de red/API → `unknown` para ese item (o global). El catálogo se ve igual, con badges "Desconocido".
- Rate limits mitigados por el cache ~60s + el HEAD del template fetcheado 1 vez por render.

## 8. Fuera de alcance (YAGNI)

- Badge accionable/clickable (el botón "Actualizar desde template" ya es la acción; el badge es informativo).
- Mostrar *cuántos* commits atrás está (solo al-día/drift, no un diff-count).
- Fan-out de sync desde el catálogo (es otro item del roadmap, #16).
- Refetch en tiempo real / websockets (el cache + un refresh de página alcanzan).
