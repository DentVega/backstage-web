import type { ReactNode } from "react";
import { DocsNav } from "@/app/components/DocsNav";
import { DocsSearch } from "@/app/components/DocsSearch";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="docs-shell">
      <aside className="docs-sidebar">
        <DocsSearch />
        <DocsNav />
      </aside>
      <main className="docs-main">{children}</main>
    </div>
  );
}
