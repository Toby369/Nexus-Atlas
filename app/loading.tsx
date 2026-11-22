// Lade-Anzeige fuer alle Seiten (Toby 21.11.2026: "Button zurueck zu
// Dashboard funktioniert nicht"). Das Dashboard rendert bei jedem Aufruf
// frisch auf dem Server (revalidate = 0) und braucht je nach Datenbank-Last
// mehrere Sekunden. Ohne loading.tsx zeigt Next.js waehrenddessen nichts an,
// der Tipp auf "Zum Dashboard" wirkt wie tot. Mit dieser Datei erscheint die
// Anzeige sofort (sie wird vorab geladen), die Seite folgt, sobald sie da ist.

export default function Loading() {
  return (
    <main className="flex-1 flex flex-col items-center justify-center gap-3 px-4 py-24" aria-busy="true">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-accent" aria-hidden="true" />
      <p className="text-sm text-text-muted">Wird geladen …</p>
    </main>
  );
}
