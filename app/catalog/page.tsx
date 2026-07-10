import { getStore } from "@/lib/registry/store";
import { listCatalog } from "@/lib/registry/registry";
import { CatalogList } from "@/app/components/CatalogList";
import { resolveCiStatuses } from "@/lib/ci/resolve";
import { auth } from "@/auth";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const reg = await getStore().load();
  const entries = listCatalog(reg);
  const session = await auth();
  const statusById = await resolveCiStatuses(entries, session?.githubAccessToken);
  return (
    <main className="page">
      <p className="eyebrow">Registry</p>
      <h1 className="page-title">Catálogo de miniapps</h1>
      <p className="page-lede">
        Cada miniapp es un remote federado independiente. El host las resuelve por versión y
        las monta en runtime.
      </p>
      <div className="console" style={{ marginTop: 32 }}>
        <div className="console-top">
          <span className="tl a" /> <span className="tl" /> <span className="tl" />
          <span className="path">backstage · registry / catalog</span>
        </div>
        <div style={{ padding: "6px 0" }}>
          <CatalogList entries={entries} statusById={statusById} />
        </div>
      </div>
    </main>
  );
}
