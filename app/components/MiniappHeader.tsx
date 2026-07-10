"use client";

import type { MiniappDetail } from "@/lib/registry/types";

/** Presentational header for the miniapp detail page. */
export function MiniappHeader({ detail }: { detail: MiniappDetail }) {
  return (
    <header className="detail-header">
      <h1>
        {detail.name} <code>{detail.id}</code>
      </h1>
      <dl className="detail-dl">
        <dt>Owner</dt>
        <dd>{detail.owner}</dd>

        <dt>Versión</dt>
        <dd>{detail.latestVersion !== null ? `v${detail.latestVersion}` : "sin versiones"}</dd>

        {detail.createdAt ? (
          <>
            <dt>Creada</dt>
            <dd>
              <time dateTime={detail.createdAt}>
                {new Date(detail.createdAt).toISOString().slice(0, 10)}
              </time>
            </dd>
          </>
        ) : null}

        {detail.repoUrl ? (
          <>
            <dt>Repo</dt>
            <dd>
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
