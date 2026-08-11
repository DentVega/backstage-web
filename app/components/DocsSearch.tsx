"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { SearchSection } from "@/lib/docs/search";

interface Hit extends SearchSection {
  score: number;
  snippet: string;
}

function makeSnippet(content: string, term: string): string {
  if (!content) return "";
  const i = term ? content.toLowerCase().indexOf(term) : -1;
  if (i < 0) return content.slice(0, 120) + (content.length > 120 ? "…" : "");
  const start = Math.max(0, i - 40);
  return (start > 0 ? "…" : "") + content.slice(start, start + 130).trim() + "…";
}

export function DocsSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState<SearchSection[] | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const fetching = useRef(false);

  // Fetch perezoso del índice (una vez).
  const loadIndex = useCallback(() => {
    if (index !== null || fetching.current) return;
    fetching.current = true;
    fetch("/api/docs/search-index")
      .then((r) => (r.ok ? r.json() : { sections: [] }))
      .then((d: { sections?: SearchSection[] }) => setIndex(d.sections ?? []))
      .catch(() => setIndex([]));
  }, [index]);

  // Ctrl/Cmd+K para abrir; Esc para cerrar.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) {
      loadIndex();
      setActive(0);
      const t = window.setTimeout(() => inputRef.current?.focus(), 20);
      return () => window.clearTimeout(t);
    }
    setQ("");
  }, [open, loadIndex]);

  const hits = useMemo<Hit[]>(() => {
    const query = q.trim().toLowerCase();
    if (!query || index === null) return [];
    const terms = query.split(/\s+/).filter(Boolean);
    const out: Hit[] = [];
    for (const s of index) {
      const heading = s.heading.toLowerCase();
      const title = s.docTitle.toLowerCase();
      const content = s.content.toLowerCase();
      let score = 0;
      let all = true;
      for (const t of terms) {
        const inH = heading.includes(t);
        const inT = title.includes(t);
        const inC = content.includes(t);
        if (!inH && !inT && !inC) {
          all = false;
          break;
        }
        score += (inH ? 6 : 0) + (inT ? 3 : 0) + (inC ? 1 : 0);
      }
      if (all) out.push({ ...s, score, snippet: makeSnippet(s.content, terms[0]!) });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 24);
  }, [q, index]);

  const go = useCallback(
    (h: Hit) => {
      setOpen(false);
      router.push(h.id ? `/docs/${h.slug}#${h.id}` : `/docs/${h.slug}`);
    },
    [router],
  );

  function onInputKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter" && hits[active]) {
      e.preventDefault();
      go(hits[active]!);
    }
  }

  return (
    <>
      <button type="button" className="docs-search-btn" onClick={() => setOpen(true)}>
        <span>Buscar…</span>
        <kbd>⌘K</kbd>
      </button>

      {open ? (
        <div className="docs-search-overlay" onClick={() => setOpen(false)}>
          <div className="docs-search-modal" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <input
              ref={inputRef}
              className="docs-search-input"
              type="text"
              placeholder="Buscar en la documentación…"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setActive(0);
              }}
              onKeyDown={onInputKey}
              aria-label="Buscar en la documentación"
            />
            <div className="docs-search-results">
              {index === null ? (
                <p className="docs-search-empty">Cargando índice…</p>
              ) : q.trim() && hits.length === 0 ? (
                <p className="docs-search-empty">Sin resultados para “{q}”.</p>
              ) : !q.trim() ? (
                <p className="docs-search-empty">Escribí para buscar en todas las docs.</p>
              ) : (
                <ul>
                  {hits.map((h, i) => (
                    <li key={`${h.slug}#${h.id}-${i}`}>
                      <button
                        type="button"
                        className={`docs-search-hit${i === active ? " is-active" : ""}`}
                        onMouseEnter={() => setActive(i)}
                        onClick={() => go(h)}
                      >
                        <span className="hit-head">{h.heading}</span>
                        <span className="hit-meta">{h.docTitle} · {h.group}</span>
                        {h.snippet ? <span className="hit-snip">{h.snippet}</span> : null}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="docs-search-foot">
              <span><kbd>↑</kbd><kbd>↓</kbd> navegar</span>
              <span><kbd>↵</kbd> ir</span>
              <span><kbd>esc</kbd> cerrar</span>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
