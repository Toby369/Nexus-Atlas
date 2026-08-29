import LoginForm from "@/components/LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  // Nur relative Pfade zulassen (Open-Redirect-Schutz) -- proxy.ts setzt
  // "next" selbst auf den urspruenglich angefragten Pfad, ein
  // fremdgesteuerter Wert waere trotzdem nur ueber die URL manipulierbar.
  // Fallback "/": Phase 4 hat das Auth-Gate auf die gesamte Anwendung
  // ausgeweitet, die Startseite ist damit der sinnvolle Standard-Zielort
  // nach dem Login (vorher "/reports", als nur der Report-Bereich gesperrt
  // war).
  const safeNext = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-4 py-16">
      <div className="mb-6 text-center">
        <p className="text-xs tracking-[0.2em] text-text-faint uppercase">Nexus Atlas</p>
        <h1 className="text-lg font-semibold text-text mt-1">Login</h1>
        <p className="text-xs text-text-faint mt-2 max-w-xs">
          Persönliches Marktüberwachungs-Tool — Zugang nur mit Account.
        </p>
      </div>
      <LoginForm next={safeNext} />
    </main>
  );
}
