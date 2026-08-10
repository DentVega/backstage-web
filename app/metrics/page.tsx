import { getStore } from "@/lib/registry/store";
import { getMetricsStore } from "@/lib/metrics/store";

export const dynamic = "force-dynamic";

/** Explicación de cada razón de fallback (para el tooltip). kind: transitorio se auto-reintenta. */
const REASON_INFO: Record<string, { kind: "transitorio" | "permanente"; desc: string }> = {
  "resolve-failed": {
    kind: "transitorio",
    desc: "No se pudo resolver qué montar: falló GET /api/resolve (device sin red, Backstage caído, o no hay versión/plataforma compatible).",
  },
  "download-failed": {
    kind: "transitorio",
    desc: "Se resolvió la versión, pero bajar el chunk del CDN (R2) falló.",
  },
  "integrity-failed": {
    kind: "transitorio",
    desc: "El chunk bajó pero su sha256 no coincide con el del manifest (corrupto o incompleto).",
  },
  "invalid-manifest": {
    kind: "permanente",
    desc: "El manifest de la versión no cumple el contrato o tiene datos inválidos.",
  },
  skew: {
    kind: "permanente",
    desc: "Una librería compartida (singleton) está en una versión incompatible con la que provee el host.",
  },
  "host-too-old": {
    kind: "permanente",
    desc: "La miniapp exige un Host Contract más nuevo (minHostContract) que el del binario del host.",
  },
};

export default async function MetricsPage() {
  const reg = await getStore().load();
  const snap = await getMetricsStore().snapshot(Object.keys(reg));

  const mounts = Object.entries(snap.mounts)
    .map(([id, count]) => ({ id, name: reg[id]?.name ?? id, count }))
    .filter((m) => m.count > 0)
    .sort((a, b) => b.count - a.count);
  const fallbacks = Object.entries(snap.fallbacks)
    .map(([reason, count]) => ({ reason, count }))
    .filter((f) => f.count > 0)
    .sort((a, b) => b.count - a.count);

  const totalMounts = mounts.reduce((s, m) => s + m.count, 0);
  const totalFallbacks = fallbacks.reduce((s, f) => s + f.count, 0);
  const maxMount = mounts[0]?.count ?? 1;
  const maxFb = fallbacks[0]?.count ?? 1;

  return (
    <main className="page">
      <p className="eyebrow">Observabilidad</p>
      <h1 className="page-title">Métricas</h1>
      <p className="page-lede">
        Telemetría de runtime reportada por el host: qué miniapps se montan y qué falla al montarlas.
      </p>

      <section className="metrics-section">
        <h2>
          Mounts por miniapp <span className="metric-total">· {totalMounts} total</span>
        </h2>
        {mounts.length === 0 ? (
          <p role="status" className="empty">Sin mounts registrados todavía.</p>
        ) : (
          <ul className="metric-bars">
            {mounts.map((m) => (
              <li key={m.id} className="metric-bar">
                <span className="metric-label">{m.name}</span>
                <span className="metric-track">
                  <span className="metric-fill" style={{ width: `${(m.count / maxMount) * 100}%` }} />
                </span>
                <span className="metric-count">{m.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="metrics-section">
        <h2>
          Fallbacks por razón <span className="metric-total">· {totalFallbacks} total</span>
        </h2>
        {fallbacks.length === 0 ? (
          <p role="status" className="empty">Sin fallbacks — todo montó bien. 🎉</p>
        ) : (
          <ul className="metric-bars">
            {fallbacks.map((f) => {
              const info = REASON_INFO[f.reason];
              return (
                <li key={f.reason} className="metric-bar">
                  <span className="metric-label">
                    <code>{f.reason}</code>
                    {info ? (
                      <span
                        className={`reason-info ${info.kind}`}
                        tabIndex={0}
                        role="note"
                        aria-label={`${f.reason} (${info.kind}): ${info.desc}`}
                      >
                        <span aria-hidden="true">ⓘ</span>
                        <span className="reason-tip" role="tooltip">
                          <b>{info.kind === "transitorio" ? "🔄 Transitorio" : "🔒 Permanente"}</b>
                          {info.desc}
                        </span>
                      </span>
                    ) : null}
                  </span>
                  <span className="metric-track">
                    <span className="metric-fill bad" style={{ width: `${(f.count / maxFb) * 100}%` }} />
                  </span>
                  <span className="metric-count">{f.count}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </main>
  );
}
