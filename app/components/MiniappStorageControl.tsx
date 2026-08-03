"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const LABELS: Record<string, string> = {
  r2: "Cloudflare R2",
  blob: "Vercel Blob",
  fs: "Local (dev)",
};
const DEFAULT = "__default__";

export function MiniappStorageControl({
  id,
  available,
  override,
  defaultProvider,
  effective,
  source,
}: {
  id: string;
  available: string[];
  override: string | null;
  defaultProvider: string;
  effective: string;
  source: string;
}) {
  const router = useRouter();
  const current = override ?? DEFAULT;
  const [choice, setChoice] = useState(current);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save(): Promise<void> {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/miniapps/${id}/storage-provider`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: choice === DEFAULT ? null : choice }),
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
      <label className="storage-radio">
        <input
          type="radio"
          name={`ms-${id}`}
          value={DEFAULT}
          checked={choice === DEFAULT}
          onChange={() => {
            setChoice(DEFAULT);
            setSaved(false);
          }}
        />
        Default ({LABELS[defaultProvider] ?? defaultProvider})
      </label>
      {available.map((p) => (
        <label key={p} className="storage-radio">
          <input
            type="radio"
            name={`ms-${id}`}
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
        disabled={saving || choice === current}
      >
        {saving ? "Guardando…" : "Guardar"}
      </button>
      {saved && <span className="storage-saved">Guardado ✓</span>}
      <span className="storage-source">
        Efectivo: {LABELS[effective] ?? effective} · {source === "miniapp" ? "por miniapp" : "por default"}
      </span>
    </div>
  );
}
