"use client";
import { useMemo, useState } from "react";
import type { AuditEvent } from "@/lib/audit/types";

export function AuditTable({ events }: { events: AuditEvent[] }) {
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const actions = useMemo(() => [...new Set(events.map((e) => e.action))].sort(), [events]);
  const filtered = events.filter(
    (e) => (!action || e.action === action) && (!actor || e.actor.login.includes(actor)),
  );

  return (
    <section className="audit-section">
      <div className="audit-filters">
        <label>
          Acción{" "}
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">todas</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label>
          Actor{" "}
          <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="login" />
        </label>
        <span className="audit-count">{filtered.length} eventos</span>
      </div>

      {filtered.length === 0 ? (
        <p role="status" className="empty">
          Sin eventos.
        </p>
      ) : (
        <table className="audit-log">
          <thead>
            <tr>
              <th>Cuándo</th>
              <th>Actor</th>
              <th>Acción</th>
              <th>Miniapp</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={`${e.chain}:${e.seq}`}>
                <td>{new Date(e.ts).toISOString().replace("T", " ").slice(0, 19)}</td>
                <td>
                  <code>{e.actor.login}</code>
                  <span className={`actor-badge ${e.actor.type}`}>{e.actor.type}</span>
                </td>
                <td>
                  <code>{e.action}</code>
                </td>
                <td>{e.miniappId ?? "—"}</td>
                <td>
                  <code className="audit-details">{JSON.stringify(e.details)}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
