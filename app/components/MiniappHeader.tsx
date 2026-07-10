"use client";

import type { MiniappDetail } from "@/lib/registry/types";

/** Presentational header for the miniapp detail page. */
export function MiniappHeader({ detail }: { detail: MiniappDetail }) {
  return (
    <header>
      <h1 style={{ marginBottom: 4 }}>
        {detail.name} <code>{detail.id}</code>
      </h1>
      <dl style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 12px", margin: 0 }}>
        <dt>Owner</dt>
        <dd style={{ margin: 0 }}>{detail.owner}</dd>

        <dt>Versión actual</dt>
        <dd style={{ margin: 0 }}>
          {detail.latestVersion !== null ? `v${detail.latestVersion}` : "sin versiones"}
        </dd>

        {detail.createdAt ? (
          <>
            <dt>Creada</dt>
            <dd style={{ margin: 0 }}>
              <time dateTime={detail.createdAt}>
                {new Date(detail.createdAt).toISOString().slice(0, 10)}
              </time>
            </dd>
          </>
        ) : null}

        {detail.repoUrl ? (
          <>
            <dt>Repositorio</dt>
            <dd style={{ margin: 0 }}>
              <a href={detail.repoUrl} rel="noopener noreferrer" target="_blank">
                {detail.repoUrl}
              </a>
            </dd>
          </>
        ) : null}
      </dl>
    </header>
  );
}
