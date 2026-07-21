"use client";

import { useState } from "react";

type State =
  | { status: "idle" }
  | { status: "syncing" }
  | { status: "done"; actionsUrl: string }
  | { status: "error"; message: string };

/**
 * Dispatches the miniapp's template-sync.yml — a 3-way merge of the current
 * template that opens a PR. Session-authorized (allowlist); rendered only for
 * those logins on the detail page.
 */
export function SyncTemplateButton({ id }: { id: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function onSync() {
    setState({ status: "syncing" });
    try {
      const res = await fetch(`/api/miniapps/${id}/sync-template`, { method: "POST" });
      const body = (await res.json()) as { actionsUrl?: string; error?: string };
      if (!res.ok) {
        setState({ status: "error", message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({ status: "done", actionsUrl: body.actionsUrl ?? "" });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "error" });
    }
  }

  return (
    <div style={{ display: "grid", gap: 10, maxWidth: 440 }}>
      <p className="field-hint" style={{ color: "var(--faint)", margin: 0 }}>
        Hace un merge 3-way del template actual y abre un PR (no toca tu código).
      </p>
      <button type="button" onClick={onSync} disabled={state.status === "syncing"}>
        {state.status === "syncing" ? "Disparando sync…" : "Actualizar desde template"}
      </button>
      {state.status === "done" ? (
        <p role="status" style={{ color: "var(--good, green)" }}>
          ✓ Sync lanzado — revisa el PR.{" "}
          {state.actionsUrl ? (
            <a href={state.actionsUrl} target="_blank" rel="noopener noreferrer">
              Ver en GitHub Actions
            </a>
          ) : null}
        </p>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" style={{ color: "var(--bad, crimson)" }}>
          Error: {state.message}
        </p>
      ) : null}
    </div>
  );
}
