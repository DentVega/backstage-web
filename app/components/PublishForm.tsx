"use client";

import { useState } from "react";

type State =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "done"; version: string; url: string }
  | { status: "error"; message: string };

/**
 * Publish a new version from the UI: uploads a build zip + version + capabilities.
 * Auth is the session cookie (no PUBLISH_TOKEN in the browser); the server builds
 * the manifest. Rendered only for allowlisted logins (see the detail page).
 */
export function PublishForm({ id }: { id: string }) {
  const [version, setVersion] = useState("");
  const [capabilities, setCapabilities] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<State>({ status: "idle" });

  const canSubmit =
    version.trim().length > 0 && file !== null && state.status !== "submitting";

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (file === null) return;
    setState({ status: "submitting" });
    const fd = new FormData();
    fd.set("file", file);
    fd.set("version", version.trim());
    if (capabilities.trim().length > 0) fd.set("capabilities", capabilities.trim());
    try {
      const res = await fetch(`/api/miniapps/${id}/upload`, { method: "POST", body: fd });
      const body = (await res.json()) as { version?: string; url?: string; error?: string };
      if (!res.ok) {
        setState({ status: "error", message: body.error ?? `HTTP ${res.status}` });
        return;
      }
      setState({ status: "done", version: body.version ?? version, url: body.url ?? "" });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "error" });
    }
  }

  return (
    <form onSubmit={onSubmit} style={{ display: "grid", gap: 14, maxWidth: 440 }}>
      <label className="field">
        versión
        <input
          aria-label="versión"
          value={version}
          onChange={(e) => setVersion(e.target.value)}
          placeholder="0.2.0"
        />
      </label>

      <label className="field">
        build (.zip)
        <input
          aria-label="build zip"
          type="file"
          accept=".zip,application/zip"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
        <span className="field-hint" style={{ color: "var(--faint)" }}>
          Zip del build del chunk (contenedor <code>{id}.container.js.bundle</code> + chunks).
        </span>
      </label>

      <label className="field">
        capabilities <span style={{ color: "var(--faint)" }}>(opcional, CSV)</span>
        <input
          aria-label="capabilities"
          value={capabilities}
          onChange={(e) => setCapabilities(e.target.value)}
          placeholder="accounts:read, session:whoami"
        />
      </label>

      <button type="submit" disabled={!canSubmit}>
        {state.status === "submitting" ? "Publicando…" : "Publicar versión"}
      </button>

      {state.status === "done" ? (
        <p role="status" style={{ color: "var(--good, green)" }}>
          ✓ Publicada v{state.version}.{" "}
          <a href={state.url} target="_blank" rel="noopener noreferrer">chunk</a>
        </p>
      ) : null}
      {state.status === "error" ? (
        <p role="alert" style={{ color: "var(--bad, crimson)" }}>
          Error: {state.message}
        </p>
      ) : null}
    </form>
  );
}
