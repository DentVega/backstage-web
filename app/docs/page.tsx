import Link from "next/link";
import type { Metadata } from "next";
import { DOC_GROUPS, findDoc, type DocItem } from "@/lib/docs/nav";

export const metadata: Metadata = { title: "Docs · Backstage" };

const FEATURED = ["proceso", "arquitectura", "quickstart"]
  .map((s) => findDoc(s))
  .filter((d): d is DocItem => Boolean(d));

export default function DocsIndex() {
  return (
    <div className="docs-index">
      <div className="docs-hero">
        <p className="eyebrow">Plataforma de super-app · React Native + Module Federation</p>
        <h1 className="page-title">Documentación</h1>
        <p className="page-lede">
          Cómo funciona la plataforma y cómo construir, publicar y operar mini-apps — de
          la vista de negocio al detalle técnico, para equipos internos y externos.
        </p>
        <div className="docs-hero-cta">
          <Link className="docs-btn docs-btn-primary" href="/docs/proceso">
            Empezá por el proceso →
          </Link>
          <a
            className="docs-btn docs-btn-ghost"
            href="https://backstage-web-blond.vercel.app"
            target="_blank"
            rel="noreferrer"
          >
            Demo en vivo
          </a>
        </div>
      </div>

      {FEATURED.length > 0 && (
        <section className="docs-index-group docs-featured">
          <h2>Empezá acá</h2>
          <div className="docs-index-cards">
            {FEATURED.map((it) => (
              <Link key={it.slug} href={`/docs/${it.slug}`} className="docs-index-card">
                <span className="docs-index-card-title">{it.title}</span>
                <span className="docs-index-card-blurb">{it.blurb}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

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
