"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function MiniappDeleteControl({ id, hasRepo }: { id: string; hasRepo: boolean }) {
  const router = useRouter();
  const [confirmText, setConfirmText] = useState("");
  const [deleteRepo, setDeleteRepo] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function del(): Promise<void> {
    setDeleting(true);
    setError(null);
    try {
      const repo = deleteRepo && hasRepo;
      const res = await fetch(`/api/miniapps/${id}?repo=${repo}`, { method: "DELETE" });
      if (res.ok) {
        router.push("/catalog");
      } else {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `Error ${res.status}`);
      }
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="danger-zone">
      <p className="danger-hint">
        Esto es irreversible. Escribí <code>{id}</code> para confirmar.
      </p>
      <input
        className="danger-input"
        type="text"
        value={confirmText}
        onChange={(e) => setConfirmText(e.target.value)}
        placeholder={id}
        aria-label="Confirmar id de la miniapp"
      />
      {hasRepo && (
        <label className="danger-check">
          <input
            type="checkbox"
            checked={deleteRepo}
            onChange={(e) => setDeleteRepo(e.target.checked)}
          />
          También borrar el repositorio de GitHub
        </label>
      )}
      <button
        type="button"
        className="btn btn-danger"
        onClick={del}
        disabled={deleting || confirmText !== id}
      >
        {deleting ? "Eliminando…" : "Eliminar miniapp"}
      </button>
      {error && (
        <p className="danger-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
