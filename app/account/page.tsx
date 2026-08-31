import Link from "next/link";
import ChangePasswordForm from "@/components/ChangePasswordForm";
import LogoutButton from "@/components/LogoutButton";

// Kein eigener Session-Check hier noetig: proxy.ts's Auth-Gate (Phase 4)
// deckt bereits jeden Pfad ausser der in lib/authGate.ts::PUBLIC_EXACT_PATHS
// gelisteten ab -- ohne gueltige Session landet man serverseitig schon vor
// dem Rendern dieser Seite auf /login.
export default function AccountPage() {
  return (
    <main className="flex-1 flex flex-col">
      <header className="border-b border-border px-6 py-5 flex items-baseline justify-between">
        <div>
          <p className="text-xs tracking-[0.2em] text-text-faint uppercase">Nexus Atlas</p>
          <h1 className="text-lg font-semibold text-text mt-1">Konto</h1>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href="/"
            className="text-xs text-text-faint hover:text-text-muted underline decoration-dotted"
          >
            ← Dashboard
          </Link>
          <LogoutButton />
        </div>
      </header>

      <section className="flex-1 px-6 py-8 max-w-xs w-full mx-auto">
        <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted mb-3">
          Passwort ändern
        </h2>
        <ChangePasswordForm />
      </section>
    </main>
  );
}
