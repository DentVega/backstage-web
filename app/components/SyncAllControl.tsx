"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type SyncResult = { dispatched: string[]; failed: { id: string; error: string }[] };

/** Botón admin: dispara el template-sync a TODA la flota (fan-out de Capa 2). */
export function SyncAllControl() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);

  async function run(): Promise<void> {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/admin/sync-all", { method: "POST" });
      if (res.ok) {
        setResult((await res.json()) as SyncResult);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="storage-control">
      <button type="button" className="btn btn-ghost btn-sm" onClick={run} disabled={busy}>
        {busy ? "Disparando…" : "↻ Actualizar toda la flota"}
      </button>
      {result !== null ? (
        <span className="storage-source">
          {result.dispatched.length} disparada{result.dispatched.length === 1 ? "" : "s"}
          {result.failed.length > 0
            ? ` · ${result.failed.length} fallaron: ${result.failed.map((f) => f.id).join(", ")}`
            : ""}
        </span>
      ) : null}
    </div>
  );
}
