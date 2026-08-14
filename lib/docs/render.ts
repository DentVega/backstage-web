import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkDirective from "remark-directive";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeStringify from "rehype-stringify";
import { registryDark, registryLight } from "./shiki-theme";
import { rehypeCallouts } from "./rehype-callouts";
import { rehypeDocLinks } from "./rehype-doc-links";
import { remarkTabs } from "./remark-tabs";

export interface TocItem {
  readonly id: string;
  readonly text: string;
  readonly level: 2 | 3;
}

/**
 * Pipeline de docs (el mismo stack que usan Nextra & co): markdown → HTML con
 * highlighting (Shiki, dual light/dark), ids + ancla en cada heading, GFM.
 * Procesador único reusado entre renders.
 */
const processor = unified()
  .use(remarkParse)
  .use(remarkGfm)
  .use(remarkDirective)
  .use(remarkTabs)
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeCallouts)
  .use(rehypeDocLinks)
  .use(rehypeSlug)
  .use(rehypeAutolinkHeadings, {
    behavior: "append",
    properties: { className: ["heading-anchor"], ariaHidden: "true", tabIndex: -1 },
    content: { type: "text", value: "#" },
  })
  .use(rehypePrettyCode, {
    theme: { light: registryLight, dark: registryDark },
    keepBackground: false,
  })
  .use(rehypeStringify);

export async function renderMarkdown(md: string): Promise<string> {
  const file = await processor.process(md);
  // Envolver las tablas en un contenedor con scroll horizontal (evita romper el
  // ancho o desbordar la página en tablas anchas).
  return String(file)
    .replace(/<table>/g, '<div class="table-wrap"><table>')
    .replace(/<\/table>/g, "</table></div>");
}

/** Decodifica las entidades HTML comunes (el heading render trae `&#x26;` etc.). */
function decodeEntities(s: string): string {
  return s
    .replace(/&(?:lt|#0*60|#x0*3c);/gi, "<")
    .replace(/&(?:gt|#0*62|#x0*3e);/gi, ">")
    .replace(/&(?:quot|#0*34|#x0*22);/gi, '"')
    .replace(/&(?:apos|#0*39|#x0*27);/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&(?:amp|#0*38|#x0*26);/gi, "&");
}

/** Extrae el TOC (h2/h3) del HTML ya renderizado, para el rail "En esta página". */
export function extractToc(html: string): TocItem[] {
  const out: TocItem[] = [];
  const re = /<h([23])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const level = Number(m[1]) as 2 | 3;
    const id = m[2]!;
    const text = decodeEntities(
      m[3]!
        .replace(/<[^>]+>/g, "")
        .replace(/#\s*$/, "")
        .trim(),
    );
    if (text) out.push({ id, text, level });
  }
  return out;
}
