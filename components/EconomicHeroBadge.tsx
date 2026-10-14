"use client";

import { useEffect, useState } from "react";
import type { EconomicCalendarEvent } from "@/lib/types";
import {
  getHeroEconomicEventStatus,
  economicDirectionLegend,
  formatZurichTime,
  type HeroEconomicEventStatus,
} from "@/lib/economicCalendar";
import { fetchEconomicResult, resultBiasDisplay } from "@/lib/economicEventResult";
import { CountdownTime, RelativeTime } from "@/components/ClientTimestamp";
import PanelInfo from "@/components/PanelInfo";
import { setVisibleInterval } from "@/lib/visibleInterval";

// Wirtschaftstermin im Lagebild: erscheint 2h vor dem Termin und bleibt bis
// 1h nach dem Ergebnis, sonst ist die Zeile ausgeblendet (Toby 14.10.2026).
// Das Ergebnis ist eine KI-Einordnung der ersten Schlagzeilen danach
// (lib/economicEventResult.ts). Eigene Komponente mit eigenem Poll (wie
// TradingHoursBadge), um HeroHeader schlank zu halten. Die Zustandsmaschine
// lebt in lib/economicCalendar.ts::getHeroEconomicEventStatus.
const POLL_MS = 2 * 60_000;

export default function EconomicHeroBadge({ events }: { events: EconomicCalendarEvent[] }) {
  const [status, setStatus] = useState<HeroEconomicEventStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      let next = await getHeroEconomicEventStatus(events, fetchEconomicResult);
      // Ergebnis steht aus: Einordnung anstossen (ohne passende Schlagzeilen
      // macht die Route nur DB-Reads), danach neu lesen.
      if (next?.phase === "awaiting_result") {
        await fetch("/api/economic-result/generate", { method: "POST" }).catch(() => undefined);
        next = await getHeroEconomicEventStatus(events, fetchEconomicResult);
      }
      if (!cancelled) setStatus(next);
    };
    load();
    const stopPolling = setVisibleInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [events]);

  if (!status) return null;

  const bias = status.result ? resultBiasDisplay(status.result.bias) : null;

  return (
    <div className="rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text-muted">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="flex items-center gap-1.5 min-w-0">
          <span className="uppercase tracking-[0.12em] text-[10px] opacity-70 whitespace-nowrap">
            Wirtschaftsdaten
          </span>
          <PanelInfo title="Wirtschaftsdaten" content={economicDirectionLegend(status.eventKey)} />
          <span className="whitespace-nowrap">
            {status.label} · {formatZurichTime(status.markMs)}
          </span>
        </span>
        <span className="flex items-center gap-1.5 whitespace-nowrap font-semibold">
          {status.phase === "upcoming" && <CountdownTime targetMs={status.markMs} />}
          {status.phase === "awaiting_result" && "Ergebnis steht noch aus"}
          {bias && (
            <>
              {bias.emoji} <span className={bias.colorClass}>{bias.label}</span>
            </>
          )}
        </span>
      </div>
      {status.result && (
        <p className="mt-1 text-text">
          {status.result.summary}{" "}
          <RelativeTime iso={status.result.created_at} className="opacity-60" />
        </p>
      )}
    </div>
  );
}
