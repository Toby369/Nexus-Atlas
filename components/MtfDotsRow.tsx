"use client";

import { MTF_DOT_COLOR_CLASSES, type MtfTimeframeDot } from "@/lib/mtfSignal";

// MTF-Ampel (22.09.2026): kompakte Badge-Zeile fuer 15M/1H/4H/1D/1W-
// Trendrichtung -- Mischung aus zwei mit Toby abgestimmten Mockup-Varianten
// ("A": Zeitrahmen-Labels direkt sichtbar statt nur Hover-Tooltip, "C": kein
// neuer Kachel-Platz, Badge sitzt im bestehenden Header). Jeder Punkt traegt
// zusaetzlich ein natives title-Attribut mit der vollen Begruendung (ADX-
// Wert etc.). Gemeinsame Komponente statt Kopie pro Kachel (Nutzer-Wunsch
// 22.09.2026: "auf alle Kacheln anwenden") -- so wirkt ein Layout-/Kontrast-
// Fix (siehe Labelgroesse/-farbe) ueberall gleichzeitig.
export default function MtfDotsRow({ dots }: { dots: MtfTimeframeDot[] }) {
  return (
    <div className="flex items-center gap-2">
      {dots.map((dot) => (
        <div key={dot.timeframe} className="flex flex-col items-center gap-1" title={dot.detail}>
          <span className={`w-2 h-2 rounded-full ${MTF_DOT_COLOR_CLASSES[dot.status]}`} />
          <span className="tabular text-[11px] leading-none font-medium text-text">{dot.timeframe}</span>
        </div>
      ))}
    </div>
  );
}
