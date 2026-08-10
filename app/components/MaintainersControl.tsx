"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

/** Gestiona los maintainers (logins de GitHub) de una miniapp. Admin o el propio maintainer. */
export function MaintainersControl({ id, maintainers = [] }: { id: string; maintainers?: string[] }) {
  const router = useRouter();
  const [list, setList] = useState<string[]>(maintainers);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // Collaborators del repo = única gente que puede ser maintainer (acceso al proyecto).
  const [collaborators, setCollaborators] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let alive = true;
    fetch(`/api/miniapps/${id}/collaborators`)
      .then((r) => (r.ok ? r.json() : { collaborators: [] }))
      .then((d: { collaborators?: unknown }) => {
        if (!alive) return;
        setCollaborators(
          Array.isArray(d.collaborators)
            ? d.collaborators.filter((x): x is string => typeof x === "string")
            : [],
        );
      })
      .catch(() => alive && setCollaborators([]));
    return () => {
      alive = false;
    };
  }, [id]);

  function add(): void {
    const v = input.trim();
    setError("");
    if (!v) return;
    if (list.some((m) => m.toLowerCase() === v.toLowerCase())) {
      setInput("");
      return;
    }
    // Solo se puede agregar a alguien con acceso al repo (validado también en el server).
    if (collaborators !== null && !collaborators.some((c) => c.toLowerCase() === v.toLowerCase())) {
      setError(`"${v}" no tiene acceso al repo; agregalo como collaborator en GitHub primero.`);
      return;
    }
    setList([...list, v]);
    setInput("");
    setSaved(false);
  }
  function remove(m: string): void {
    setList(list.filter((x) => x !== m));
    setSaved(false);
  }

  async function save(): Promise<void> {
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      const res = await fetch(`/api/miniapps/${id}/maintainers`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maintainers: list }),
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      } else {
        const d = (await res.json().catch(() => ({}))) as { error?: string };
        setError(d.error ?? "no se pudo guardar");
      }
    } finally {
      setSaving(false);
    }
  }

  // Sugerencias = collaborators que todavía no están en la lista.
  const suggestions = (collaborators ?? []).filter(
    (c) => !list.some((m) => m.toLowerCase() === c.toLowerCase()),
  );

  return (
    <div className="maint-control">
      <div className="maint-chips">
        {list.length === 0 ? (
          <span className="maint-empty">Sin maintainers (solo platform-admins gestionan).</span>
        ) : (
          list.map((m) => (
            <span key={m} className="maint-chip">
              {m}
              <button type="button" aria-label={`Quitar ${m}`} onClick={() => remove(m)}>
                ✕
              </button>
            </span>
          ))
        )}
      </div>
      <div className="maint-add">
        <input
          type="text"
          list={`collab-${id}`}
          placeholder={collaborators === null ? "cargando acceso…" : "login con acceso al repo"}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          aria-label="Agregar maintainer"
          className="maint-input"
        />
        <datalist id={`collab-${id}`}>
          {suggestions.map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button type="button" className="btn btn-ghost btn-sm" onClick={add}>
          Agregar
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={save} disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
        {saved ? <span className="storage-saved">Guardado ✓</span> : null}
      </div>
      {collaborators !== null && collaborators.length === 0 ? (
        <p className="maint-hint">Sin collaborators con acceso al repo (o el repo no es accesible).</p>
      ) : null}
      {error ? <p className="maint-error">{error}</p> : null}
    </div>
  );
}
