import { notFound } from "next/navigation";
import { getStore } from "@/lib/registry/store";
import { getMiniappDetail } from "@/lib/registry/registry";
import { MiniappNotFoundError } from "@/lib/registry/types";
import { getCiProvider, repoFullNameFor, type CiStatus } from "@/lib/ci";
import { resolveDriftStatuses } from "@/lib/drift/resolve";
import { auth } from "@/auth";
import { canManageMiniapp } from "@/lib/scaffold-authz";
import { scaffoldAllowedLogins } from "@/lib/config";
import { MiniappHeader } from "@/app/components/MiniappHeader";
import { VersionList } from "@/app/components/VersionList";
import { CiBadge } from "@/app/components/CiBadge";
import { DriftBadge } from "@/app/components/DriftBadge";
import { PublishForm } from "@/app/components/PublishForm";
import { DeployButton } from "@/app/components/DeployButton";
import { SyncTemplateButton } from "@/app/components/SyncTemplateButton";
import { getMiniappStorageState } from "@/lib/storage";
import { MiniappStorageControl } from "@/app/components/MiniappStorageControl";
import { MiniappVersionControl } from "@/app/components/MiniappVersionControl";
import { MaintainersControl } from "@/app/components/MaintainersControl";
import { MiniappDeleteControl } from "@/app/components/MiniappDeleteControl";

export const dynamic = "force-dynamic";

/**
 * Qué le da al miniapp cada capability (para el tooltip). Permisos acotados y revocables
 * que el host otorga — nunca un credential crudo. Set semilla del contrato.
 */
const CAPABILITY_INFO: Record<string, string> = {
  "accounts:read":
    "Leer las cuentas del usuario (saldos, listado) que el host expone. Solo lectura — nunca escribe ni recibe el credential.",
  "session:whoami":
    "Saber quién es el usuario logueado (identidad de la sesión). Sin acceso al token de sesión.",
};

export default async function MiniappDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const rec = await getStore().getApp(id); // solo esa miniapp

  let detail;
  try {
    detail = getMiniappDetail(rec ? { [id]: rec } : {}, id);
  } catch (err) {
    if (err instanceof MiniappNotFoundError) notFound();
    throw err;
  }

  const session = await auth();
  const canPublish = canManageMiniapp(
    session?.githubLogin,
    detail.maintainers,
    scaffoldAllowedLogins(),
  );
  const storageState = canPublish
    ? await getMiniappStorageState(detail.storageProvider ?? null)
    : null;
  const token = session?.githubAccessToken;
  let ciStatus: CiStatus = "unknown";
  if (token) {
    ciStatus = (
      await getCiProvider().getStatus(repoFullNameFor(detail), token)
    ).status;
  }
  const driftStatus = (await resolveDriftStatuses([detail]))[detail.id] ?? "unknown";

  return (
    <main className="page">
      <a href="/catalog" className="back-link">← Catálogo</a>

      <div style={{ marginTop: 18 }}>
        <MiniappHeader detail={detail} />
      </div>

      <section className="detail-section">
        <h2>Estado de CI</h2>
        <CiBadge status={ciStatus} />
        <DriftBadge status={driftStatus} />
      </section>

      <section className="detail-section">
        <h2>Capabilities</h2>
        {detail.capabilities.length > 0 ? (
          <ul aria-label="Capabilities" className="cap-list">
            {detail.capabilities.map((c) => {
              const info = CAPABILITY_INFO[c];
              return (
                <li key={c}>
                  <code>{c}</code>
                  {info ? (
                    <span className="cap-info" tabIndex={0} role="note" aria-label={`${c}: ${info}`}>
                      <span aria-hidden="true">ⓘ</span>
                      <span className="cap-tip" role="tooltip">{info}</span>
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p role="status" className="empty">Sin capabilities declaradas.</p>
        )}
      </section>

      <section className="detail-section">
        <h2>Versiones</h2>
        <VersionList
          versions={detail.versions}
          servedVersion={detail.servedVersion}
          miniappId={id}
          canDelete={canPublish}
        />
      </section>

      {canPublish ? (
        <>
          <section className="detail-section">
            <h2>Maintainers</h2>
            <MaintainersControl id={id} maintainers={detail.maintainers} />
          </section>
          <section className="detail-section">
            <h2>Versión servida (rollback)</h2>
            <MiniappVersionControl
              id={id}
              versions={detail.versions}
              pinnedVersion={detail.pinnedVersion}
              servedVersion={detail.servedVersion}
              latestVersion={detail.latestVersion}
            />
          </section>
          <section className="detail-section">
            <h2>Deploy</h2>
            <DeployButton id={id} />
          </section>
          <section className="detail-section">
            <h2>Almacenamiento</h2>
            {storageState !== null && <MiniappStorageControl id={id} {...storageState} />}
          </section>
          <section className="detail-section">
            <h2>Actualizar desde template</h2>
            <SyncTemplateButton id={id} />
          </section>
          <section className="detail-section">
            <h2>Publicar versión</h2>
            <PublishForm id={id} />
          </section>
          <section className="detail-section danger-section">
            <h2>Zona de peligro</h2>
            <MiniappDeleteControl id={id} hasRepo={detail.repoUrl !== undefined} />
          </section>
        </>
      ) : null}
    </main>
  );
}
