"use client";

import { useLivePriceData } from "@/components/LivePriceDataProvider";
import PanelInfo from "@/components/PanelInfo";
import { RelativeTime } from "@/components/ClientTimestamp";
import { buildCompactMarketStateSummary } from "@/lib/marketStateSummary";
import { kurznotizInfo } from "@/lib/panelInfo";

// Aus der ehemaligen LivePricePanel.tsx herausgeloest (Nutzer-Feedback
// 05.09.2026, siehe LivePriceDataProvider.tsx) -- kompakte Textdarstellung
// derselben market_states-Zeile wie MarketStateCard (Single Source of
// Truth, keine zweite unabhaengige Einschaetzung).

export default function KurznotizCard() {
  const { marketState } = useLivePriceData();

  if (!marketState) {
    return <p className="text-xs text-text-faint">Noch keine Gesamteinschätzung verfügbar.</p>;
  }

  return (
    <section className="rounded-lg border border-border bg-surface-raised p-5">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-1.5">
          <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">
            Kurznotiz (Gesamteinschätzung)
          </h2>
          <PanelInfo title="Kurznotiz" content={kurznotizInfo} />
        </div>
        <RelativeTime iso={marketState.timestamp_utc} className="text-xs text-text-faint" />
      </div>
      <p className="text-sm text-text leading-relaxed">
        {buildCompactMarketStateSummary(marketState)}
      </p>
      <p className="text-xs text-text-faint mt-2">
        Unabhängig vom oben gewählten Zeitraum — feste, rollierende
        Kurzbetrachtung, alle 15 Minuten neu berechnet. Dieselbe Quelle wie
        &bdquo;Gesamteinschätzung&ldquo; oben — keine zweite, unabhängige
        Einschätzung mehr (Single Source of Truth).
      </p>
    </section>
  );
}
