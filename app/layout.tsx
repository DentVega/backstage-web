import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";
import { auth } from "@/auth";
import { canScaffold } from "@/lib/scaffold-authz";
import { scaffoldAllowedLogins } from "@/lib/config";
import { UserMenu } from "@/app/components/UserMenu";
import { ThemeToggle } from "@/app/components/ThemeToggle";
import { NavLinks } from "@/app/components/NavLinks";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Backstage — miniapps",
  description: "Registry & catalog for React Native miniapps",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const session = await auth();
  const canAdmin = canScaffold(session?.githubLogin, scaffoldAllowedLogins());
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable}`}>
      <body>
        <header className="site-header">
          <Link href="/catalog" className="brand">
            <span className="brand-dot" aria-hidden="true" />
            <span>Backstage</span>
            <span className="brand-sub">/ miniapps</span>
          </Link>
          <span className="header-sp" />
          <div className="header-actions">
            <NavLinks loggedIn={Boolean(session?.user)} canAdmin={canAdmin} />
            <ThemeToggle />
            <UserMenu user={session?.user} />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
