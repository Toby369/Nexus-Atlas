"use client";

import { useLivePriceData, LivePriceEmptyState } from "@/components/LivePriceDataProvider";
import TimeSeriesChart from "@/components/TimeSeriesChart";
import PanelInfo from "@/components/PanelInfo";
import { RelativeTime, ClockTime } from "@/components/ClientTimestamp";
import { btcPriceInfo } from "@/lib/panelInfo";
import { formatUsd, clockTimeLabel } from "@/lib/livePriceFormat";

// Aus der ehemaligen LivePricePanel.tsx herausgeloest (Nutzer-Feedback
// 05.09.2026, siehe LivePriceDataProvider.tsx) -- Live-Status-Zeile +
// grosse Preis-Anzeige + Preis-Chart. Datenquelle ist der gemeinsame
// LivePriceDataProvider (siehe app/page.tsx).

export default function BtcPriceCard() {
  const { latest, priceChange, isUp, priceSeries, isStale, lastSyncOk, anchorIso } =
    useLivePriceData();

  if (!latest) return <LivePriceEmptyState />;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${
              isStale || !lastSyncOk ? "bg-down" : "bg-up live-dot"
            }`}
            aria-hidden
          />
          <span className={isStale || !lastSyncOk ? "text-down" : "text-text-muted"}>
            {!lastSyncOk
              ? "Sync-Problem — letzte bekannte Daten werden angezeigt"
              : isStale
              ? "Daten veraltet — Pipeline prüfen"
              : "Live"}
          </span>
        </div>
        <span className="text-text-faint">
          Datenpunkt <ClockTime iso={latest.timestamp_utc} /> Uhr ·{" "}
          <RelativeTime iso={latest.timestamp_utc} />
        </span>
      </div>

      <div className="rounded-lg border border-border bg-surface p-6 sm:p-8">
        <div className="flex items-center justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <span className="live-dot inline-block h-2 w-2 rounded-full bg-accent" aria-hidden />
            <span className="text-xs uppercase tracking-[0.15em] text-text-muted">
              {latest.symbol} · {latest.exchange} Perpetual
            </span>
            {anchorIso && (
              <span
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full border border-accent/30 text-accent"
                title="Zeigt weiter unten zusätzlich Daten seit dem gesetzten Event-Anker."
              >
                ⚓ Anker
              </span>
            )}
          </div>
          <PanelInfo title="BTC Preis" content={btcPriceInfo} />
        </div>

        <div className="flex items-baseline gap-3 flex-wrap">
          <span className="tabular font-mono text-4xl sm:text-5xl font-semibold text-text">
            ${formatUsd(latest.last_price)}
          </span>
          {priceChange !== null && (
            <span
              className={`tabular text-sm font-medium ${
                isUp ? "text-up font-mono" : "text-down font-mono"
              }`}
            >
              {isUp ? "▲" : "▼"} ${formatUsd(Math.abs(priceChange))}
            </span>
          )}
        </div>

        <p className="text-xs text-text-faint mt-2">
          Aktualisiert <RelativeTime iso={latest.timestamp_utc} />
        </p>

        <div className="mt-5 pt-5 border-t border-border">
          <p className="text-xs text-text-muted uppercase tracking-wide mb-1">
            Preis · letzte {Math.round((priceSeries.length * 5) / 60)} Std
          </p>
          <TimeSeriesChart data={priceSeries} color="#c99a5b" formatAxisTime={clockTimeLabel} />
        </div>
      </div>
    </div>
  );
}
