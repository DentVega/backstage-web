"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { VersionView } from "@/lib/registry/types";

/** Presentational list of published versions (newest first). Con borrado manual (admin). */
export function VersionList({
  versions,
  servedVersion,
  miniappId,
  canDelete = false,
}: {
  versions: readonly VersionView[];
  servedVersion?: string | null;
  miniappId?: string;
  canDelete?: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);

  async function del(version: string): Promise<void> {
    if (!miniappId) return;
    if (!window.confirm(`¿Borrar la versión v${version}? Se elimina el chunk y no se puede deshacer.`)) {
      return;
    }
    setBusy(version);
    try {
      const res = await fetch(`/api/miniapps/${miniappId}/versions/${version}`, { method: "DELETE" });
      if (res.ok) router.refresh();
    } finally {
      setBusy(null);
    }
  }

  if (versions.length === 0) {
    return <p role="status" className="empty">Sin versiones publicadas.</p>;
  }
  return (
    <ul aria-label="Versiones" className="version-list">
      {versions.map((v) => {
        const served = v.version === servedVersion;
        return (
          <li key={v.version} className="version-item">
            <span className="vv">v{v.version}</span>
            {served ? <span className="served-badge">● servida</span> : null}
            <time dateTime={v.publishedAt}>
              {new Date(v.publishedAt).toISOString().slice(0, 10)}
            </time>
            <a href={v.url} rel="noopener noreferrer" target="_blank">
              chunk
            </a>
            {v.capabilities.length > 0 ? (
              <span className="caps">capabilities: {v.capabilities.join(", ")}</span>
            ) : null}
            {canDelete && !served ? (
              <button
                type="button"
                className="version-del"
                onClick={() => del(v.version)}
                disabled={busy === v.version}
                aria-label={`Borrar v${v.version}`}
                title="Borrar esta versión (chunk + registro)"
              >
                {busy === v.version ? "…" : "🗑"}
              </button>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
