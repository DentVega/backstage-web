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
    <main style={{ padding: 24, fontFamily: "system-ui, sans-serif" }}>
      <h1>Backstage — Catálogo de miniapps</h1>
      <p>Miniapps registradas y sus versiones publicadas.</p>
      <CatalogList entries={entries} statusById={statusById} />
    </main>
  );
}
