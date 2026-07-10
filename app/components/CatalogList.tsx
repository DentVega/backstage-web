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
    return <p role="status">No hay miniapps registradas todavía.</p>;
  }
  return (
    <ul aria-label="Catálogo de miniapps">
      {entries.map((e) => (
        <li key={e.id} style={{ marginBottom: 8 }}>
          <a href={`/miniapp/${e.id}`}>
            <strong>{e.name}</strong>
          </a>{" "}
          <code>{e.id}</code>
          {" — "}
          <span>owner: {e.owner}</span>
          {" · "}
          <span>
            {e.latestVersion !== null
              ? `v${e.latestVersion} (${e.versionCount})`
              : "sin versiones"}
          </span>
          {e.createdAt ? (
            <>
              {" · "}
              <time dateTime={e.createdAt}>
                {new Date(e.createdAt).toISOString().slice(0, 10)}
              </time>
            </>
          ) : null}
          {" · "}
          <CiBadge status={statusById[e.id] ?? "unknown"} />
        </li>
      ))}
    </ul>
  );
}
