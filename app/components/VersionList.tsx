"use client";

import type { VersionView } from "@/lib/registry/types";

/** Presentational list of published versions (newest first). */
export function VersionList({ versions }: { versions: readonly VersionView[] }) {
  if (versions.length === 0) {
    return <p role="status">Sin versiones publicadas.</p>;
  }
  return (
    <ul aria-label="Versiones">
      {versions.map((v) => (
        <li key={v.version}>
          <strong>v{v.version}</strong>{" · "}
          <time dateTime={v.publishedAt}>
            {new Date(v.publishedAt).toISOString().slice(0, 10)}
          </time>
          {" · "}
          <a href={v.url} rel="noopener noreferrer" target="_blank">
            chunk
          </a>
          {v.capabilities.length > 0 ? (
            <>
              {" · "}
              <span>capabilities: {v.capabilities.join(", ")}</span>
            </>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
