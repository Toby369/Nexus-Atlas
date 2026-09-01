"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { EconomicCalendarEvent } from "@/lib/types";
import PanelInfo from "@/components/PanelInfo";
import { economicCalendarInfo } from "@/lib/panelInfo";
import { ECONOMIC_EVENT_INTERPRETATION } from "@/lib/economicCalendar";
import { ShortDate, DaysUntil } from "@/components/ClientTimestamp";

// Kalendertermine aendern sich selten und fast immer mit Vorlauf -- deutlich
// laengeres Poll-Intervall als bei den uebrigen, minuetlich schwankenden
// Kacheln (vgl. REFRESH_INTERVAL_MS in LivePricePanel.tsx: 30s). Der
// Collector selbst laeuft ohnehin nur 1x taeglich (siehe collect-economic-
// calendar), haeufigeres Polling waere reine Verschwendung.
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

export default function EconomicCalendarPanel({
  initialEvents,
}: {
  initialEvents: EconomicCalendarEvent[];
}) {
  const [events, setEvents] = useState(initialEvents);

  useEffect(() => {
    const interval = setInterval(async () => {
      setEvents(await fetchUpcomingEvents());
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
          {events.map((event) => (
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
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
