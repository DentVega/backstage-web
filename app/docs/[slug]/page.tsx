import { readFile } from "node:fs/promises";
import path from "node:path";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { marked } from "marked";
import { ALL_DOCS, findDoc } from "@/lib/docs/nav";

/** Pre-genera una ruta por doc (útil si el segmento se renderiza estático). */
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
  // Contenido propio del repo (no input de usuario) → render directo, GFM por default.
  const html = await marked.parse(raw, { gfm: true });

  return <article className="doc-body" dangerouslySetInnerHTML={{ __html: html }} />;
}
