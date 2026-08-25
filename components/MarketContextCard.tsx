"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { MarketSeriesPoint, SpotPressureSummary } from "@/lib/types";
import { DEFAULT_TIMEFRAME, getTimeframe } from "@/lib/timeframes";
import { DEFAULT_SERIES_EXCHANGE } from "@/lib/exchanges";
import { classifyMarketContext } from "@/lib/marketContext";

const REFRESH_INTERVAL_MS = 30_000;
const SERIES_MAX_POINTS = 500;
// Bewusst fest auf den Standard-Zeitraum (4H), unabhaengig von den Selectors
// in LivePricePanel/SpotPressurePanel -- der Marktkontext braucht ein
// konsistentes, nicht vom Nutzer verschiebbares Fenster, sonst waeren
// Preis-, OI- und Spot-Flow-Werte nicht mehr vergleichbar.
const CONTEXT_TIMEFRAME = DEFAULT_TIMEFRAME;
const COMPLETENESS_WARN_THRESHOLD = 0.8;

interface ReferenceSnapshot {
  timestamp_utc: string;
  last_price: number | null;
  open_interest: number | null;
}

function formatSignedPct(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

async function fetchOiSeries(sinceIso: string): Promise<MarketSeriesPoint[]> {
  const { data, error } = await supabase.rpc("get_market_series", {
    p_exchange: DEFAULT_SERIES_EXCHANGE,
    p_since: sinceIso,
    p_max_points: SERIES_MAX_POINTS,
  });
  if (error) {
    console.error("Fehler beim Laden der Marktkontext-OI-Zeitreihe:", error.message);
    return [];
  }
  return data ?? [];
}

async function fetchOiReference(sinceIso: string): Promise<ReferenceSnapshot | null> {
  const { data, error } = await supabase.rpc("get_market_reference_snapshot", {
    p_exchange: DEFAULT_SERIES_EXCHANGE,
    p_cutoff: sinceIso,
  });
  if (error) {
    console.error("Fehler beim Laden des Marktkontext-Referenzpunkts:", error.message);
    return null;
  }
  return data?.[0] ?? null;
}

async function fetchSpotSummary(sinceIso: string): Promise<SpotPressureSummary | null> {
  const { data, error } = await supabase.rpc("get_spot_pressure_summary", {
    p_since: sinceIso,
  });
  if (error) {
    console.error("Fehler beim Laden der Marktkontext-Spot-Summary:", error.message);
    return null;
  }
  return data?.[0] ?? null;
}

export default function MarketContextCard({
  initialOiSeries,
  initialOiReference,
  initialSpotSummary,
}: {
  initialOiSeries: MarketSeriesPoint[];
  initialOiReference: ReferenceSnapshot | null;
  initialSpotSummary: SpotPressureSummary | null;
}) {
  const [oiSeries, setOiSeries] = useState(initialOiSeries);
  const [oiReference, setOiReference] = useState(initialOiReference);
  const [spotSummary, setSpotSummary] = useState(initialSpotSummary);

  // Kein sofortiger Fetch beim Mount -- der Server hat den Standard-Zeitraum
  // bereits geladen (initial*-Props), nur der 30s-Poll aktualisiert danach.
  useEffect(() => {
    let cancelled = false;
    const tf = getTimeframe(CONTEXT_TIMEFRAME);

    const load = async () => {
      const sinceIso = new Date(Date.now() - tf.minutes * 60 * 1000).toISOString();
      const [series, reference, spot] = await Promise.all([
        fetchOiSeries(sinceIso),
        fetchOiReference(sinceIso),
        fetchSpotSummary(sinceIso),
      ]);
      if (cancelled) return;
      setOiSeries(series);
      setOiReference(reference);
      setSpotSummary(spot);
    };

    const interval = setInterval(load, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const tf = getTimeframe(CONTEXT_TIMEFRAME);

  const latestOiPoint = oiSeries.length > 0 ? oiSeries[oiSeries.length - 1] : null;
  const oiChangePct =
    latestOiPoint?.open_interest !== null &&
    latestOiPoint?.open_interest !== undefined &&
    oiReference?.open_interest !== null &&
    oiReference?.open_interest !== undefined
      ? ((latestOiPoint.open_interest - oiReference.open_interest) /
          oiReference.open_interest) *
        100
      : null;

  const priceChangePct =
    latestOiPoint?.last_price !== null &&
    latestOiPoint?.last_price !== undefined &&
    oiReference?.last_price !== null &&
    oiReference?.last_price !== undefined
      ? ((latestOiPoint.last_price - oiReference.last_price) / oiReference.last_price) * 100
      : null;

  const sumBuy = spotSummary?.sum_taker_buy_vol ?? null;
  const sumSell = spotSummary?.sum_taker_sell_vol ?? null;
  const totalVol = sumBuy !== null && sumSell !== null ? sumBuy + sumSell : null;
  const spotNetFlowPct =
    totalVol !== null && totalVol > 0 && sumBuy !== null && sumSell !== null
      ? ((sumBuy - sumSell) / totalVol) * 100
      : null;

  const expectedSpotCandles = Math.max(1, Math.round(tf.minutes / 5));
  const spotCandleCount = spotSummary?.candle_count ?? 0;
  const spotIncomplete =
    spotSummary !== null && spotCandleCount / expectedSpotCandles < COMPLETENESS_WARN_THRESHOLD;

  const result = classifyMarketContext({ priceChangePct, oiChangePct, spotNetFlowPct });

  // Farbe zeigt die Richtung des Szenarios (bullisch/baerisch), nicht ob der
  // Spot-Markt es bestaetigt -- ein bestaetigter Short-Aufbau ist trotzdem
  // baerisch, nicht gruen. "confirmed" steht bereits im Label-Text.
  const badgeColor =
    result.bias === "bullish"
      ? "text-up"
      : result.bias === "bearish"
      ? "text-down"
      : "text-text";

  return (
    <div className="rounded-lg border border-accent/25 bg-surface-raised p-5">
      <p className="text-xs uppercase tracking-[0.15em] text-text-muted mb-2">
        Marktkontext (regelbasiert) · {tf.label}
      </p>

      {result.scenario === null ? (
        <p className="text-sm text-text-muted">{result.explanation}</p>
      ) : (
        <>
          <p className={`text-xl sm:text-2xl font-semibold ${badgeColor}`}>{result.label}</p>
          <p className="text-sm text-text-muted mt-2 leading-relaxed">{result.explanation}</p>
          <div className="flex gap-4 mt-3 text-xs text-text-faint flex-wrap">
            <span>Preis {formatSignedPct(priceChangePct)}</span>
            <span>OI {formatSignedPct(oiChangePct)}</span>
            <span>Spot-Flow {formatSignedPct(spotNetFlowPct)}</span>
          </div>
          {spotIncomplete && (
            <p className="text-xs text-text-faint mt-2">
              Spot-Datenbasis für {tf.label} noch unvollständig ({spotCandleCount}/
              {expectedSpotCandles} Kerzen) — Spot-Flow-Einordnung entsprechend
              vorläufig.
            </p>
          )}
        </>
      )}

      <p className="text-xs text-text-faint mt-3">
        Regelbasierte Einordnung aus Preis-, OI- (aggregiert) und Spot-Flow-Richtung
        über {tf.label} — keine KI, keine Anlageberatung. Schwellenwerte sind
        bewusst konservativ gewählt.
      </p>
    </div>
  );
}
