"use client";

import { DATA_SOURCES, DATA_SOURCE_KEYS, evaluateSources, formatAge, STATUS_LABEL } from "@/lib/dataFreshness";
import { useDataFreshness } from "@/lib/dataFreshnessStore";
import { STATUS_DOT } from "@/components/DataStatusLight";

// Liste aller Datenquellen im Konto (Ziel der Ampel in der Kopfzeile):
// je Quelle Zustand, letzter Stand und was normal waere. Probleme zuerst.
const ORDER = { ausgefallen: 0, verspaetet: 1, unbekannt: 2, frisch: 3 } as const;

function normalText(min: number): string {
  if (min < 60) return `bis ${min} Min`;
  const std = min / 60;
  return `bis ${Number.isInteger(std) ? std : std.toFixed(1)} Std`;
}

export default function DataFreshnessList() {
  const { data, nowMs, fetchFailed } = useDataFreshness();
  if (!data) return <p className="text-xs text-text-faint">Datenstand wird geladen …</p>;

  const items = evaluateSources(DATA_SOURCE_KEYS, data, nowMs).sort(
    (a, b) => ORDER[a.status] - ORDER[b.status] || DATA_SOURCES.indexOf(a.meta) - DATA_SOURCES.indexOf(b.meta)
  );

  return (
    <div className="space-y-2">
      {fetchFailed && (
        <p className="text-xs text-warn">Neu laden fehlgeschlagen, angezeigt ist der letzte Stand.</p>
      )}
      <ul className="divide-y divide-border text-xs">
        {items.map((i) => (
          <li key={i.meta.key} className="flex items-center gap-2 py-1.5">
            <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[i.status]}`} />
            <span className="flex-1 min-w-0 truncate text-text">{i.meta.label}</span>
            <span
              className={`shrink-0 tabular-nums ${
                i.status === "ausgefallen" ? "text-down" : i.status === "verspaetet" ? "text-warn" : "text-text-muted"
              }`}
              title={`${STATUS_LABEL[i.status]}, normal ${normalText(i.meta.normalMaxMin)}`}
            >
              {formatAge(i.ageMs)}
            </span>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-text-faint">
        Gelb: älter als normal. Rot: dreimal so alt wie normal oder keine Daten. Liquidationen fehlen
        bewusst: keine Liquidation heisst ruhiger Markt, nicht Ausfall.
      </p>
    </div>
  );
}
