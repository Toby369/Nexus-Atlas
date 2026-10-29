"use client";

import Link from "next/link";
import {
  DATA_SOURCE_KEYS,
  describe,
  evaluateSources,
  problems,
  worstStatus,
  type FreshnessStatus,
} from "@/lib/dataFreshness";
import { useDataFreshness } from "@/lib/dataFreshnessStore";

// Ampel in der Kopfzeile: laufen alle Sammler im Takt? Ein Ausfall soll
// auffallen, bevor man einer Einschaetzung aus alten Daten vertraut.
// Gruen bleibt ein stiller Punkt, Text erscheint erst bei einem Problem.
// Klick fuehrt zur Liste aller Quellen im Konto.

export const STATUS_DOT: Record<FreshnessStatus, string> = {
  frisch: "bg-up",
  verspaetet: "bg-warn",
  ausgefallen: "bg-down",
  unbekannt: "bg-text-faint",
};

export default function DataStatusLight() {
  const { data, nowMs, fetchFailed } = useDataFreshness();
  if (!data) return null;

  const items = evaluateSources(DATA_SOURCE_KEYS, data, nowMs);
  const status = worstStatus(items);
  const offen = problems(items);
  const titel = fetchFailed
    ? "Datenstand konnte nicht neu geladen werden"
    : offen.length === 0
      ? "Alle Datenquellen aktuell"
      : offen.map(describe).join("\n");
  const text =
    offen.length === 0 ? null : offen.length === 1 ? offen[0].meta.label : `${offen.length} Quellen`;

  return (
    <Link
      href="/account#datenstand"
      title={titel}
      aria-label={`Datenstand: ${titel}`}
      className="flex items-center gap-1.5 px-1.5 py-1 rounded text-[11px] text-text-muted hover:bg-surface-raised min-w-0"
    >
      <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
      {text && (
        <span className={`truncate max-w-[9rem] ${status === "ausgefallen" ? "text-down" : "text-warn"}`}>
          {text}
        </span>
      )}
    </Link>
  );
}
