import type { Quelle } from "@/lib/quellen";

// Die kleine Zeile unter einer Anzeige: woher die Zahlen kommen. Leise, aber
// nie ausgeblendet. KI-Texte tragen "KI-generiert", eigene Rechnungen
// "berechnet" -- damit niemand eine Einordnung fuer eine Rohzahl haelt.
export default function Quellenhinweis({ quellen, className = "" }: { quellen: Quelle[]; className?: string }) {
  if (quellen.length === 0) return null;
  const daten = quellen.filter((q) => (q.art ?? "daten") === "daten");
  const berechnet = quellen.some((q) => q.art === "berechnet");
  const ki = quellen.some((q) => q.art === "ki");

  return (
    <p className={`text-[10px] leading-snug text-text-faint ${className}`}>
      {daten.length > 0 && (
        <>
          Daten:{" "}
          {daten.map((q, i) => (
            <span key={q.name}>
              {i > 0 && ", "}
              {q.url ? (
                <a href={q.url} target="_blank" rel="noopener noreferrer" className="hover:text-text-muted underline-offset-2 hover:underline">
                  {q.name}
                </a>
              ) : (
                q.name
              )}
            </span>
          ))}
        </>
      )}
      {berechnet && <>{daten.length > 0 && " · "}eigene Berechnung</>}
      {ki && <>{(daten.length > 0 || berechnet) && " · "}KI-generiert, keine Anlageberatung</>}
    </p>
  );
}
