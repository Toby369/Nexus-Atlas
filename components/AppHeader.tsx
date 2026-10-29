import Link from "next/link";
import type { ReactNode } from "react";
import DataStatusLight from "@/components/DataStatusLight";

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
  // 22.10.2026 (Toby: "oben viel Leerraum"): eine Zeile statt drei auf dem
  // Handy -- Marke links, Navigation rechts. Der Seitentitel bleibt fuer
  // Screenreader, "Logout" steht jetzt auf der Konto-Seite.
  return (
    <header className="border-b border-border bg-surface px-4 sm:px-6 py-2.5 flex items-center justify-between gap-3">
      <h1 className="sr-only">{title}</h1>
      <Link href="/" className="flex items-center gap-2 text-sm font-semibold text-text shrink-0">
        <span aria-hidden="true" className="h-4 w-4 rounded border border-accent bg-accent/15" />
        <span>
          Nexus <span className="text-accent">Atlas</span>
        </span>
      </Link>
      <div className="flex items-center gap-2 min-w-0">
        <DataStatusLight />
        {actions}
        <nav aria-label="Hauptnavigation" className="flex items-center gap-0.5">
          {NAV_ITEMS.map((item) =>
            item.id === current ? (
              <span
                key={item.id}
                aria-current="page"
                className="text-xs px-2 py-1 rounded bg-accent/15 text-accent"
              >
                {item.label}
              </span>
            ) : (
              <Link
                key={item.id}
                href={item.href}
                className="text-xs px-2 py-1 rounded text-text-muted hover:text-text hover:bg-surface-raised"
              >
                {item.label}
              </Link>
            )
          )}
        </nav>
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
