"use client";

import { useState } from "react";

type State =
  | { status: "idle" }
  | { status: "deploying" }
  | { status: "done"; actionsUrl: string }
  | { status: "error"; message: string };

/**
 * Triggers the miniapp's CI (build + publish) with one click. Session-authorized
 * (allowlist); rendered only for those logins on the detail page.
 */
export function DeployButton({ id }: { id: string }) {
  const [state, setState] = useState<State>({ status: "idle" });

  async function onDeploy() {
    setState({ status: "deploying" });
    try {
      const res = await fetch(`/api/miniapps/${id}/deploy`, { method: "POST" });
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
        Dispara el CI del repo (build del chunk → publica una versión nueva).
      </p>
      <button type="button" onClick={onDeploy} disabled={state.status === "deploying"}>
        {state.status === "deploying" ? "Lanzando CI…" : "Deploy (build + publish)"}
      </button>
      {state.status === "done" ? (
        <p role="status" style={{ color: "var(--good, green)" }}>
          ✓ CI lanzado.{" "}
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
