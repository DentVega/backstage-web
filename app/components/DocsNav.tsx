"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { DOC_GROUPS } from "@/lib/docs/nav";

/** Sidebar de navegación del sitio de docs, con resaltado del link activo. */
export function DocsNav() {
  const pathname = usePathname();
  return (
    <nav className="docs-nav" aria-label="Documentación">
      <Link
        href="/docs"
        className={`docs-nav-home${pathname === "/docs" ? " is-active" : ""}`}
      >
        Inicio de docs
      </Link>
      {DOC_GROUPS.map((g) => (
        <div key={g.group} className="docs-nav-group">
          <p className="docs-nav-title">{g.group}</p>
          <ul>
            {g.items.map((it) => {
              const href = `/docs/${it.slug}`;
              const active = pathname === href;
              return (
                <li key={it.slug}>
                  <Link
                    href={href}
                    className={`docs-nav-link${active ? " is-active" : ""}`}
                    aria-current={active ? "page" : undefined}
                  >
                    {it.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
