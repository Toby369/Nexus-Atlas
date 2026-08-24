"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { LiquidationEvent } from "@/lib/types";

const REFRESH_INTERVAL_MS = 60_000;
const LOOKBACK_HOURS = 6;
const EVENT_LIMIT = 300;
const CASCADE_WINDOW_MS = 2 * 60_000;
const CASCADE_MIN_COUNT = 3;

function formatUsd(value: number) {
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toFixed(0)}`;
}

// Cascade-Heuristik: mehrere Liquidationen innerhalb eines kurzen Zeitfensters
// deuten eher auf eine Kettenreaktion hin als vereinzelte Events.
function hasCascade(events: LiquidationEvent[]): boolean {
  const times = events
    .map((e) => new Date(e.event_time_utc).getTime())
    .sort((a, b) => a - b);

  for (let i = 0; i < times.length; i++) {
    let count = 1;
    for (
      let j = i + 1;
      j < times.length && times[j] - times[i] <= CASCADE_WINDOW_MS;
      j++
    ) {
      count++;
    }
    if (count >= CASCADE_MIN_COUNT) return true;
  }
  return false;
}

async function fetchRecentLiquidations(): Promise<{
  data: LiquidationEvent[];
  ok: boolean;
}> {
  const cutoff = new Date(
    Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000
  ).toISOString();

  const { data, error } = await supabase
    .from("liquidation_events")
    .select("*")
    .eq("status", "ok")
    .gte("event_time_utc", cutoff)
    .order("event_time_utc", { ascending: false })
    .limit(EVENT_LIMIT);

  if (error) {
    console.error("Fehler beim Laden der Liquidationen:", error.message);
    return { data: [], ok: false };
  }
  return { data: data ?? [], ok: true };
}

export default function LiquidationPanel({
  initialEvents,
}: {
  initialEvents: LiquidationEvent[];
}) {
  const [events, setEvents] = useState(initialEvents);
  const [lastSyncOk, setLastSyncOk] = useState(true);

  useEffect(() => {
    const interval = setInterval(async () => {
      const { data, ok } = await fetchRecentLiquidations();
      setLastSyncOk(ok);
      if (ok) setEvents(data);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);

  const longNotional = events
    .filter((e) => e.side === "long")
    .reduce((sum, e) => sum + (e.notional_usd ?? 0), 0);
  const shortNotional = events
    .filter((e) => e.side === "short")
    .reduce((sum, e) => sum + (e.notional_usd ?? 0), 0);
  const totalNotional = longNotional + shortNotional;
  const longPct = totalNotional > 0 ? (longNotional / totalNotional) * 100 : 0;
  const cascade = hasCascade(events);

  return (
    <div className="rounded-lg border border-border bg-surface p-5 space-y-3">
      <p className="text-xs uppercase tracking-[0.15em] text-text-muted">
        Liquidationen
      </p>

      {!lastSyncOk && events.length > 0 && (
        <p className="text-xs text-down">
          Sync-Problem — zuletzt bekannte Liquidationen werden angezeigt.
        </p>
      )}

      {events.length === 0 ? (
        <p className="text-sm text-text-faint">
          {lastSyncOk
            ? `Keine erfassten Liquidationen in den letzten ${LOOKBACK_HOURS}h.`
            : "Sync-Problem — Liquidationen derzeit nicht verfügbar."}
        </p>
      ) : (
        <>
          <div className="flex items-baseline justify-between">
            <span className="tabular font-mono text-2xl font-semibold text-text">
              {formatUsd(totalNotional)}
            </span>
            <span className="text-xs text-text-faint">
              {events.length} Events · letzte {LOOKBACK_HOURS}h
            </span>
          </div>

          <div>
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="text-text-muted">
                Long liquidiert · Short liquidiert
              </span>
              <span className="tabular font-mono text-text-faint">
                {formatUsd(longNotional)} · {formatUsd(shortNotional)}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-up/40 overflow-hidden relative">
              <div
                className="h-full bg-down"
                style={{ width: `${longPct}%` }}
              />
            </div>
          </div>

          <p className="text-xs text-text-muted">
            {cascade
              ? "Häufung erkannt — mehrere Liquidationen kurz hintereinander (mögliche Cascade)."
              : "Vereinzelte Liquidationen, keine auffällige Häufung."}
          </p>
        </>
      )}

      <p className="text-xs text-text-faint pt-1">
        Stichprobenerfassung (~25s alle 5 Min je Börse, Binance + Bybit) —
        keine lückenlose Erfassung, kein Handelssignal.
      </p>
    </div>
  );
}
