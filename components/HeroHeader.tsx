"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { MarketRegime, MarketState } from "@/lib/types";
import { classifySpotPressure } from "@/lib/spotPressure";
import { getTimeframe, type TimeframeId } from "@/lib/timeframes";
import {
  isDirectionalLabelSuppressed,
  UNCLEAR_STATE_LABEL,
  buildCompactMarketStateSummary,
} from "@/lib/marketStateSummary";
import {
  regimeDirection,
  spotPressureDirection,
  summarizeConfirmation,
  type ConfirmationSignal,
} from "@/lib/heroSummary";
import { useDashboardPoll } from "@/components/DashboardPollProvider";
import { RelativeTime } from "@/components/ClientTimestamp";

// Ebene 0/1 der neuen Dashboard-Hierarchie (Nutzer-Feedback vom
// 31.08.2026, "Grundidee: kompakte App mit einem Hinweis, wohin der Kurs
// geht"). Reine Zusammenfassung bereits vorhandener Werte -- kein neuer
// Rechenweg, keine Aenderung an compute-market-state oder den einzelnen
// Kacheln (siehe lib/heroSummary.ts fuer die bewusst blend-freie
// Bestaetigungs-Logik).

const MARKET_STATE_REFRESH_MS = 60_000;
// Regime aendert sich hoechstens stuendlich (1H-Kerzen-Raster, siehe
// RegimeMatrixCard.tsx) -- gleicher Poll-Takt wie dort, damit Hero und
// Regime-Matrix-Kachel nie unterschiedliche Werte zeigen.
const REGIME_REFRESH_MS = 5 * 60_000;

const STATE_LABELS: Record<string, string> = {
  BULLISH: "Bullish",
  BEARISH: "Bearish",
  NEUTRAL: "Neutral",
  MIXED: "Gemischt",
  INSUFFICIENT_DATA: "Unzureichende Daten",
};

async function fetchLatestState(): Promise<MarketState | null> {
  const { data, error } = await supabase
    .from("market_states")
    .select("*")
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Fehler beim Laden des Market State (Hero):", error.message);
    return null;
  }
  return data;
}

async function fetchLatestRegime(): Promise<MarketRegime | null> {
  const { data, error } = await supabase
    .from("market_state_matrix")
    .select("regime")
    .order("timestamp_utc", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("Fehler beim Laden des Regimes (Hero):", error.message);
    return null;
  }
  return data?.regime ?? null;
}

export default function HeroHeader({
  initialState,
  initialRegime,
  timeframe,
}: {
  initialState: MarketState | null;
  initialRegime: MarketRegime | null;
  timeframe: TimeframeId;
}) {
  const [state, setState] = useState(initialState);
  const [regime, setRegime] = useState(initialRegime);
  const { bundle } = useDashboardPoll();

  useEffect(() => {
    const interval = setInterval(async () => {
      const data = await fetchLatestState();
      if (data) setState(data);
    }, MARKET_STATE_REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const interval = setInterval(async () => {
      const data = await fetchLatestRegime();
      setRegime(data);
    }, REGIME_REFRESH_MS);
    return () => clearInterval(interval);
  }, []);

  if (!state) {
    return (
      <section className="rounded-lg border border-accent/25 bg-surface-raised p-5">
        <p className="text-sm text-text-faint">Noch keine Market-State-Daten vorhanden.</p>
      </section>
    );
  }

  const suppressed = isDirectionalLabelSuppressed(state);
  const displayLabel = suppressed
    ? UNCLEAR_STATE_LABEL
    : STATE_LABELS[state.overall_state] ?? state.overall_state;
  const badgeColor = suppressed
    ? "text-text-faint"
    : state.overall_state === "BULLISH"
      ? "text-up"
      : state.overall_state === "BEARISH"
        ? "text-down"
        : "text-text";

  // Spot-Pressure-Verdikt aus demselben geteilten Poll-Bundle wie
  // MarketContextCard/SpotPressurePanel (dieselbe Formel, dieselbe
  // Datenquelle -- kein separater Fetch, kein neuer Rechenweg).
  const selectedTf = getTimeframe(timeframe);
  const summary = bundle.spot_summary;
  const sumBuy = summary?.sum_taker_buy_vol ?? null;
  const sumSell = summary?.sum_taker_sell_vol ?? null;
  const totalVol = sumBuy !== null && sumSell !== null ? sumBuy + sumSell : null;
  const netFlowPct =
    totalVol !== null && totalVol > 0 && sumBuy !== null && sumSell !== null
      ? ((sumBuy - sumSell) / totalVol) * 100
      : null;
  const expectedCandles = Math.max(1, Math.round(selectedTf.minutes / 5));
  const candleCount = summary?.candle_count ?? 0;
  const spotVerdict = classifySpotPressure({ netFlowPct, candleCount, expectedCandles });

  const signals: ConfirmationSignal[] = [
    { name: "Marktphase", direction: regimeDirection(regime) },
    { name: "Spot Pressure", direction: spotPressureDirection(spotVerdict.verdict) },
  ];
  const confirmation = summarizeConfirmation(state.overall_state, state.confidence, signals);

  return (
    <section className="rounded-lg border border-accent/40 bg-surface-raised p-6 space-y-3">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <p className={`text-3xl sm:text-4xl font-bold ${badgeColor}`}>{displayLabel}</p>
        <RelativeTime iso={state.timestamp_utc} className="text-xs text-text-faint" />
      </div>

      <div className="flex gap-4 text-xs text-text-faint flex-wrap">
        <span>Confidence: {Math.round(state.confidence)}/100</span>
      </div>

      <p className="text-sm text-text-muted leading-relaxed">
        {buildCompactMarketStateSummary(state)}
      </p>

      {confirmation.primaryDirection && confirmation.totalComparable > 0 && (
        <p className="text-xs text-text-faint pt-2 border-t border-border/60">
          {confirmation.confirmingCount} von {confirmation.totalComparable} unabhängigen
          Signalen bestätigen
          {confirmation.confirming.length > 0 && ` (${confirmation.confirming.join(", ")})`}
          {confirmation.contradicting.length > 0 &&
            ` · widerspricht: ${confirmation.contradicting.join(", ")}`}
        </p>
      )}
    </section>
  );
}
