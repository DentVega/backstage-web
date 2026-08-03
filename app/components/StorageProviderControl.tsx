"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const LABELS: Record<string, string> = {
  r2: "Cloudflare R2",
  blob: "Vercel Blob",
  fs: "Local (dev)",
};

export function StorageProviderControl({
  available,
  active,
  source,
}: {
  available: string[];
  active: string;
  source: string;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState(active);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(): Promise<void> {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/storage-provider", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: choice }),
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
    <div className="storage-control">
      <span className="storage-control-label">Storage:</span>
      {available.map((p) => (
        <label key={p} className="storage-radio">
          <input
            type="radio"
            name="storage-provider"
            value={p}
            checked={choice === p}
            onChange={() => {
              setChoice(p);
              setSaved(false);
            }}
          />
          {LABELS[p] ?? p}
        </label>
      ))}
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={save}
        disabled={saving || choice === active}
      >
        {saving ? "Guardando…" : "Guardar"}
      </button>
      {saved && <span className="storage-saved">Guardado ✓</span>}
      <span className="storage-source">{source === "preference" ? "(override)" : "(por env)"}</span>
    </div>
  );
}
