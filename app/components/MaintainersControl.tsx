"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Gestiona los maintainers (logins de GitHub) de una miniapp. Admin o el propio maintainer. */
export function MaintainersControl({ id, maintainers = [] }: { id: string; maintainers?: string[] }) {
  const router = useRouter();
  const [list, setList] = useState<string[]>(maintainers);
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  function add(): void {
    const v = input.trim();
    if (v && !list.some((m) => m.toLowerCase() === v.toLowerCase())) setList([...list, v]);
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
    try {
      const res = await fetch(`/api/miniapps/${id}/maintainers`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ maintainers: list }),
      });
      if (res.ok) {
        setSaved(true);
        router.refresh();
      }
    } finally {
      setSaving(false);
    }
  }

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
          placeholder="login de GitHub"
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
        <button type="button" className="btn btn-ghost btn-sm" onClick={add}>
          Agregar
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={save} disabled={saving}>
          {saving ? "Guardando…" : "Guardar"}
        </button>
        {saved ? <span className="storage-saved">Guardado ✓</span> : null}
      </div>
    </div>
  );
}
