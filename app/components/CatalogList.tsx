import type { CatalogEntry } from "@/lib/registry/types";
import type { CiStatus } from "@/lib/ci";
import { CiBadge } from "./CiBadge";

export function CatalogList({
  entries,
  statusById = {},
}: {
  entries: CatalogEntry[];
  statusById?: Record<string, CiStatus>;
}) {
  if (entries.length === 0) {
    return <p role="status" className="empty">No hay miniapps registradas todavía.</p>;
  }
  return (
    <ul aria-label="Catálogo de miniapps" className="catalog-list">
      {entries.map((e) => (
        <li key={e.id} className="miniapp-row">
          <div className="mrow-main">
            <a href={`/miniapp/${e.id}`} className="mrow-name">
              <strong>{e.name}</strong>
            </a>
            <div className="mrow-meta">
              <code>{e.id}</code>
              <span className="sep">·</span>
              <span>{e.owner}</span>
              {e.createdAt ? (
                <>
                  <span className="sep">·</span>
                  <time dateTime={e.createdAt}>
                    {new Date(e.createdAt).toISOString().slice(0, 10)}
                  </time>
                </>
              ) : null}
            </div>
          </div>
          <span className="mrow-ver">
            {e.latestVersion !== null ? (
              <>
                v{e.latestVersion} <span className="count">({e.versionCount})</span>
              </>
            ) : (
              "sin versiones"
            )}
          </span>
          <CiBadge status={statusById[e.id] ?? "unknown"} />
        </li>
      ))}
    </ul>
  );
}
