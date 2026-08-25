"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { SpotPressurePoint, SpotPressureSummary } from "@/lib/types";
import SpotPressureChart from "@/components/SpotPressureChart";
import {
  SPOT_TIMEFRAMES,
  DEFAULT_SPOT_TIMEFRAME,
  getTimeframe,
  type TimeframeId,
} from "@/lib/timeframes";

const REFRESH_INTERVAL_MS = 30_000;
const SERIES_MAX_POINTS = 300;
// Sample gilt als "unvollstaendig", wenn weniger als 80% der im Fenster
// erwarteten 5-Min-Kerzen tatsaechlich vorliegen (Luecken durch Collector-
// Ausfaelle oder, aktuell, den frischen Produktivstart) -- Transparenz statt
// stillschweigend mit weniger Daten zu rechnen.
const COMPLETENESS_WARN_THRESHOLD = 0.8;

function formatBtc(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toLocaleString("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatSignedPct(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

async function fetchSummary(sinceIso: string): Promise<SpotPressureSummary | null> {
  const { data, error } = await supabase.rpc("get_spot_pressure_summary", {
    p_since: sinceIso,
  });
  if (error) {
    console.error("Fehler beim Laden der Spot-Pressure-Summary:", error.message);
    return null;
  }
  return data?.[0] ?? null;
}

async function fetchSeries(sinceIso: string): Promise<SpotPressurePoint[]> {
  const { data, error } = await supabase.rpc("get_spot_pressure_series", {
    p_since: sinceIso,
    p_max_points: SERIES_MAX_POINTS,
  });
  if (error) {
    console.error("Fehler beim Laden der Spot-Pressure-Zeitreihe:", error.message);
    return [];
  }
  return data ?? [];
}

export default function SpotPressurePanel({
  initialSummary,
  initialSeries,
}: {
  initialSummary: SpotPressureSummary | null;
  initialSeries: SpotPressurePoint[];
}) {
  const [timeframe, setTimeframe] = useState<TimeframeId>(DEFAULT_SPOT_TIMEFRAME);
  const [summary, setSummary] = useState(initialSummary);
  const [series, setSeries] = useState(initialSeries);
  const [loading, setLoading] = useState(false);
  const isFirstRun = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const tf = getTimeframe(timeframe);
    const skipImmediateLoad =
      isFirstRun.current && timeframe === DEFAULT_SPOT_TIMEFRAME;
    isFirstRun.current = false;

    const load = async (showLoading: boolean) => {
      if (showLoading) setLoading(true);
      const sinceIso = new Date(Date.now() - tf.minutes * 60 * 1000).toISOString();
      const [summaryRes, seriesRes] = await Promise.all([
        fetchSummary(sinceIso),
        fetchSeries(sinceIso),
      ]);
      if (cancelled) return;
      setSummary(summaryRes);
      setSeries(seriesRes);
      setLoading(false);
    };

    if (!skipImmediateLoad) load(true);
    const interval = setInterval(() => load(false), REFRESH_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [timeframe]);

  const selectedTf = getTimeframe(timeframe);

  const sumBuy = summary?.sum_taker_buy_vol ?? null;
  const sumSell = summary?.sum_taker_sell_vol ?? null;
  const totalVol = sumBuy !== null && sumSell !== null ? sumBuy + sumSell : null;
  const netFlowPct =
    totalVol !== null && totalVol > 0 && sumBuy !== null && sumSell !== null
      ? ((sumBuy - sumSell) / totalVol) * 100
      : null;

  const priceChangePct =
    summary?.first_price !== null &&
    summary?.first_price !== undefined &&
    summary?.last_price !== null &&
    summary?.last_price !== undefined
      ? ((summary.last_price - summary.first_price) / summary.first_price) * 100
      : null;

  const expectedCandles = Math.max(1, Math.round(selectedTf.minutes / 5));
  const candleCount = summary?.candle_count ?? 0;
  const isIncomplete = candleCount / expectedCandles < COMPLETENESS_WARN_THRESHOLD;

  return (
    <div className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <p className="text-xs uppercase tracking-[0.15em] text-text-muted">
          Spot Pressure
        </p>
        <div className="flex gap-1">
          {SPOT_TIMEFRAMES.map((tf) => (
            <button
              key={tf.id}
              type="button"
              onClick={() => setTimeframe(tf.id)}
              className={`px-2 py-1 text-xs rounded-md border transition-colors ${
                timeframe === tf.id
                  ? "border-accent/40 bg-accent/15 text-accent"
                  : "border-transparent text-text-faint hover:text-text-muted"
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {!summary || candleCount === 0 ? (
        <p className="text-sm text-text-muted">
          Noch keine Spot-Kerzen fuer diesen Zeitraum erfasst — der Collector
          sammelt alle 5 Minuten eine neue Kerze, schau in Kürze wieder vorbei.
        </p>
      ) : (
        <>
          <div className="flex items-end gap-6 flex-wrap mb-1">
            <div>
              <span
                className={`tabular font-mono text-3xl sm:text-4xl font-semibold ${
                  netFlowPct === null
                    ? "text-text-faint"
                    : netFlowPct >= 0
                    ? "text-up"
                    : "text-down"
                }`}
              >
                {formatSignedPct(netFlowPct)}
              </span>
              <p className="text-xs text-text-faint mt-1">
                Netto Taker-Flow · {selectedTf.label}
              </p>
            </div>
            <div>
              <span
                className={`tabular font-mono text-lg font-medium ${
                  priceChangePct === null
                    ? "text-text-faint"
                    : priceChangePct >= 0
                    ? "text-up"
                    : "text-down"
                }`}
              >
                {formatSignedPct(priceChangePct)}
              </span>
              <p className="text-xs text-text-faint mt-1">
                BTC Preis (Spot) · {selectedTf.label}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3 mt-4">
            <div>
              <p className="tabular font-mono text-sm text-up">
                {formatBtc(sumBuy)} BTC
              </p>
              <p className="text-xs text-text-faint mt-0.5">Taker Buy</p>
            </div>
            <div>
              <p className="tabular font-mono text-sm text-down">
                {formatBtc(sumSell)} BTC
              </p>
              <p className="text-xs text-text-faint mt-0.5">Taker Sell</p>
            </div>
            <div>
              <p className="tabular font-mono text-sm text-text">
                {candleCount} / {expectedCandles}
              </p>
              <p className="text-xs text-text-faint mt-0.5">Kerzen im Fenster</p>
            </div>
          </div>

          {isIncomplete && (
            <p className="text-xs text-text-faint mt-3">
              Datenbasis unvollstaendig fuer {selectedTf.label} — nur {candleCount}{" "}
              von {expectedCandles} erwarteten 5-Min-Kerzen vorhanden (Collector
              erst seit Kurzem aktiv oder Datenluecke). Werte oben basieren nur
              auf den tatsaechlich vorhandenen Kerzen.
            </p>
          )}

          <div className="mt-4 pt-4 border-t border-border">
            {loading ? (
              <div className="h-[140px] flex items-center justify-center text-xs text-text-faint">
                Lade Zeitreihe…
              </div>
            ) : (
              <SpotPressureChart data={series} />
            )}
          </div>
        </>
      )}

      <p className="text-xs text-text-faint mt-3">
        Quelle: Binance Spot BTC/USDT, 5-Min-Kerzen — einzige oeffentliche
        Route mit echtem Taker-Buy/Sell-Split, keine Schaetzung. Zeigt nur den
        Spot-Markt; ein Abgleich mit dem Futures-Markt (Positionierung, OI)
        folgt in einer spaeteren Erweiterung.
      </p>
    </div>
  );
}
