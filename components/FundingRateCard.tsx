"use client";

import { useLivePriceData, LivePriceEmptyState } from "@/components/LivePriceDataProvider";
import TimeSeriesChart from "@/components/TimeSeriesChart";
import PanelInfo from "@/components/PanelInfo";
import { fundingRateInfo } from "@/lib/panelInfo";
import { formatPercent, clockTimeLabel } from "@/lib/livePriceFormat";
import { classifyFunding, fundingAnnualizedPct, fundingPctPer8h, type FundingTone } from "@/lib/fundingLevels";

// Datenquelle: gemeinsamer LivePriceDataProvider.

const TONE_STYLES: Record<FundingTone, string> = {
  calm: "border-border text-text-muted",
  watch: "border-accent/40 bg-accent/10 text-accent",
  risk: "border-down/40 bg-down/10 text-down",
};

function formatAnnual(pct: number): string {
  return `${pct >= 0 ? "+" : ""}${pct.toLocaleString("de-CH", { maximumFractionDigits: 0 })} % p.a.`;
}

export default function FundingRateCard() {
  const { latest, fundingSeries } = useLivePriceData();

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
    </div>
  );
}
