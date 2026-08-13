"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

interface NavLinksProps {
  readonly loggedIn: boolean;
  readonly canAdmin: boolean;
}

/** Links del navbar con resaltado de la ruta activa (texto limpio, sin íconos). */
export function NavLinks({ loggedIn, canAdmin }: NavLinksProps) {
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(`${href}/`);

  const links: { href: string; label: string }[] = [];
  if (loggedIn) {
    links.push({ href: "/catalog", label: "Catálogo" });
    links.push({ href: "/metrics", label: "Métricas" });
    if (canAdmin) links.push({ href: "/estado", label: "Estado" });
  }
  links.push({ href: "/docs", label: "Docs" });

  return (
    <>
      {links.map((l) => {
        const active = isActive(l.href);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={active ? "nav-link is-active" : "nav-link"}
            aria-current={active ? "page" : undefined}
          >
            {l.label}
          </Link>
        );
      })}
    </>
  );
}
