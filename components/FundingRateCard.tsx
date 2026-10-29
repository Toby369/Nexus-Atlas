"use client";

import { useLivePriceData, LivePriceEmptyState } from "@/components/LivePriceDataProvider";
import TimeSeriesChart from "@/components/TimeSeriesChart";
import { Karte, Pille, type PillenTon } from "@/components/basis";
import { fundingRateInfo } from "@/lib/panelInfo";
import { formatPercent, clockTimeLabel } from "@/lib/livePriceFormat";
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { setVisibleInterval } from "@/lib/visibleInterval";
import {
  FUNDING_HISTORY_DAYS,
  classifyFunding,
  fundingAnnualizedPct,
  fundingBaselineStatus,
  fundingPctPer8h,
  type FundingEvent,
  type FundingTone,
} from "@/lib/fundingLevels";
import { useDashboardPoll } from "@/components/DashboardPollProvider";
import { summarizePositioning } from "@/lib/positioning";

// Datenquelle: gemeinsamer LivePriceDataProvider; Positionierung aus dem
// DashboardPollProvider (Snapshots aller Boersen, 5-Min-Takt). Die
// Grundwert-Zeile fragt je den juengsten Bybit-Wert unter 0, ueber 0,01 %
// und im Grundwert ab (drei Zeilen statt 30 Tage Verlauf).

const HISTORY_EXCHANGE = "bybit";
const HISTORY_REFRESH_MS = 15 * 60_000;

interface FundingHistory {
  lastNegative: FundingEvent | null;
  lastAbove: FundingEvent | null;
  lastBaseline: FundingEvent | null;
  fetchedAt: number;
}

async function fetchLatest(filter: "negative" | "above" | "baseline"): Promise<FundingEvent | null> {
  const since = new Date(Date.now() - FUNDING_HISTORY_DAYS * 86_400_000).toISOString();
  let q = supabase
    .from("market_snapshots")
    .select("timestamp_utc, funding_rate")
    .eq("exchange", HISTORY_EXCHANGE)
    .gte("timestamp_utc", since);
  if (filter === "negative") q = q.lt("funding_rate", 0);
  else if (filter === "above") q = q.gt("funding_rate", 0.0001);
  else q = q.gte("funding_rate", 0).lte("funding_rate", 0.0001);
  const { data, error } = await q.order("timestamp_utc", { ascending: false }).limit(1).maybeSingle();
  if (error) {
    console.error(`FundingRateCard: Fehler beim Laden der Funding-Historie (${filter}):`, error.message);
    return null;
  }
  return data ? { t: Date.parse(data.timestamp_utc as string), pct: fundingPctPer8h(Number(data.funding_rate)) } : null;
}

async function fetchHistory(): Promise<FundingHistory> {
  const [lastNegative, lastAbove, lastBaseline] = await Promise.all([
    fetchLatest("negative"),
    fetchLatest("above"),
    fetchLatest("baseline"),
  ]);
  return { lastNegative, lastAbove, lastBaseline, fetchedAt: Date.now() };
}

const PILLEN_TON: Record<FundingTone, PillenTon> = {
  calm: "ruhig",
  watch: "beobachten",
  risk: "risiko",
};

function pct(value: number): string {
  return `${value.toLocaleString("de-CH", { maximumFractionDigits: 0 })} %`;
}

function formatAnnual(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toLocaleString("de-CH", { maximumFractionDigits: 0 })} % p.a.`;
}

export default function FundingRateCard() {
  const { latest, fundingSeries } = useLivePriceData();
  const { bundle } = useDashboardPoll();
  const [history, setHistory] = useState<FundingHistory | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      fetchHistory().then((h) => {
        if (!cancelled) setHistory(h);
      });
    load();
    const stop = setVisibleInterval(load, HISTORY_REFRESH_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  const positioning = summarizePositioning(
    [bundle.positioning_binance, bundle.positioning_bybit, bundle.positioning_okx, bundle.positioning_bitget],
    bundle.positioning_binance,
  );

  if (!latest) return <LivePriceEmptyState />;

  const level = classifyFunding(latest.funding_rate);
  const annualPct = latest.funding_rate === null ? null : fundingAnnualizedPct(fundingPctPer8h(latest.funding_rate));
  const baseline =
    history && latest.funding_rate !== null
      ? fundingBaselineStatus(
          fundingPctPer8h(latest.funding_rate),
          history.lastNegative,
          history.lastAbove,
          history.lastBaseline,
          history.fetchedAt,
        )
      : null;

  return (
    <Karte
      titel="Funding Rate (%)"
      info={{ titel: "Funding Rate", text: fundingRateInfo }}
      aktion={
        <span
          className={`tabular font-mono text-xs ${
            latest.funding_rate === null
              ? "text-text-faint"
              : latest.funding_rate >= 0
              ? "text-up"
              : "text-down"
          }`}
        >
          {formatPercent(latest.funding_rate)}
        </span>
      }
      dicht
    >
      {level && annualPct !== null && (
        <div className="flex items-center gap-2 flex-wrap mb-2" title={level.hint}>
          <Pille ton={PILLEN_TON[level.tone]}>{level.label}</Pille>
          <span className="tabular font-mono text-[11px] text-text-faint">{formatAnnual(annualPct)}</span>
          <span className="text-[11px] text-text-faint">{level.hint}</span>
        </div>
      )}
      <TimeSeriesChart data={fundingSeries} color="#4fae7c" formatAxisTime={clockTimeLabel} />
      {baseline && (
        <div className="mt-2 space-y-0.5">
          {baseline.lines.map((line, i) => (
            <p key={line} className={`text-[11px] ${i === 0 ? "text-text-muted" : "text-text-faint"}`}>
              {line}
            </p>
          ))}
        </div>
      )}
      {positioning && (
        <div className="mt-3 pt-3 border-t border-border/60 space-y-1.5" title={positioning.hint}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-[0.12em] text-text-faint">Positionierung (Konten)</span>
            <Pille ton={PILLEN_TON[positioning.tone]}>{positioning.label}</Pille>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
            <span>
              Masse long:{" "}
              <span className="tabular font-mono text-text">{pct(positioning.crowdLongPct)}</span>
              <span className="text-text-faint"> ({positioning.exchangeCount} Börsen)</span>
            </span>
            {positioning.topLongPct !== null && (
              <span>
                Top-Trader long: <span className="tabular font-mono text-text">{pct(positioning.topLongPct)}</span>
              </span>
            )}
            {positioning.divergencePp !== null && (
              <span>
                Abstand:{" "}
                <span className="tabular font-mono text-text">
                  {positioning.divergencePp >= 0 ? "+" : ""}
                  {positioning.divergencePp.toFixed(0)} Pp
                </span>
              </span>
            )}
          </div>
          <p className="text-[11px] text-text-faint">{positioning.hint}</p>
        </div>
      )}
    </Karte>
  );
}
