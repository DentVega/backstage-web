import type { ReactNode } from "react";
import { DocsNav } from "@/app/components/DocsNav";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="docs-shell">
      <aside className="docs-sidebar">
        <DocsNav />
      </aside>
      <main className="docs-main">{children}</main>
    </div>
  );
}
