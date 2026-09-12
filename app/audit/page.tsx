import { getAuditStore } from "@/lib/audit/log";
import { auditAdminLogins } from "@/lib/config";
import { canScaffold } from "@/lib/scaffold-authz";
import { AuditTable } from "./audit-table";

export const dynamic = "force-dynamic";

export default async function AuditPage() {
  const { auth } = await import("@/auth");
  const session = await auth();
  if (!canScaffold(session?.githubLogin, auditAdminLogins())) {
    return (
      <main className="page">
        <h1 className="page-title">Auditoría</h1>
        <p role="status" className="empty">
          No autorizado. Esta página es solo para administradores.
        </p>
      </main>
    );
  }

  const store = getAuditStore();
  const [events, integrity] = await Promise.all([
    store.readAll({ limit: 500 }),
    store.verify(),
  ]);

  return (
    <main className="page">
      <p className="eyebrow">Seguridad</p>
      <h1 className="page-title">Auditoría</h1>
      <p className="page-lede">
        Quién hizo qué en el control-plane: publicaciones y cambios de gestión.
      </p>

      {integrity.ok ? (
        <p role="status" className="audit-integrity ok">
          ✅ Cadenas íntegras ({integrity.chains.length}).
        </p>
      ) : (
        <p role="alert" className="audit-integrity bad">
          ⚠️ Integridad comprometida:{" "}
          {integrity.chains
            .filter((c) => !c.ok)
            .map((c) => `${c.chain} (seq ${c.brokenAt})`)
            .join(", ")}
        </p>
      )}

      <AuditTable events={events} />
    </main>
  );
}
