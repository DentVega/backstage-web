"use client";

import { useState } from "react";

type State =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "done"; repoUrl: string }
  | { status: "error"; message: string };

export function CreateForm() {
  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [owner, setOwner] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState({ status: "submitting" });
    try {
      const res = await fetch("/api/scaffold", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, name, owner }),
      });
      const body = (await res.json()) as { repoUrl?: string; error?: string };
      if (!res.ok) {
        setState({ status: "error", message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({ status: "done", repoUrl: body.repoUrl ?? "" });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "error" });
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 8, maxWidth: 420 }}>
      <label>
        id
        <input aria-label="id" value={id} onChange={(e) => setId(e.target.value)} required />
      </label>
      <label>
        name
        <input aria-label="name" value={name} onChange={(e) => setName(e.target.value)} required />
      </label>
      <label>
        owner
        <input aria-label="owner" value={owner} onChange={(e) => setOwner(e.target.value)} required />
      </label>
      <button type="submit" disabled={state.status === "submitting"}>
        {state.status === "submitting" ? "Creando…" : "Create miniapp"}
      </button>

      {state.status === "done" ? (
        <p role="status">
          Repo creado: <a href={state.repoUrl}>{state.repoUrl}</a>
        </p>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" style={{ color: "crimson" }}>
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
