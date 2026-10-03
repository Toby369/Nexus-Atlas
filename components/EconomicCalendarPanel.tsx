"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { EconomicCalendarEvent } from "@/lib/types";
import PanelInfo from "@/components/PanelInfo";
import { economicCalendarInfo } from "@/lib/panelInfo";
import {
  ECONOMIC_EVENT_INTERPRETATION,
  EVENT_FRED_SYMBOL,
  economicDirectionLegend,
  economicDirectionMeaning,
} from "@/lib/economicCalendar";
import { ShortDate, DaysUntil, FullDateTime } from "@/components/ClientTimestamp";

// Kalendertermine aendern sich selten und fast immer mit Vorlauf -- deutlich
// laengeres Poll-Intervall als bei den uebrigen, minuetlich schwankenden
// Kacheln (vgl. REFRESH_INTERVAL_MS in LivePricePanel.tsx: 30s). Der
// Collector selbst laeuft ohnehin nur 1x taeglich (siehe collect-economic-
// calendar), haeufigeres Polling waere reine Verschwendung. macro_snapshots
// (fuer das Ergebnis, siehe fetchLatestMacroValue unten) wird von collect-
// macro alle 30 Min aktualisiert -- 10 Min Poll hier reicht, um ein frisch
// veroeffentlichtes Ergebnis zeitnah zu zeigen, ohne zu haeufig abzufragen.
const REFRESH_INTERVAL_MS = 10 * 60_000;

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

// Letzter bekannter Wert je FRED-Serie aus macro_snapshots (collect-macro) --
// dieselbe Tabelle/Quelle wie die Edge Function send-state-change-push fuer
// die "Resultat"-Push-Benachrichtigung nutzt, hier nur fuer die Anzeige
// gelesen (Nutzer-Wunsch 03.10.2026: "wenn Resultat vorhanden ist, dies
// ebenfalls anzeigen"). Bewusst der zuletzt bekannte Wert OHNE die Pruefung
// "ist das neuer als der Termin", die die Push-Funktion macht -- hier reicht
// die Anzeige des Datums (Stand), der Nutzer sieht selbst, ob es frisch ist.
interface MacroSnapshotLite {
  last_price: number | null;
  prev_close: number | null;
  timestamp_utc: string;
}

async function fetchLatestMacroValue(symbol: string): Promise<MacroSnapshotLite | null> {
  const { data, error } = await supabase
    .from("macro_snapshots")
    .select("last_price, prev_close, timestamp_utc")
    .eq("symbol", symbol)
    .eq("status", "ok")
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error(`Fehler beim Laden des Wirtschaftsdaten-Ergebnisses (${symbol}):`, error.message);
    return null;
  }
  return data;
}

async function fetchLatestMacroValues(eventKeys: string[]): Promise<Record<string, MacroSnapshotLite | null>> {
  const uniqueKeys = Array.from(new Set(eventKeys)).filter((k) => EVENT_FRED_SYMBOL[k]);
  const rows = await Promise.all(
    uniqueKeys.map(async (key) => [key, await fetchLatestMacroValue(EVENT_FRED_SYMBOL[key])] as const)
  );
  return Object.fromEntries(rows);
}

function fmtMacroValue(v: number): string {
  return Math.abs(v) >= 100 ? v.toFixed(1) : v.toFixed(2);
}

export default function EconomicCalendarPanel({
  initialEvents,
}: {
  initialEvents: EconomicCalendarEvent[];
}) {
  const [events, setEvents] = useState(initialEvents);
  const [macroValues, setMacroValues] = useState<Record<string, MacroSnapshotLite | null>>({});

  useEffect(() => {
    fetchLatestMacroValues(initialEvents.map((e) => e.event_key)).then(setMacroValues);
    // initialEvents aendert sich nach dem ersten Render nicht mehr (kommt
    // als Server-Prop) -- bewusst nur beim Mount, der Poll unten uebernimmt
    // danach fortlaufende Aktualisierungen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      const freshEvents = await fetchUpcomingEvents();
      setEvents(freshEvents);
      setMacroValues(await fetchLatestMacroValues(freshEvents.map((e) => e.event_key)));
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
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
            const macro = macroValues[event.event_key];
            const lastPrice = macro?.last_price !== null && macro?.last_price !== undefined ? Number(macro.last_price) : null;
            const prevClose = macro?.prev_close !== null && macro?.prev_close !== undefined ? Number(macro.prev_close) : null;
            const direction = prevClose === null || lastPrice === null ? null : lastPrice > prevClose ? "up" : lastPrice < prevClose ? "down" : "flat";
            const resultMeaning = direction ? economicDirectionMeaning(event.event_key, direction) : null;

            return (
              <div key={event.event_key} className="border-b border-border/60 pb-3 last:border-0 last:pb-0">
                <div className="flex items-baseline justify-between gap-2 flex-wrap">
                  <span className="text-sm text-text font-medium">{event.label}</span>
                  <span className="text-xs text-text-faint whitespace-nowrap">
                    <ShortDate iso={event.event_date} />
                    {event.typical_time_et && <> · {event.typical_time_et}</>}
                    {" · "}
                    <DaysUntil iso={event.event_date} dateOnly />
                  </span>
                </div>
                <p className="text-xs text-text-faint mt-1">
                  {ECONOMIC_EVENT_INTERPRETATION[event.event_key] ??
                    "Keine Einordnung für dieses Ereignis hinterlegt."}
                </p>
                <p className="text-xs text-text-faint mt-1">{economicDirectionLegend(event.event_key)}</p>
                {resultMeaning && lastPrice !== null && (
                  <p className="text-xs mt-1">
                    <span className="text-text-faint">Letzter bekannter Wert: </span>
                    <span className="text-text font-medium">
                      {fmtMacroValue(lastPrice)}
                      {prevClose !== null && <span className="text-text-faint"> (vorher {fmtMacroValue(prevClose)})</span>}
                    </span>{" "}
                    <span>{resultMeaning.arrow} {resultMeaning.emoji}</span>{" "}
                    <span className={resultMeaning.meaning === "bärisch" ? "text-down" : resultMeaning.meaning === "bullisch" ? "text-up" : "text-text-faint"}>
                      {resultMeaning.meaning}
                    </span>{" "}
                    <span className="text-text-faint">
                      für BTC, Stand <FullDateTime iso={macro!.timestamp_utc} />
                    </span>
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
