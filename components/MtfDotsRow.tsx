"use client";

import { MTF_DOT_COLOR_CLASSES, type MtfTimeframeDot } from "@/lib/mtfSignal";

// MTF-Ampel: kompakte Badge-Zeile fuer die 15M/1H/4H/1D/1W-Trendrichtung,
// Zeitrahmen-Labels direkt sichtbar. Jeder Punkt traegt ein natives
// title-Attribut mit der vollen Begruendung (ADX-Wert etc.). Eine gemeinsame
// Komponente fuer alle Kacheln, damit Layout-/Kontrast-Fixes ueberall wirken.
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
