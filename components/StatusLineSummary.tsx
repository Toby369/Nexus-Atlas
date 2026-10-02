import type { ArrowDirection } from "@/lib/heroSummary";

// Ebene-0-Statuszeilen (Nutzer-Feedback vom 31.08.2026, siehe
// lib/heroSummary.ts fuer die 4-Zustands-Pfeil-Logik): eine Zeile je Sparte
// mit ihrem eigenen, bereits vorhandenen Wert -- kein neuer Blend-Score,
// nur die Zusammenstellung. Reine Praesentationskomponente, die fertigen
// Text/Pfeil-Zustand entgegennimmt statt selbst etwas zu berechnen.

export interface StatusLineItem {
  key: string;
  label: string;
  valueText: string;
  arrow: ArrowDirection;
  // Nur gesetzt fuer Zeilen, die Teil der Hero-Bestaetigungszaehlung sind
  // (siehe lib/heroSummary.ts::summarizeConfirmation) -- true = bestaetigt
  // die primaere Richtung, false = widerspricht ihr, undefined = nicht Teil
  // des Vergleichs (kein Marker).
  confirms?: boolean;
}

const ARROW_GLYPH: Record<ArrowDirection, string> = {
  up: "↑",
  down: "↓",
  neutral: "→",
  not_available: "—",
};

const ARROW_COLOR: Record<ArrowDirection, string> = {
  up: "text-up",
  down: "text-down",
  neutral: "text-text-faint",
  not_available: "text-text-faint",
};

// Andockt die vormals separat schwebende "X von Y Signalen bestaetigen"-
// Zeile direkt an diese Liste (Nutzer-Feedback: Kopf-Kachel "verstaendlicher,
// klarer, strukturierter" -- die Bestaetigung bezieht sich inhaltlich genau
// auf diese Zeilen, stand vorher aber als eigener, davon losgeloester Satz
// davor). heading optional, damit die Liste auch ohne Bestaetigungs-Kontext
// (z.B. wenn primaryDirection null ist) weiter allein nutzbar bleibt.
export default function StatusLineSummary({
  items,
  heading,
}: {
  items: StatusLineItem[];
  heading?: string;
}) {
  return (
    <div className="pt-2 border-t border-border/60">
      {heading && <p className="text-xs text-text-faint pb-1">{heading}</p>}
      <ul className="divide-y divide-border/40">
        {items.map((item) => (
          <li key={item.key} className="flex items-center justify-between gap-3 py-1.5 text-xs">
            <span className="text-text-muted shrink-0 flex items-center gap-1">
              {item.confirms === true && (
                <span className="text-up" title="Bestätigt die Gesamteinschätzung" aria-hidden="true">
                  ✓
                </span>
              )}
              {item.confirms === false && (
                <span className="text-down" title="Widerspricht der Gesamteinschätzung" aria-hidden="true">
                  ✗
                </span>
              )}
              {item.label}
            </span>
            <span className="flex items-center gap-2 min-w-0 justify-end">
              <span className="text-text-faint truncate">{item.valueText}</span>
              <span
                className={`font-mono w-3 text-center shrink-0 ${ARROW_COLOR[item.arrow]}`}
                aria-hidden="true"
              >
                {ARROW_GLYPH[item.arrow]}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
