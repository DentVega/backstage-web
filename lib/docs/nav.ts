/** Config del sitio de docs (/docs): grupos → items → { slug, título, archivo .md }. */

export interface DocItem {
  readonly slug: string;
  readonly title: string;
  /** Path del .md relativo a la raíz del repo (process.cwd()). */
  readonly file: string;
  readonly blurb: string;
}

export interface DocGroup {
  readonly group: string;
  readonly items: readonly DocItem[];
}

export const DOC_GROUPS: readonly DocGroup[] = [
  {
    group: "Empezar",
    items: [
      {
        slug: "quickstart",
        title: "Quickstart",
        file: "docs/QUICKSTART.md",
        blurb: "De cero a tu primera miniapp corriendo en la app, en ~10 minutos.",
      },
      {
        slug: "platform-overview",
        title: "Platform Overview",
        file: "docs/PLATFORM-OVERVIEW.md",
        blurb: "El mental model completo de la plataforma: arquitectura, conceptos y ciclo de vida.",
      },
    ],
  },
  {
    group: "Integrar una miniapp",
    items: [
      {
        slug: "integration-guide",
        title: "Integration Guide",
        file: "docs/INTEGRATION-GUIDE.md",
        blurb: "De cero a tu primera miniapp publicada, con el contrato que debés cumplir.",
      },
      {
        slug: "miniapps-guide",
        title: "Guía de miniapps",
        file: "docs/miniapps-guide.md",
        blurb: "El ciclo de vida completo: crear → publicar → usar.",
      },
      {
        slug: "local-dev",
        title: "Desarrollo local",
        file: "docs/LOCAL-DEV.md",
        blurb: "El inner loop en tu máquina y el dev-loop de miniapps (Modo 1 y 2).",
      },
    ],
  },
  {
    group: "Operar la plataforma",
    items: [
      {
        slug: "setup",
        title: "Setup",
        file: "docs/SETUP.md",
        blurb: "Levantar toda la plataforma desde cero.",
      },
      {
        slug: "compat-gates",
        title: "Compat gates",
        file: "docs/activar-compat-gates.md",
        blurb: "Encender los gates de compatibilidad (WARN vs ENFORCE).",
      },
      {
        slug: "actualizar-miniapp",
        title: "Actualizar desde template",
        file: "docs/actualizar-miniapp.md",
        blurb: "Propagar mejoras del template a la flota (Capa 2).",
      },
      {
        slug: "rotar-publish-token",
        title: "Rotar PUBLISH_TOKEN",
        file: "docs/rotar-publish-token.md",
        blurb: "Rotación del token de publish sin ventana de riesgo.",
      },
    ],
  },
  {
    group: "Referencia",
    items: [
      {
        slug: "api-reference",
        title: "API & Schemas",
        file: "docs/API-REFERENCE.md",
        blurb: "Endpoints, request/response y schemas (manifest, Host Contract, códigos de error).",
      },
    ],
  },
];

export const ALL_DOCS: readonly DocItem[] = DOC_GROUPS.flatMap((g) => g.items);

export function findDoc(slug: string): DocItem | undefined {
  return ALL_DOCS.find((d) => d.slug === slug);
}

/** Doc anterior/siguiente en el orden plano (para el nav prev/next del pie). */
export function docNeighbors(slug: string): { prev?: DocItem; next?: DocItem } {
  const i = ALL_DOCS.findIndex((d) => d.slug === slug);
  if (i === -1) return {};
  return {
    prev: i > 0 ? ALL_DOCS[i - 1] : undefined,
    next: i < ALL_DOCS.length - 1 ? ALL_DOCS[i + 1] : undefined,
  };
}

/** Grupo al que pertenece un doc (para el breadcrumb). */
export function docGroup(slug: string): string | undefined {
  return DOC_GROUPS.find((g) => g.items.some((it) => it.slug === slug))?.group;
}
