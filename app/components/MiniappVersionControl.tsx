"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VersionView } from "@/lib/registry/types";

const AUTO = "__auto__";

/**
 * Control admin de la versión SERVIDA (pin/rollback). Elegir una versión anterior
 * = rollback; "Automática" = despin (vuelve a la última). Freeze: publicar no despina.
 */
export function MiniappVersionControl({
  id,
  versions,
  pinnedVersion,
  servedVersion,
  latestVersion,
}: {
  id: string;
  versions: readonly VersionView[];
  pinnedVersion?: string;
  servedVersion: string | null;
  latestVersion: string | null;
}) {
  const router = useRouter();
  const current = pinnedVersion ?? AUTO;
  const [choice, setChoice] = useState(current);
  const [saving, setSaving] = useState(false);
  const stale = servedVersion !== null && servedVersion !== latestVersion;

  async function save(): Promise<void> {
    setSaving(true);
    try {
      const res = await fetch(`/api/miniapps/${id}/pin`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ version: choice === AUTO ? null : choice }),
      });
      if (res.ok) router.refresh();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="pin-control">
      <label className="pin-label" htmlFor={`pin-${id}`}>
        Versión servida
      </label>
      <select
        id={`pin-${id}`}
        className="pin-select"
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
      >
        <option value={AUTO}>
          Automática (última{latestVersion ? `: v${latestVersion}` : ""})
        </option>
        {versions.map((v) => (
          <option key={v.version} value={v.version}>
            v{v.version}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        onClick={save}
        disabled={saving || choice === current}
      >
        {saving ? "Aplicando…" : "Aplicar"}
      </button>
      <span className="pin-served">
        Sirviendo: {servedVersion ? `v${servedVersion}` : "—"} {pinnedVersion ? "(fijada)" : "(auto)"}
      </span>
      {stale ? (
        <span className="pin-warn" role="status">
          ⚠️ Servís una versión anterior a la última (v{latestVersion}).
        </span>
      ) : null}
    </div>
  );
}
