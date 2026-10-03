"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { EconomicCalendarEvent } from "@/lib/types";
import {
  getHeroEconomicEventStatus,
  economicDirectionMeaning,
  economicDirectionLegend,
  type HeroEconomicEventStatus,
  type MacroSnapshotFetcher,
} from "@/lib/economicCalendar";
import { CountdownTime, RelativeTime } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";

// Head-Kachel-Wirtschaftstermin (Nutzer-Wunsch 03.10.2026: "aktuellste
// bevorstehende daten sollen in head kachel erscheinen, bis und mit die
// daten da sind (verbleibt dann 4h mit den aktuellen daten) gleichzeitig
// kommt dann die naechste bevorstehende."). Eigene kleine Komponente statt
// weiterer Logik in der ohnehin schon sehr grossen HeroHeader.tsx -- gleiches
// Muster wie TradingHoursBadge (eigener Fetch/Poll, direkt unter diesem
// platziert). Die Zustandsmaschine selbst (upcoming/awaiting_result/
// result_recent) lebt in lib/economicCalendar.ts::getHeroEconomicEventStatus,
// hier nur der Supabase-Fetcher + die Darstellung.
const POLL_MS = 2 * 60_000;

const fetchMacroRows: MacroSnapshotFetcher = async (symbol, bound, limit, order) => {
  let query = supabase
    .from("macro_snapshots")
    .select("last_price, timestamp_utc")
    .eq("symbol", symbol)
    .eq("status", "ok");
  query = "beforeIso" in bound ? query.lt("timestamp_utc", bound.beforeIso) : query.gte("timestamp_utc", bound.fromIso);
  const { data, error } = await query.order("timestamp_utc", { ascending: order === "asc" }).limit(limit);

  if (error) {
    console.error(`EconomicHeroBadge: Fehler beim Laden von macro_snapshots (${symbol}):`, error.message);
    return [];
  }
  return data ?? [];
};

function fmtValue(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2);
}

export default function EconomicHeroBadge({ events }: { events: EconomicCalendarEvent[] }) {
  const [status, setStatus] = useState<HeroEconomicEventStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const result = await getHeroEconomicEventStatus(events, fetchMacroRows);
      if (!cancelled) setStatus(result);
    };
    load();
    const interval = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [events]);

  if (!status) return null;

  let valueNode: React.ReactNode;
  if (status.phase === "upcoming") {
    valueNode = <CountdownTime targetMs={status.markMs} className="font-semibold" />;
  } else if (status.phase === "awaiting_result") {
    valueNode = <span className="font-semibold">Ergebnis steht noch aus</span>;
  } else {
    const direction =
      status.baselineValue === null || status.actualValue === null
        ? "flat"
        : status.actualValue > status.baselineValue
        ? "up"
        : status.actualValue < status.baselineValue
        ? "down"
        : "flat";
    const { arrow, emoji, meaning } = economicDirectionMeaning(status.eventKey, direction);
    const colorClass = meaning === "bärisch" ? "text-down" : meaning === "bullisch" ? "text-up" : "text-text-faint";
    valueNode = (
      <span className="font-semibold">
        {status.actualValue !== null ? fmtValue(status.actualValue) : "—"}
        {status.baselineValue !== null && (
          <span className="opacity-70"> (vorher {fmtValue(status.baselineValue)})</span>
        )}{" "}
        {arrow} {emoji} <span className={colorClass}>{meaning}</span>
      </span>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text-muted">
      <span className="flex items-center gap-1.5 min-w-0">
        <span className="uppercase tracking-[0.12em] text-[10px] opacity-70 whitespace-nowrap">
          Wirtschaftsdaten
        </span>
        <PanelInfo title="Wirtschaftsdaten" content={economicDirectionLegend(status.eventKey)} />
        <span className="truncate">{status.label}</span>
      </span>
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        {valueNode}
        {status.phase === "result_recent" && status.resultDetectedAtMs !== null && (
          <RelativeTime iso={new Date(status.resultDetectedAtMs).toISOString()} className="opacity-60" />
        )}
      </span>
    </div>
  );
}
