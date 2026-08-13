import { auth } from "@/auth";
import { canScaffold } from "@/lib/scaffold-authz";
import { scaffoldAllowedLogins } from "@/lib/config";
import { getStore } from "@/lib/registry/store";
import { listCatalog } from "@/lib/registry/registry";
import { getHostContractStore } from "@/lib/host-contract/store";
import { getStorageProviderState } from "@/lib/storage";
import { buildEstadoSummary } from "@/lib/estado/summary";

export const dynamic = "force-dynamic";

const PLAT_LABEL: Record<"android" | "ios", string> = { android: "Android", ios: "iOS" };

export default async function EstadoPage() {
  const session = await auth();
  const canAdmin = canScaffold(session?.githubLogin, scaffoldAllowedLogins());

  if (!canAdmin) {
    return (
      <main className="page">
        <p className="eyebrow">Plataforma</p>
        <h1 className="page-title">Estado de la plataforma</h1>
        <div className="console" style={{ marginTop: 24 }}>
          <div className="console-top">
            <span className="tl" /> <span className="tl" /> <span className="tl" />
            <span className="path">backstage · acceso denegado</span>
          </div>
          <p className="empty">
            Sin acceso. Esta vista es solo para el equipo (allowlist de admins de la
            plataforma). Pedile acceso a un administrador.
          </p>
        </div>
      </main>
    );
  }

  const reg = await getStore().load();
  const entries = listCatalog(reg);
  const contract = await getHostContractStore().load();
  const storage = await getStorageProviderState();
  const gateEnforce = process.env.COMPAT_ENFORCE === "1";
  const s = buildEstadoSummary(entries, reg, contract, gateEnforce, storage);

  return (
    <main className="page">
      <div className="page-head-row">
        <div>
          <p className="eyebrow">Plataforma</p>
          <h1 className="page-title">Estado de la plataforma</h1>
          <p className="page-lede">
            Lo que está corriendo ahora mismo — leído en vivo del registro al cargar.
          </p>
        </div>
        <span className="live-dot" aria-hidden="true">● en vivo</span>
      </div>

      <ul className="estado-kpis">
        <li className="kpi">
          <span className="kpi-num">{s.totals.miniapps}</span>
          <span className="kpi-label">miniapps</span>
        </li>
        <li className="kpi">
          <span className="kpi-num">{s.totals.versions}</span>
          <span className="kpi-label">versiones publicadas</span>
        </li>
        <li className="kpi">
          <span className="kpi-num">{s.totals.iosAndAndroid}</span>
          <span className="kpi-label">iOS + Android</span>
        </li>
        <li className="kpi">
          <span className="kpi-num">
            {s.contract.published ? `v${s.contract.contractVersion}` : "—"}
          </span>
          <span className="kpi-label">Host Contract</span>
        </li>
        <li className={`kpi kpi-gate ${s.gate}`}>
          <span className="kpi-num">{s.gate === "enforce" ? "ENFORCE" : "WARN"}</span>
          <span className="kpi-label">compat gate</span>
        </li>
      </ul>

      <section className="estado-section">
        <h2>Flota</h2>
        {s.fleet.length === 0 ? (
          <p className="empty">No hay miniapps registradas todavía.</p>
        ) : (
          <ul className="fleet-list">
            {s.fleet.map((f) => (
              <li key={f.id} className="fleet-row">
                <div className="fleet-main">
                  <span className="fleet-name">{f.name}</span>
                  <span className="fleet-owner">{f.owner}</span>
                </div>
                <div className="fleet-ver">
                  <span className="fleet-served">
                    {f.servedVersion ? `servida ${f.servedVersion}` : "sin versiones"}
                  </span>
                  {f.isRolledBack && (
                    <span className="badge-rollback">rollback · última {f.latestVersion}</span>
                  )}
                </div>
                <span className="fleet-count">{f.versionCount} vers</span>
                <span className="plat-pills">
                  {f.platforms.map((p) => (
                    <span key={p} className={`plat-pill ${p}`}>
                      {PLAT_LABEL[p]}
                    </span>
                  ))}
                </span>
                {f.repoUrl ? (
                  <a className="fleet-repo" href={f.repoUrl} target="_blank" rel="noreferrer">
                    repo ↗
                  </a>
                ) : (
                  <span className="fleet-repo" style={{ opacity: 0.4 }}>
                    —
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="estado-section">
        <h2>Host Contract</h2>
        {s.contract.published ? (
          <>
            <p className="estado-note">
              <strong>v{s.contract.contractVersion}</strong> · React Native{" "}
              {s.contract.reactNative}. Esto es lo que toda miniapp debe satisfacer para
              montar en el host.
            </p>
            <ul className="shared-grid">
              {s.contract.shared.map(([name, ver]) => (
                <li key={name} className="shared-item">
                  <code>{name}</code>
                  <span>{ver}</span>
                </li>
              ))}
            </ul>
            {s.contract.nativeModules.length > 0 && (
              <div className="native-chips">
                <span className="native-label">nativos</span>
                {s.contract.nativeModules.map((n) => (
                  <span key={n} className="chip">
                    {n}
                  </span>
                ))}
              </div>
            )}
          </>
        ) : (
          <p className="empty">Aún no se publicó ningún Host Contract.</p>
        )}
      </section>

      <section className="estado-section">
        <h2>Operación</h2>
        <dl className="op-grid">
          <div className="op-item">
            <dt>Compat gate</dt>
            <dd>
              <span className={`op-pill ${s.gate}`}>
                {s.gate === "enforce" ? "ENFORCE" : "WARN"}
              </span>
              {s.gate === "enforce"
                ? "rechaza publishes incompatibles"
                : "avisa, no bloquea"}
            </dd>
          </div>
          <div className="op-item">
            <dt>Storage</dt>
            <dd>
              <span className="op-pill neutral">{s.storage.active.toUpperCase()}</span>
              por {s.storage.source === "preference" ? "preferencia" : "entorno"} ·
              disponibles: {s.storage.available.join(", ")}
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
