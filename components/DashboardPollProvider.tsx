"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import type { DashboardPollBundle } from "@/lib/types";
import { getTimeframe, type TimeframeId } from "@/lib/timeframes";

// Phase 2, Punkt 3: buendelt die 30s-Polls von MarketContextCard,
// SpotPressurePanel und PositioningPanel (vorher zusammen 10 unabhaengige
// Einzel-Requests pro Intervall: 3x market series/reference/spot-summary,
// 2x spot-pressure summary/series, 5x positioning snapshots/signal) zu
// einem einzigen RPC-Aufruf ueber get_dashboard_poll_bundle. Ein Provider
// hoeher in der Baumstruktur besitzt den EINEN Poll-Intervall, die drei
// Panels lesen ihre jeweilige Teilmenge per Context statt selbst zu
// pollen -- ihre gesamte bestehende Ableitungslogik (Klassifizierung,
// Coverage%, etc.) bleibt unveraendert, nur die Datenquelle wechselt.
//
// LivePricePanel ist bewusst NICHT angebunden: dessen Boersen-Auswahl ist
// Nutzer-gesteuert (nicht immer DEFAULT_SERIES_EXCHANGE) und haette eine
// deutlich groessere, riskantere Restrukturierung erfordert fuer einen
// kleineren Zusatznutzen -- es pollt weiterhin unabhaengig.

const REFRESH_INTERVAL_MS = 30_000;
const SERIES_MAX_POINTS = 500;

async function fetchBundle(sinceIso: string): Promise<DashboardPollBundle | null> {
  const { data, error } = await supabase.rpc("get_dashboard_poll_bundle", {
    p_since: sinceIso,
    p_max_points: SERIES_MAX_POINTS,
  });
  if (error) {
    console.error("Fehler beim Laden des Dashboard-Poll-Bundles:", error.message);
    return null;
  }
  return (data as DashboardPollBundle | null) ?? null;
}

interface DashboardPollContextValue {
  bundle: DashboardPollBundle;
  fetchedSinceIso: string;
  fetchedAtMs: number;
  lastSyncOk: boolean;
  // Nur waehrend eines durch einen Zeitraum-Wechsel ausgeloesten Neuladens
  // true (nicht waehrend des automatischen 30s-Polls) -- entspricht dem
  // bisherigen "loading"-Verhalten von SpotPressurePanel.
  isLoading: boolean;
}

const DashboardPollContext = createContext<DashboardPollContextValue | null>(null);

export function useDashboardPoll(): DashboardPollContextValue {
  const ctx = useContext(DashboardPollContext);
  if (!ctx) {
    throw new Error(
      "useDashboardPoll() muss innerhalb von <DashboardPollProvider> aufgerufen werden."
    );
  }
  return ctx;
}

export default function DashboardPollProvider({
  timeframe,
  initialBundle,
  initialFetchedSinceIso,
  children,
}: {
  timeframe: TimeframeId;
  initialBundle: DashboardPollBundle;
  initialFetchedSinceIso: string;
  children: ReactNode;
}) {
  const [bundle, setBundle] = useState(initialBundle);
  const [fetchedSinceIso, setFetchedSinceIso] = useState(initialFetchedSinceIso);
  const [fetchedAtMs, setFetchedAtMs] = useState(() => Date.now());
  const [lastSyncOk, setLastSyncOk] = useState(true);
  const [isLoading, setIsLoading] = useState(false);
  const isFirstRun = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const tf = getTimeframe(timeframe);
    const skipImmediateLoad = isFirstRun.current;
    isFirstRun.current = false;

    const load = async (showLoading: boolean) => {
      if (showLoading) setIsLoading(true);
      const loadStartMs = Date.now();
      const sinceIso = new Date(loadStartMs - tf.minutes * 60 * 1000).toISOString();
      const result = await fetchBundle(sinceIso);
      if (cancelled) return;
      setLastSyncOk(result !== null);
      if (result) {
        setBundle(result);
        setFetchedSinceIso(sinceIso);
        setFetchedAtMs(loadStartMs);
      }
      if (showLoading) setIsLoading(false);
    };

    if (!skipImmediateLoad) load(true);
    const interval = setInterval(() => load(false), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [timeframe]);

  return (
    <DashboardPollContext.Provider
      value={{ bundle, fetchedSinceIso, fetchedAtMs, lastSyncOk, isLoading }}
    >
      {children}
    </DashboardPollContext.Provider>
  );
}
