import { notFound } from "next/navigation";
import { getStore } from "@/lib/registry/store";
import { getMiniappDetail } from "@/lib/registry/registry";
import { MiniappNotFoundError } from "@/lib/registry/types";
import { getCiProvider, repoFullNameFor, type CiStatus } from "@/lib/ci";
import { auth } from "@/auth";
import { MiniappHeader } from "@/app/components/MiniappHeader";
import { VersionList } from "@/app/components/VersionList";
import { CiBadge } from "@/app/components/CiBadge";

export const dynamic = "force-dynamic";

export default async function MiniappDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const reg = await getStore().load();

  let detail;
  try {
    detail = getMiniappDetail(reg, id);
  } catch (err) {
    if (err instanceof MiniappNotFoundError) notFound();
    throw err;
  }

  const session = await auth();
  const token = session?.githubAccessToken;
  let ciStatus: CiStatus = "unknown";
  if (token) {
    ciStatus = (
      await getCiProvider().getStatus(repoFullNameFor(detail), token)
    ).status;
  }

  return (
    <main className="page">
      <a href="/catalog" className="back-link">← Catálogo</a>

      <div style={{ marginTop: 18 }}>
        <MiniappHeader detail={detail} />
      </div>

      <section className="detail-section">
        <h2>Estado de CI</h2>
        <CiBadge status={ciStatus} />
      </section>

      <section className="detail-section">
        <h2>Capabilities</h2>
        {detail.capabilities.length > 0 ? (
          <ul aria-label="Capabilities" className="cap-list">
            {detail.capabilities.map((c) => (
              <li key={c}>
                <code>{c}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p role="status" className="empty">Sin capabilities declaradas.</p>
        )}
      </section>

      <section className="detail-section">
        <h2>Versiones</h2>
        <VersionList versions={detail.versions} />
      </section>
    </main>
  );
}
