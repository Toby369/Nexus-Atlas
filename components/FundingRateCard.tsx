"use client";

import { useLivePriceData, LivePriceEmptyState } from "@/components/LivePriceDataProvider";
import TimeSeriesChart from "@/components/TimeSeriesChart";
import PanelInfo from "@/components/PanelInfo";
import { fundingRateInfo } from "@/lib/panelInfo";
import { formatPercent, clockTimeLabel } from "@/lib/livePriceFormat";

// Aus der ehemaligen LivePricePanel.tsx herausgeloest (Nutzer-Feedback
// 05.09.2026, siehe LivePriceDataProvider.tsx).

export default function FundingRateCard() {
  const { latest, fundingSeries } = useLivePriceData();

  if (!latest) return <LivePriceEmptyState />;

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
      <TimeSeriesChart data={fundingSeries} color="#4fae7c" formatAxisTime={clockTimeLabel} />
    </div>
  );
}
