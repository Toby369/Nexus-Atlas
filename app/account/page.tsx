import ChangePasswordForm from "@/components/ChangePasswordForm";
import { AppFooter, AppHeader } from "@/components/AppHeader";
import PushNotificationSettings from "@/components/PushNotificationSettings";
import LogoutButton from "@/components/LogoutButton";
import TileUsageSummary from "@/components/TileUsageSummary";
import DbSizeSummary from "@/components/DbSizeSummary";
import DataFreshnessList from "@/components/DataFreshnessList";

// Nutzungs-Auswertung liest bei jedem Aufruf frisch (wie app/page.tsx).
export const revalidate = 0;

// Kein eigener Session-Check hier noetig: proxy.ts's Auth-Gate (Phase 4)
// deckt bereits jeden Pfad ausser der in lib/authGate.ts::PUBLIC_EXACT_PATHS
// gelisteten ab -- ohne gueltige Session landet man serverseitig schon vor
// dem Rendern dieser Seite auf /login.
export default function AccountPage() {
  return (
    <main className="flex-1 flex flex-col">
      <AppHeader title="Konto" current="account" />

      <section className="flex-1 px-6 py-8 max-w-xs w-full mx-auto space-y-8">
        <div>
          <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted mb-3">
            Passwort ändern
          </h2>
          <ChangePasswordForm />
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted mb-3">
            Push-Benachrichtigungen
          </h2>
          <PushNotificationSettings />
        </div>
        {/* Ziel der Ampel in der Kopfzeile (components/DataStatusLight.tsx). */}
        <div id="datenstand" className="scroll-mt-4">
          <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted mb-3">Datenstand</h2>
          <DataFreshnessList />
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted mb-3">Datenbank-Speicher</h2>
          <DbSizeSummary />
        </div>
        <div>
          <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted mb-3">Nutzung der Kacheln</h2>
          <TileUsageSummary />
        </div>
        {/* Seit 22.10.2026 hier statt in der Kopfzeile (kompakter Kopf auf dem Handy). */}
        <div>
          <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted mb-3">Abmelden</h2>
          <LogoutButton />
        </div>
      </section>

      <AppFooter />
    </main>
  );
}
