import { readFileSync } from "node:fs";
import path from "node:path";
import GithubSlugger from "github-slugger";
import { ALL_DOCS, docGroup } from "./nav";

/** Una sección indexable = un heading (h2/h3) + su texto, para el buscador. */
export interface SearchSection {
  readonly slug: string; // slug del doc
  readonly docTitle: string;
  readonly group: string;
  readonly id: string; // id del heading (mismo que rehype-slug); "" = intro del doc
  readonly heading: string;
  readonly content: string; // texto plano de la sección
}

/** Limpia marcas inline de un heading (para el id y el label), como hace rehype-slug. */
function headingText(raw: string): string {
  return raw
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*?([^*]+)\*\*?/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .trim();
}

/** Aplana markdown a texto plano para matchear/mostrar snippet. */
function stripMd(s: string): string {
  return s
    .replace(/`{1,3}[^`]*`{1,3}/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#>*_~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Construye el índice de búsqueda leyendo los .md (server-side). */
export function buildSearchIndex(): SearchSection[] {
  const out: SearchSection[] = [];
  for (const doc of ALL_DOCS) {
    if (doc.protected) continue; // los runbooks internos no van al índice público
    let md: string;
    try {
      md = readFileSync(path.join(process.cwd(), doc.file), "utf8");
    } catch {
      continue;
    }
    const group = docGroup(doc.slug) ?? "";
    const slugger = new GithubSlugger();
    let id = "";
    let heading = doc.title;
    let buf = "";
    let inCode = false;

    const flush = () => {
      const content = stripMd(buf);
      if (content.length > 0 || id === "") {
        out.push({ slug: doc.slug, docTitle: doc.title, group, id, heading, content });
      }
      buf = "";
    };

    for (const line of md.split("\n")) {
      if (/^```/.test(line)) {
        inCode = !inCode;
        buf += " ";
        continue;
      }
      if (inCode) {
        buf += ` ${line}`;
        continue;
      }
      const h = line.match(/^(#{1,3})\s+(.+?)\s*#*\s*$/);
      if (h) {
        const level = h[1]!.length;
        const text = headingText(h[2]!);
        if (level === 1) {
          heading = text || doc.title; // el h1 es el título del doc (sección intro)
          continue;
        }
        flush();
        id = slugger.slug(text);
        heading = text;
        continue;
      }
      buf += ` ${line}`;
    }
    flush();
  }
  return out;
}
