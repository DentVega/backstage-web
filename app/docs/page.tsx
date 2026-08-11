import Link from "next/link";
import type { Metadata } from "next";
import { DOC_GROUPS } from "@/lib/docs/nav";

export const metadata: Metadata = { title: "Docs · Backstage" };

export default function DocsIndex() {
  return (
    <div className="docs-index">
      <p className="eyebrow">Documentación</p>
      <h1 className="page-title">Docs de Backstage</h1>
      <p className="page-lede">
        Cómo funciona la plataforma y cómo construir, publicar y operar miniapps —
        para equipos internos y externos.
      </p>

      {DOC_GROUPS.map((g) => (
        <section key={g.group} className="docs-index-group">
          <h2>{g.group}</h2>
          <div className="docs-index-cards">
            {g.items.map((it) => (
              <Link key={it.slug} href={`/docs/${it.slug}`} className="docs-index-card">
                <span className="docs-index-card-title">{it.title}</span>
                <span className="docs-index-card-blurb">{it.blurb}</span>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
