"use client";

import { useEffect, useState } from "react";
import PanelInfo from "@/components/PanelInfo";
import TimeSeriesChart from "@/components/TimeSeriesChart";
import CvdComparisonChart from "@/components/CvdComparisonChart";
import { supabase } from "@/lib/supabase";
import { clockTimeLabel } from "@/lib/livePriceFormat";
import { coinbasePremiumInfo, spotPerpFlowInfo } from "@/lib/panelInfo";
import type { SpotPressurePoint } from "@/lib/types";
import {
  buildCvdComparison,
  compareSpotPerpFlow,
  perpIntervalFor,
  type FlowDirection,
  type PerpCandleRow,
  type PerpFlowPoint,
  type SpotPerpTone,
} from "@/lib/spotPerpFlow";
import type { PremiumLevel, PremiumSummary } from "@/lib/coinbasePremium";
import { setVisibleInterval } from "@/lib/visibleInterval";

// Aufklapper in der Marktkontext-Kachel: wer traegt die Bewegung (Spot oder
// Perp) und kaufen die US-Institutionen (Coinbase-Premium)? Bewusst keine
// eigene Kachel, sondern Detail zum Marktkontext, der Spot-Flow bereits als
// Input nutzt.

const PERP_REFRESH_MS = 60_000;
const PREMIUM_REFRESH_MS = 5 * 60_000;

const TONE_STYLES: Record<SpotPerpTone, string> = {
  bullish: "text-up",
  bearish: "text-down",
  watch: "text-accent",
  neutral: "text-text",
};

const PREMIUM_STYLES: Record<PremiumLevel, string> = {
  strong_buying: "text-up",
  buying: "text-up",
  neutral: "text-text",
  selling: "text-down",
  strong_selling: "text-down",
};

const DIRECTION_LABEL: Record<FlowDirection, string> = { up: "kauft", flat: "flach", down: "verkauft" };

function formatSigned(value: number | null, digits: number) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)} %`;
}

type PerpRowWithTime = PerpCandleRow & { open_time: string };

async function fetchPerpRows(sinceIso: string, interval: string): Promise<PerpRowWithTime[]> {
  const { data, error } = await supabase
    .from("candles")
    .select("open_time, volume, taker_buy_base_vol")
    .eq("exchange", "binance")
    .eq("symbol", "BTCUSDT")
    .eq("interval", interval)
    .gte("open_time", sinceIso)
    .order("open_time", { ascending: true })
    .limit(1000);
  if (error) {
    console.error("SpotPerpFlowPanel: Fehler beim Laden der Perp-Kerzen:", error.message);
    return [];
  }
  return (data ?? []).map((r) => ({
    open_time: r.open_time as string,
    volume: Number(r.volume),
    taker_buy_base_vol: r.taker_buy_base_vol === null ? null : Number(r.taker_buy_base_vol),
  }));
}

interface PremiumResponse {
  success: boolean;
  summary?: PremiumSummary;
  series?: { t: string; v: number }[];
  error?: string;
}

export function useSpotPerpSummary({
  sinceIso,
  windowMinutes,
  spotBuy,
  spotSell,
}: {
  sinceIso: string;
  windowMinutes: number;
  spotBuy: number | null;
  spotSell: number | null;
}) {
  const { interval, minutes } = perpIntervalFor(windowMinutes);
  const [perpRows, setPerpRows] = useState<PerpRowWithTime[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const rows = await fetchPerpRows(sinceIso, interval);
      if (!cancelled) setPerpRows(rows);
    }
    load();
    const stopPolling = setVisibleInterval(load, PERP_REFRESH_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, [sinceIso, interval]);

  const result = compareSpotPerpFlow({
    spotBuy,
    spotSell,
    perpRows: perpRows ?? [],
    expectedPerpCandles: Math.max(1, Math.floor(windowMinutes / minutes)),
  });
  const perpPoints: PerpFlowPoint[] = (perpRows ?? []).map((r) => ({
    t: new Date(r.open_time).getTime(),
    volume: r.volume,
    takerBuy: r.taker_buy_base_vol,
  }));
  // Spot-Kerzen sind 5-Minuten-Kerzen -- feiner zu buendeln waere nur Treppe.
  const bucketMinutes = Math.max(minutes, 5);
  return { result, perpPoints, bucketMinutes, loading: perpRows === null };
}

export default function SpotPerpFlowPanel({
  tfLabel,
  result,
  loading,
  spotSeries,
  perpPoints,
  bucketMinutes,
}: {
  tfLabel: string;
  result: ReturnType<typeof compareSpotPerpFlow>;
  loading: boolean;
  spotSeries: SpotPressurePoint[];
  perpPoints: PerpFlowPoint[];
  bucketMinutes: number;
}) {
  const [premium, setPremium] = useState<PremiumResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/coinbase-premium");
        const json = (await res.json()) as PremiumResponse;
        if (!cancelled) setPremium(json);
      } catch (err) {
        if (!cancelled) setPremium({ success: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    load();
    const stopPolling = setVisibleInterval(load, PREMIUM_REFRESH_MS);
    return () => {
      cancelled = true;
      stopPolling();
    };
  }, []);

  const summary = premium?.success ? premium.summary : undefined;
  const cvdPoints = buildCvdComparison(
    spotSeries.map((p) => ({ t: new Date(p.timestamp_utc).getTime(), buy: p.taker_buy_vol, sell: p.taker_sell_vol })),
    perpPoints,
    bucketMinutes * 60_000
  );

  return (
    <div className="mt-3 space-y-4">
      <div>
        <span className="flex items-center gap-1.5 mb-2">
          <span className="text-[11px] uppercase tracking-[0.12em] text-text-faint">Spot gegen Perp · {tfLabel}</span>
          <PanelInfo title="Spot gegen Perp" content={spotPerpFlowInfo(tfLabel)} />
        </span>
        {loading ? (
          <p className="text-xs text-text-faint">Lade Perp-Kerzen…</p>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="tabular font-mono text-sm text-text">{formatSigned(result.spotNetPct, 1)}</p>
                <p className="text-xs text-text-faint mt-0.5">
                  Spot-Flow{result.spotDirection && ` · ${DIRECTION_LABEL[result.spotDirection]}`}
                </p>
              </div>
              <div>
                <p className="tabular font-mono text-sm text-text">{formatSigned(result.perpNetPct, 1)}</p>
                <p className="text-xs text-text-faint mt-0.5">
                  Perp-Flow{result.perpDirection && ` · ${DIRECTION_LABEL[result.perpDirection]}`}
                </p>
              </div>
              <div>
                <p className="tabular font-mono text-sm text-text">
                  {result.perpToSpotVolume === null ? "—" : `${result.perpToSpotVolume.toFixed(1)}×`}
                </p>
                <p className="text-xs text-text-faint mt-0.5">Perp- zu Spot-Volumen</p>
              </div>
            </div>
            <div className="mt-3">
              <CvdComparisonChart points={cvdPoints} />
            </div>
            {result.verdict ? (
              <div className="mt-3">
                <p className={`text-sm font-medium ${TONE_STYLES[result.verdict.tone]}`}>{result.verdict.label}</p>
                <p className="text-xs text-text-muted mt-1 leading-relaxed">{result.verdict.text}</p>
              </div>
            ) : (
              <p className="text-xs text-text-faint mt-3">
                Zu wenige Daten für eine Einordnung in diesem Zeitraum.
              </p>
            )}
          </>
        )}
      </div>

      <div className="pt-4 border-t border-border">
        <span className="flex items-center justify-between gap-2 mb-2">
          <span className="flex items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-[0.12em] text-text-faint">Coinbase-Premium · 24H</span>
            <PanelInfo title="Coinbase-Premium" content={coinbasePremiumInfo} />
          </span>
          {summary?.level && (
            <span className={`text-xs font-medium ${PREMIUM_STYLES[summary.level]}`}>{summary.label}</span>
          )}
        </span>
        {premium === null ? (
          <p className="text-xs text-text-faint">Lade Coinbase-Kurse…</p>
        ) : !summary ? (
          <p className="text-xs text-text-faint">Coinbase-Premium gerade nicht verfügbar ({premium.error ?? "keine Daten"}).</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <p className="tabular font-mono text-sm text-text">{formatSigned(summary.currentPct, 3)}</p>
                <p className="text-xs text-text-faint mt-0.5">Aktuell (Ø 30 Min)</p>
              </div>
              <div>
                <p className="tabular font-mono text-sm text-text">{formatSigned(summary.averagePct, 3)}</p>
                <p className="text-xs text-text-faint mt-0.5">Ø 24 Stunden</p>
              </div>
            </div>
            {premium.series && premium.series.length > 1 && (
              <TimeSeriesChart data={premium.series} color="#c99a5b" formatAxisTime={clockTimeLabel} height={110} />
            )}
          </>
        )}
      </div>
    </div>
  );
}
