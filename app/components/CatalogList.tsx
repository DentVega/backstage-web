import type { CatalogEntry } from "@/lib/registry/types";
import type { CiStatus } from "@/lib/ci";
import type { DriftStatus } from "@/lib/drift";
import { CiBadge } from "./CiBadge";
import { DriftBadge } from "./DriftBadge";

export function CatalogList({
  entries,
  statusById = {},
  driftById = {},
}: {
  entries: CatalogEntry[];
  statusById?: Record<string, CiStatus>;
  driftById?: Record<string, DriftStatus>;
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
            {e.servedVersion !== null ? (
              <>
                v{e.servedVersion} <span className="count">({e.versionCount})</span>
                {e.servedVersion !== e.latestVersion ? (
                  <span className="pin-chip" title={`Fijada; última publicada v${e.latestVersion}`}>
                    🔒 última v{e.latestVersion}
                  </span>
                ) : null}
              </>
            ) : (
              "sin versiones"
            )}
          </span>
          <CiBadge status={statusById[e.id] ?? "unknown"} />
          <DriftBadge status={driftById[e.id] ?? "unknown"} />
        </li>
      ))}
    </ul>
  );
}
