import type { ReactNode } from "react";

// "Zweitmeinungen (KI)" -- buendelt Eskalation und Trade-Debate in einer
// Kachel (Aufraeumrunde 11.10.2026, siehe NEXUS-STRUKTUR-KONZEPT Abschnitt
// 8): beide holen per Klick zusaetzliche KI-Meinungen zur aktuellen Lage ein
// und wurden einzeln kaum genutzt. Funktion und API-Routen bleiben
// unveraendert, nur die Darstellung ist zusammengelegt.
export default function SecondOpinionsCard({
  escalation,
  tradeDebate,
}: {
  escalation: ReactNode;
  tradeDebate: ReactNode;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-4">
      <p className="text-sm font-medium text-text">Zweitmeinungen (KI)</p>
      {tradeDebate}
      <div className="border-t border-border pt-4">{escalation}</div>
    </div>
  );
}
