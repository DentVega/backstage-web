/**
 * Plugin rehype: reescribe los links relativos de las docs a URLs que resuelven en
 * el sitio renderizado. Los autores escriben links naturales `./OTRA-DOC.md#anchor`
 * (relativos al `.md`), pero el sitio sirve cada doc en `/docs/<slug>` — un `.md`
 * relativo resolvería a `/docs/OTRA-DOC.md` → 404. Este plugin, en tiempo de render:
 *   - link a otro doc del sitio  → `/docs/<slug>#anchor`  (mapea por nombre de archivo)
 *   - link a un archivo del repo  → GitHub blob (backstage-web o repo hermano)
 * Anchors same-page (`#x`), absolutos (`/x`) y externos (`http`, `mailto`) quedan intactos.
 */
import { DOC_GROUPS } from "./nav";

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

const GH_OWNER = "https://github.com/DentVega";
const BRANCH = "main";
const REPO_BLOB = `${GH_OWNER}/backstage-web/blob/${BRANCH}`;

// basename del .md (lowercased) → slug del sitio. Todos los docs viven en `docs/`.
const FILE_TO_SLUG = new Map<string, string>();
for (const g of DOC_GROUPS) {
  for (const it of g.items) {
    FILE_TO_SLUG.set(it.file.split("/").pop()!.toLowerCase(), it.slug);
  }
}
// Los docs del sitio viven todos en docs/ → base uniforme para resolver relativos.
const BASE_DIR = ["docs"];

function normalize(parts: readonly string[]): string[] {
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") {
      if (out.length && out[out.length - 1] !== "..") out.pop();
      else out.push("..");
    } else out.push(p);
  }
  return out;
}

/** Devuelve el href reescrito, o null si hay que dejarlo como está. */
export function rewriteHref(href: string): string | null {
  if (!href || href.startsWith("#") || href.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(href)) {
    return null; // same-page, absoluto de sitio, o con protocolo (http/mailto/…)
  }
  const hashIdx = href.indexOf("#");
  const path = hashIdx === -1 ? href : href.slice(0, hashIdx);
  const hash = hashIdx === -1 ? "" : href.slice(hashIdx);
  if (!path) return null;

  // 1) ¿Es otro doc del sitio? (match por nombre de archivo)
  const base = path.split("/").pop()!.toLowerCase();
  const slug = FILE_TO_SLUG.get(base);
  if (slug) return `/docs/${slug}${hash}`;

  // 2) Archivo del repo → GitHub blob. Resolvemos relativo a docs/.
  const resolved = normalize([...BASE_DIR, ...path.split("/")]);
  if (resolved[0] === "..") {
    // Escapa backstage-web → repo hermano: ../<repo>/<rest...>
    const repo = resolved[1];
    if (!repo) return null;
    const rest = resolved.slice(2).join("/");
    return `${GH_OWNER}/${repo}/blob/${BRANCH}/${rest}${hash}`;
  }
  return `${REPO_BLOB}/${resolved.join("/")}${hash}`;
}

export function rehypeDocLinks() {
  return (tree: HastNode): void => {
    const walk = (node: HastNode): void => {
      if (node.type === "element" && node.tagName === "a" && node.properties) {
        const href = node.properties.href;
        if (typeof href === "string") {
          const next = rewriteHref(href);
          if (next !== null) node.properties.href = next;
        }
      }
      for (const child of node.children ?? []) walk(child);
    };
    walk(tree);
  };
}
