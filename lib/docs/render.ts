import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeRaw from "rehype-raw";
import rehypeSlug from "rehype-slug";
import rehypeAutolinkHeadings from "rehype-autolink-headings";
import rehypePrettyCode from "rehype-pretty-code";
import rehypeStringify from "rehype-stringify";

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
  .use(remarkRehype, { allowDangerousHtml: true })
  .use(rehypeRaw)
  .use(rehypeSlug)
  .use(rehypeAutolinkHeadings, {
    behavior: "append",
    properties: { className: ["heading-anchor"], ariaHidden: "true", tabIndex: -1 },
    content: { type: "text", value: "#" },
  })
  .use(rehypePrettyCode, {
    theme: { light: "github-light", dark: "github-dark" },
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

/** Extrae el TOC (h2/h3) del HTML ya renderizado, para el rail "En esta página". */
export function extractToc(html: string): TocItem[] {
  const out: TocItem[] = [];
  const re = /<h([23])\s+id="([^"]+)"[^>]*>([\s\S]*?)<\/h\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const level = Number(m[1]) as 2 | 3;
    const id = m[2]!;
    const text = m[3]!
      .replace(/<[^>]+>/g, "")
      .replace(/#\s*$/, "")
      .trim();
    if (text) out.push({ id, text, level });
  }
  return out;
}
