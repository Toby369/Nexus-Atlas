"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { EconomicCalendarEvent } from "@/lib/types";
import PanelInfo from "@/components/PanelInfo";
import { economicCalendarInfo } from "@/lib/panelInfo";
import {
  AWAITING_MAX_MS,
  ECONOMIC_EVENT_INTERPRETATION,
  economicDirectionLegend,
  economicEventMarkMs,
  formatZurichTime,
} from "@/lib/economicCalendar";
import { fetchEconomicResult, resultBiasDisplay, type EconomicEventResult } from "@/lib/economicEventResult";
import { ShortDate, DaysUntil, RelativeTime } from "@/components/ClientTimestamp";
import { setVisibleInterval } from "@/lib/visibleInterval";

// Kalendertermine aendern sich selten und fast immer mit Vorlauf -- deutlich
// laengeres Poll-Intervall als bei den uebrigen, minuetlich schwankenden
// Kacheln (vgl. REFRESH_INTERVAL_MS in LivePriceDataProvider.tsx: 60s). Der
// Collector selbst laeuft ohnehin nur 1x taeglich (siehe collect-economic-
// calendar), haeufigeres Polling waere reine Verschwendung. Das Ergebnis
// erzeugt das Lagebild bzw. der Push-Cron (alle 15 Min) -- 5 Min Poll hier
// reicht, um es zeitnah zu zeigen.
const REFRESH_INTERVAL_MS = 5 * 60_000;

async function fetchUpcomingEvents(): Promise<EconomicCalendarEvent[]> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("economic_calendar_events")
    .select("*")
    .gte("event_date", todayIso)
    .order("event_date", { ascending: true });

  if (error) {
    console.error("Fehler beim Laden des Wirtschaftskalenders:", error.message);
    return [];
  }
  return data ?? [];
}

// Ergebnis (KI-Einordnung der ersten Schlagzeilen, lib/economicEventResult.ts)
// fuer Termine, deren Zeitpunkt schon erreicht ist; "pending" = noch keine
// Einordnung, Termin hoechstens 6h her.
type ResultState = EconomicEventResult | "pending" | null;

async function fetchResults(events: EconomicCalendarEvent[]): Promise<Record<string, ResultState>> {
  const nowMs = Date.now();
  const due = events.filter((e) => {
    const markMs = economicEventMarkMs(e.event_key, e.event_date);
    return markMs !== null && markMs <= nowMs;
  });
  const rows = await Promise.all(
    due.map(async (e) => {
      const result = await fetchEconomicResult(e.event_key, e.event_date);
      const markMs = economicEventMarkMs(e.event_key, e.event_date) as number;
      const state: ResultState = result ?? (nowMs - markMs <= AWAITING_MAX_MS ? "pending" : null);
      return [`${e.event_key}|${e.event_date}`, state] as const;
    })
  );
  return Object.fromEntries(rows);
}

export default function EconomicCalendarPanel({
  initialEvents,
}: {
  initialEvents: EconomicCalendarEvent[];
}) {
  const [events, setEvents] = useState(initialEvents);
  const [results, setResults] = useState<Record<string, ResultState>>({});

  useEffect(() => {
    fetchResults(initialEvents).then(setResults);
    // initialEvents aendert sich nach dem ersten Render nicht mehr (kommt
    // als Server-Prop) -- bewusst nur beim Mount, der Poll unten uebernimmt
    // danach fortlaufende Aktualisierungen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const stopPolling = setVisibleInterval(async () => {
      const freshEvents = await fetchUpcomingEvents();
      setEvents(freshEvents);
      setResults(await fetchResults(freshEvents));
    }, REFRESH_INTERVAL_MS);
    return () => stopPolling();
  }, []);

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">
          Wirtschaftskalender
        </h2>
        <PanelInfo title="Wirtschaftskalender" content={economicCalendarInfo} />
      </div>

      {events.length === 0 ? (
        <p className="text-xs text-text-faint">Keine anstehenden Termine bekannt.</p>
      ) : (
        <div className="space-y-4">
          {events.map((event) => {
            const markMs = economicEventMarkMs(event.event_key, event.event_date);
            const state = results[`${event.event_key}|${event.event_date}`] ?? null;
            const awaiting = state === "pending";
            const result = state === "pending" ? null : state;
            const bias = result ? resultBiasDisplay(result.bias) : null;

            return (
              <div key={event.event_key} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <span className="text-sm text-text font-medium">{event.label}</span>
                  <span className="text-xs text-text-faint whitespace-nowrap">
                    <ShortDate iso={event.event_date} />
                    {/* Immer Schweizer Zeit (Toby 14.10.2026); typical_time_et nur,
                        wenn fuer den Termin keine feste Uhrzeit hinterlegt ist. */}
                    {markMs !== null ? <> · {formatZurichTime(markMs)}</> : event.typical_time_et ? <> · {event.typical_time_et}</> : null}
                    {" · "}
                    <DaysUntil iso={event.event_date} dateOnly />
                  </span>
                </div>
                <p className="text-xs text-text-faint mt-1">
                  {ECONOMIC_EVENT_INTERPRETATION[event.event_key] ??
                    "Keine Einordnung für dieses Ereignis hinterlegt."}
                </p>
                <p className="text-xs text-text-faint mt-1">{economicDirectionLegend(event.event_key)}</p>
                {result && bias && (
                  <p className="text-xs mt-1">
                    <span className="text-text-faint">Ergebnis: </span>
                    {bias.emoji} <span className={`${bias.colorClass} font-medium`}>{bias.label}</span>{" "}
                    <span className="text-text">{result.summary}</span>{" "}
                    <RelativeTime iso={result.created_at} className="text-text-faint" />
                  </p>
                )}
                {awaiting && <p className="text-xs mt-1 text-text-faint">Ergebnis steht noch aus.</p>}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
