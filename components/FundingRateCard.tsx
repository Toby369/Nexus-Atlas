"use client";

import { useLivePriceData, LivePriceEmptyState } from "@/components/LivePriceDataProvider";
import TimeSeriesChart from "@/components/TimeSeriesChart";
import PanelInfo from "@/components/PanelInfo";
import { fundingRateInfo } from "@/lib/panelInfo";
import { formatPercent, clockTimeLabel } from "@/lib/livePriceFormat";
import { classifyFunding, fundingAnnualizedPct, fundingPctPer8h, type FundingTone } from "@/lib/fundingLevels";
import { useDashboardPoll } from "@/components/DashboardPollProvider";
import { summarizePositioning } from "@/lib/positioning";

// Datenquelle: gemeinsamer LivePriceDataProvider; Positionierung aus dem
// DashboardPollProvider (Snapshots aller Boersen, 5-Min-Takt).

const TONE_STYLES: Record<FundingTone, string> = {
  calm: "border-border text-text-muted",
  watch: "border-accent/40 bg-accent/10 text-accent",
  risk: "border-down/40 bg-down/10 text-down",
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
  const positioning = summarizePositioning(
    [bundle.positioning_binance, bundle.positioning_bybit, bundle.positioning_okx, bundle.positioning_bitget],
    bundle.positioning_binance,
  );

  if (!latest) return <LivePriceEmptyState />;

  const level = classifyFunding(latest.funding_rate);
  const annualPct = latest.funding_rate === null ? null : fundingAnnualizedPct(fundingPctPer8h(latest.funding_rate));

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-text-muted uppercase tracking-wide">Funding Rate (%)</p>
        <div className="flex items-center gap-2">
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
          <PanelInfo title="Funding Rate" content={fundingRateInfo} />
        </div>
      </div>
      {level && annualPct !== null && (
        <div className="flex items-center gap-2 flex-wrap mb-2" title={level.hint}>
          <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_STYLES[level.tone]}`}>
            {level.label}
          </span>
          <span className="tabular font-mono text-[11px] text-text-faint">{formatAnnual(annualPct)}</span>
          <span className="text-[11px] text-text-faint">{level.hint}</span>
        </div>
      )}
      <TimeSeriesChart data={fundingSeries} color="#4fae7c" formatAxisTime={clockTimeLabel} />
      {positioning && (
        <div className="mt-3 pt-3 border-t border-border/60 space-y-1.5" title={positioning.hint}>
          <div className="flex items-center justify-between gap-2">
            <span className="text-[11px] uppercase tracking-[0.12em] text-text-faint">Positionierung (Konten)</span>
            <span
              className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE_STYLES[positioning.tone]}`}
            >
              {positioning.label}
            </span>
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
    </div>
  );
}
