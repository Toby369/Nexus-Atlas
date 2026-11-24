"use client";

import { useEffect, useMemo, useState } from "react";
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
import {
  fetchUsCalendarWeek,
  groupUsCalendarByDay,
  usEventInfo,
  zurichDayKey,
  type UsCalendarWeekEvent,
} from "@/lib/usCalendarWeek";

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
  const [usWeek, setUsWeek] = useState<UsCalendarWeekEvent[]>([]);
  // Zeitpunkt des letzten Ladens (fuer "heute"); nicht im Render per Date.now() lesen.
  const [usWeekNowMs, setUsWeekNowMs] = useState(0);

  useEffect(() => {
    fetchUsCalendarWeek().then((w) => {
      setUsWeek(w);
      setUsWeekNowMs(Date.now());
    });
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
      setUsWeek(await fetchUsCalendarWeek());
      setUsWeekNowMs(Date.now());
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

      <UsWeekSection events={usWeek} nowMs={usWeekNowMs} />
    </section>
  );
}

// "Diese Woche (USA)": Prognose/Vorherig je US-Termin, Erklaerung erst auf
// Klick/Tipp (Toby 24.11.2026). Zeiten in Schweizer Zeit. "Aktuell" liefert die
// Quelle nicht -- bei CPI/PCE/NFP/FOMC steht das Ergebnis oben (News-Einordnung).
function UsWeekSection({ events, nowMs }: { events: UsCalendarWeekEvent[]; nowMs: number }) {
  const [onlyHigh, setOnlyHigh] = useState(false);
  const days = useMemo(() => groupUsCalendarByDay(events, onlyHigh), [events, onlyHigh]);
  if (events.length === 0) return null;
  const todayKey = zurichDayKey(nowMs);

  return (
    <div className="mt-5 pt-4 border-t border-border/60">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <h3 className="text-xs uppercase tracking-[0.15em] text-text-muted">Diese Woche (USA)</h3>
        <div className="flex gap-1">
          {([
            [false, "Hoch + Mittel"],
            [true, "Nur hoch"],
          ] as const).map(([value, label]) => (
            <button
              key={label}
              type="button"
              onClick={() => setOnlyHigh(value)}
              aria-pressed={onlyHigh === value}
              className={`rounded px-2 py-1 text-xs min-h-8 ${
                onlyHigh === value ? "bg-text text-surface" : "bg-border/40 text-text-muted"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {days.length === 0 ? (
        <p className="text-xs text-text-faint">Keine Termine mit diesem Filter.</p>
      ) : (
        <div className="space-y-3">
          {days.map((day) => (
            <div key={day.dayKey}>
              <p className={`text-xs font-medium mb-1 ${day.dayKey === todayKey ? "text-text" : "text-text-muted"}`}>
                {new Intl.DateTimeFormat("de-CH", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  timeZone: "Europe/Zurich",
                }).format(Date.parse(day.events[0].event_time))}
                {day.dayKey === todayKey ? " · heute" : ""}
              </p>
              <div className="divide-y divide-border/60">
                {day.events.map((e) => {
                  const info = usEventInfo(e.title);
                  return (
                    <details key={`${e.event_time}|${e.title}`} className="group py-1.5">
                      <summary className="flex items-start gap-2 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                        <span className="text-xs text-text-faint tabular-nums w-12 shrink-0 pt-px">
                          {formatZurichTime(Date.parse(e.event_time)).replace(" Uhr", "")}
                        </span>
                        <span className="min-w-0 flex-1 text-sm text-text">
                          <span aria-hidden className={e.impact === "High" ? "text-down" : "text-text-faint"}>
                            ●{" "}
                          </span>
                          {info.de}
                          <span className="ml-1 text-text-faint group-open:rotate-180 inline-block transition-transform">▾</span>
                          <span className="block text-xs text-text-faint tabular-nums">
                            Prognose {e.forecast ?? "–"} · Vorherig {e.previous ?? "–"}
                          </span>
                        </span>
                      </summary>
                      <dl className="mt-2 ml-14 space-y-1.5 text-xs">
                        <div>
                          <dt className="text-text-faint uppercase tracking-wider">Was es misst</dt>
                          <dd className="text-text">{info.what}</dd>
                        </div>
                        <div>
                          <dt className="text-text-faint uppercase tracking-wider">Bullisch für BTC</dt>
                          <dd className="text-up">{info.bullish}</dd>
                        </div>
                        <div>
                          <dt className="text-text-faint uppercase tracking-wider">Bärisch für BTC</dt>
                          <dd className="text-down">{info.bearish}</dd>
                        </div>
                        <div>
                          <dt className="text-text-faint uppercase tracking-wider">Faustregel</dt>
                          <dd className="text-text-muted">{info.rule}</dd>
                        </div>
                      </dl>
                    </details>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-text-faint mt-3">
        Zeiten in Schweizer Zeit. Bullisch/bärisch gilt immer im Vergleich zur Prognose, nicht zum Vormonat –
        historische Faustregel, kein Automatismus, keine Anlageberatung. Tippe auf einen Termin für die Erklärung.
      </p>
    </div>
  );
}
