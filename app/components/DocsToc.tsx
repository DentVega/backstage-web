"use client";

import { useEffect, useState } from "react";
import type { TocItem } from "@/lib/docs/render";

/** Rail "En esta página" con scroll-spy (resalta la sección visible). */
export function DocsToc({ items }: { items: TocItem[] }) {
  const [active, setActive] = useState<string>("");

  useEffect(() => {
    const headings = items
      .map((i) => document.getElementById(i.id))
      .filter((el): el is HTMLElement => el !== null);
    if (headings.length === 0) return;

    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -66% 0px", threshold: 0 },
    );
    headings.forEach((h) => obs.observe(h));
    return () => obs.disconnect();
  }, [items]);

  if (items.length === 0) return null;

  return (
    <nav className="doc-toc" aria-label="En esta página">
      <p className="doc-toc-title">En esta página</p>
      <ul>
        {items.map((i) => (
          <li
            key={i.id}
            className={`doc-toc-l${i.level}${active === i.id ? " is-active" : ""}`}
          >
            <a href={`#${i.id}`}>{i.text}</a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
