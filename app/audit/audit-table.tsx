"use client";
import { useMemo, useState } from "react";
import type { AuditEvent } from "@/lib/audit/types";

/** Agrupa las acciones por naturaleza para colorear el chip. */
function actionKind(action: string): "create" | "change" | "danger" {
  if (action.startsWith("delete")) return "danger";
  if (action === "publish" || action === "register" || action === "scaffold") return "create";
  return "change";
}

/** Trunca strings largos (hashes, urls) por el medio, dejando el full en `title`. */
function short(value: string): string {
  if (value.length <= 22) return value;
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}

function renderValue(v: unknown): { text: string; full: string } {
  if (typeof v === "boolean") return { text: v ? "sí" : "no", full: String(v) };
  if (Array.isArray(v)) {
    const joined = v.length ? v.join(", ") : "—";
    return { text: short(joined), full: joined };
  }
  if (v === null || v === undefined) return { text: "—", full: "—" };
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return { text: short(s), full: s };
}

function DetailChips({ details }: { details: Record<string, unknown> }) {
  const entries = Object.entries(details);
  if (entries.length === 0) return <span className="audit-none">sin detalle</span>;
  return (
    <div className="audit-kvs">
      {entries.map(([k, v]) => {
        const { text, full } = renderValue(v);
        return (
          <span className="audit-kv" key={k}>
            <span className="audit-kv-k">{k}</span>
            <span className="audit-kv-v" title={full}>
              {text}
            </span>
          </span>
        );
      })}
    </div>
  );
}

export function AuditTable({ events }: { events: AuditEvent[] }) {
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const actions = useMemo(() => [...new Set(events.map((e) => e.action))].sort(), [events]);
  const filtered = events.filter(
    (e) =>
      (!action || e.action === action) &&
      (!actor || e.actor.login.toLowerCase().includes(actor.toLowerCase())),
  );

  return (
    <section className="audit-section">
      <div className="audit-filters">
        <label className="audit-field">
          <span>Acción</span>
          <select value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">todas</option>
            {actions.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="audit-field">
          <span>Actor</span>
          <input value={actor} onChange={(e) => setActor(e.target.value)} placeholder="login" />
        </label>
        <span className="audit-count">
          {filtered.length} {filtered.length === 1 ? "evento" : "eventos"}
        </span>
      </div>

      {filtered.length === 0 ? (
        <p role="status" className="empty">
          Sin eventos.
        </p>
      ) : (
        <ul className="audit-list">
          {filtered.map((e) => {
            const d = new Date(e.ts);
            const date = d.toISOString().slice(0, 10);
            const time = d.toISOString().slice(11, 19);
            return (
              <li className="audit-row" key={`${e.chain}:${e.seq}`}>
                <div className="audit-when">
                  <span className="audit-date">{date}</span>
                  <span className="audit-time">{time}</span>
                </div>
                <div className="audit-body">
                  <div className="audit-head">
                    <span className={`audit-action k-${actionKind(e.action)}`}>{e.action}</span>
                    {e.miniappId ? <span className="audit-miniapp">{e.miniappId}</span> : null}
                    <span className={`audit-actor a-${e.actor.type}`}>
                      <span className="audit-actor-dot" aria-hidden="true" />
                      {e.actor.login}
                      <span className="audit-actor-type">{e.actor.type}</span>
                    </span>
                  </div>
                  <DetailChips details={e.details} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
