import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ALL_DOCS, findDoc, docNeighbors, docGroup } from "@/lib/docs/nav";
import { renderMarkdown, extractToc } from "@/lib/docs/render";
import { DocsToc } from "@/app/components/DocsToc";
import { DocsEnhance } from "@/app/components/DocsEnhance";

const REPO_BLOB = "https://github.com/DentVega/backstage-web/blob/main";

export function generateStaticParams() {
  return ALL_DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const doc = findDoc(slug);
  return { title: doc ? `${doc.title} · Docs` : "Docs" };
}

export default async function DocPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const doc = findDoc(slug);
  if (doc === undefined) notFound();

  const raw = await readFile(path.join(process.cwd(), doc.file), "utf8");
  const html = await renderMarkdown(raw);
  const toc = extractToc(html);
  const group = docGroup(slug);
  const { prev, next } = docNeighbors(slug);

  return (
    <div className="doc-page">
      <div className="doc-col">
        <nav className="doc-crumbs" aria-label="Ubicación">
          <Link href="/docs">Docs</Link>
          {group ? <span> / {group}</span> : null}
          <span> / {doc.title}</span>
        </nav>

        <article className="doc-body" dangerouslySetInnerHTML={{ __html: html }} />

        <div className="doc-footer">
          <a
            className="doc-edit"
            href={`${REPO_BLOB}/${doc.file}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            Editar esta página en GitHub ↗
          </a>
        </div>

        {prev || next ? (
          <nav className="doc-prevnext" aria-label="Navegación entre docs">
            {prev ? (
              <Link href={`/docs/${prev.slug}`} className="doc-pn doc-pn-prev">
                <span className="doc-pn-lab">← Anterior</span>
                <span className="doc-pn-title">{prev.title}</span>
              </Link>
            ) : (
              <span />
            )}
            {next ? (
              <Link href={`/docs/${next.slug}`} className="doc-pn doc-pn-next">
                <span className="doc-pn-lab">Siguiente →</span>
                <span className="doc-pn-title">{next.title}</span>
              </Link>
            ) : (
              <span />
            )}
          </nav>
        ) : null}
      </div>

      <aside className="doc-toc-rail">
        <DocsToc key={slug} items={toc} />
      </aside>

      <DocsEnhance key={slug} />
    </div>
  );
}
