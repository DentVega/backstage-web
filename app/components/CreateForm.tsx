"use client";

import { useState } from "react";
import { parseMiniappId } from "@org/miniapp-contract";

type State =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "done"; repoUrl: string; id: string }
  | { status: "error"; message: string };

export function CreateForm() {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });

  // Same rule the server enforces — validate before hitting the API.
  const idInvalid = id.length > 0 && parseMiniappId(id) === null;
  const canSubmit =
    id.length > 0 && !idInvalid && name.length > 0 && owner.length > 0 && state.status !== "submitting";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    const createdId = id;
    setState({ status: "submitting" });
    try {
      const res = await fetch("/api/scaffold", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: createdId, name, owner }),
      });
      const body = (await res.json()) as { repoUrl?: string; error?: string };
      if (!res.ok) {
        setState({ status: "error", message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({ status: "done", repoUrl: body.repoUrl ?? "", id: createdId });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "error" });
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 16, maxWidth: 440 }}>
      <label className="field">
        id
        <input
          className="input"
          aria-label="id"
          aria-invalid={idInvalid}
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="account_dashboard"
          required
        />
        <span className="field-hint" style={{ color: idInvalid ? "var(--bad)" : "var(--faint)" }}>
          {idInvalid
            ? "minúsculas, dígitos y - _ (p.ej. account_dashboard)"
            : "minúsculas, dígitos, separadores - _"}
        </span>
      </label>
      <label className="field">
        name
        <input className="input" aria-label="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label className="field">
        owner
        <input className="input" aria-label="owner" value={owner} onChange={(e) => setOwner(e.target.value)} required />
      </label>
      <button
        type="submit"
        className="btn btn-primary"
        disabled={!canSubmit}
        style={{ justifySelf: "start" }}
      >
        {state.status === "submitting" ? "Creando…" : "Crear miniapp"}
      </button>

      {state.status === "done" ? (
        <p role="status" className="status-line">
          Repo creado:{" "}
          <a href={state.repoUrl} target="_blank" rel="noopener noreferrer" style={{ color: "var(--wire)" }}>
            {state.repoUrl}
          </a>
          {" · "}
          <a href={`/miniapp/${state.id}`} style={{ color: "var(--accent)" }}>
            ver en el catálogo →
          </a>
        </p>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" className="error-line">
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
