import Link from "next/link";
import type { ReactNode } from "react";
import LogoutButton from "@/components/LogoutButton";

// Gemeinsamer Seitenkopf fuer Dashboard, Lernen und Konto:
// dieselbe Navigation ueberall, aktive Seite hervorgehoben.
export type AppPage = "dashboard" | "lernen" | "account";

const NAV_ITEMS: { id: AppPage; href: string; label: string }[] = [
  { id: "dashboard", href: "/", label: "Dashboard" },
  { id: "lernen", href: "/lernen", label: "Lernen" },
  { id: "account", href: "/account", label: "Konto" },
];

export function AppHeader({
  title,
  current,
  actions,
}: {
  title: string;
  current: AppPage;
  // Seitenspezifische Zusatz-Steuerelemente (z.B. "Aktualisieren" auf dem
  // Dashboard), stehen vor der Navigation.
  actions?: ReactNode;
}) {
  return (
    <header className="border-b border-border px-4 sm:px-6 py-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
      <div>
        <p className="text-xs tracking-[0.2em] text-text-faint uppercase">Nexus Atlas</p>
        <h1 className="text-lg font-semibold text-text mt-1">{title}</h1>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {actions}
        <nav aria-label="Hauptnavigation" className="flex items-center gap-1">
          {NAV_ITEMS.map((item) =>
            item.id === current ? (
              <span
                key={item.id}
                aria-current="page"
                className="text-xs px-2 py-1 rounded bg-surface-raised text-text"
              >
                {item.label}
              </span>
            ) : (
              <Link
                key={item.id}
                href={item.href}
                className="text-xs px-2 py-1 rounded text-text-faint hover:text-text hover:bg-surface"
              >
                {item.label}
              </Link>
            )
          )}
        </nav>
        <LogoutButton />
      </div>
    </header>
  );
}

export function AppFooter() {
  return (
    <footer className="border-t border-border px-6 py-4 text-xs text-text-faint">
      NEXUS Atlas · Persönliches Marktüberwachungs-Tool, keine Anlageberatung
    </footer>
  );
}
