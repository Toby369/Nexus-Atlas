"use client";

import { useLivePriceData, LivePriceEmptyState } from "@/components/LivePriceDataProvider";
import PriceOiComparisonChart from "@/components/PriceOiComparisonChart";
import PanelInfo from "@/components/PanelInfo";
import { ClockTime, ShortDate } from "@/components/ClientTimestamp";
import { oiChangeInfo, btcOiChartInfo } from "@/lib/panelInfo";
import { formatSignedPct } from "@/lib/livePriceFormat";
import { formatAnchorBadge } from "@/lib/anchor";
import { SERIES_EXCHANGES, type SeriesExchangeId } from "@/lib/exchanges";

// Aus der ehemaligen LivePricePanel.tsx herausgeloest (Nutzer-Feedback
// 05.09.2026, siehe LivePriceDataProvider.tsx) -- OI Change%/BTC Change%
// samt Boersen-Auswahl, der Preis/OI-Vergleichschart, und die "seit
// Anker"-Zusammenfassung (haengt an derselben Boersen-/Zeitraum-Auswahl).

export default function OiChangeCard() {
  const {
    hasData,
    seriesExchange,
    setSeriesExchange,
    seriesData,
    seriesLoading,
    referenceSnapshot,
    oiChangePct,
    btcChangePct,
    selectedTf,
    selectedExchange,
    hasFullHistory,
    anchorIso,
    anchoredSummary,
  } = useLivePriceData();

  if (!hasData) return <LivePriceEmptyState />;

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border bg-surface p-5">
        <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
          <div className="flex items-center gap-1.5">
            <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">OI Change</h2>
            <PanelInfo title="OI Change" content={oiChangeInfo(selectedTf.label)} />
          </div>
          <select
            value={seriesExchange}
            onChange={(e) => setSeriesExchange(e.target.value as SeriesExchangeId)}
            className="text-xs rounded-md border border-border bg-surface-raised text-text-muted px-2 py-1 focus:outline-none focus:border-accent/40"
          >
            {SERIES_EXCHANGES.map((ex) => (
              <option key={ex.id} value={ex.id}>
                {ex.label}
              </option>
            ))}
          </select>
        </div>

        <div className="flex items-end gap-6 flex-wrap mb-1">
          <div>
            <span
              className={`tabular font-mono text-3xl sm:text-4xl font-semibold ${
                oiChangePct === null ? "text-text-faint" : oiChangePct >= 0 ? "text-up" : "text-down"
              }`}
            >
              {formatSignedPct(oiChangePct)}
            </span>
            <p className="text-xs text-text-faint mt-1">
              Open Interest · {selectedExchange.label} · {selectedTf.label}
            </p>
          </div>
          <div>
            <span
              className={`tabular font-mono text-lg font-medium ${
                btcChangePct === null ? "text-text-faint" : btcChangePct >= 0 ? "text-up" : "text-down"
              }`}
            >
              {formatSignedPct(btcChangePct)}
            </span>
            <p className="text-xs text-text-faint mt-1">BTC Preis · {selectedTf.label}</p>
          </div>
        </div>

        {!hasFullHistory && referenceSnapshot && (
          <p className="text-xs text-text-faint mb-3">
            Noch keine volle {selectedTf.label}-Historie — Basis ist der
            älteste verfügbare Datenpunkt (<ClockTime iso={referenceSnapshot.timestamp_utc} />
            {", "}
            <ShortDate iso={referenceSnapshot.timestamp_utc} />
            ).
          </p>
        )}

        <div className="mt-4 pt-4 border-t border-border">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-text-muted uppercase tracking-wide">Preis/OI-Vergleich</p>
            <PanelInfo title="BTC/OI Chart" content={btcOiChartInfo(selectedTf.label)} />
          </div>
          {seriesLoading ? (
            <div className="h-[180px] flex items-center justify-center text-xs text-text-faint">
              Lade Zeitreihe…
            </div>
          ) : (
            <PriceOiComparisonChart data={seriesData} />
          )}
        </div>
      </section>

      {anchorIso && (
        <div className="flex flex-col gap-1 text-xs pt-2 border-t border-border/60">
          <span className="text-text-faint">
            Seit Anker ({formatAnchorBadge(new Date(anchorIso))}):
          </span>
          {anchoredSummary ? (
            <span className="tabular font-mono text-text-muted">
              Preis {formatSignedPct(anchoredSummary.price_change_pct)} · OI{" "}
              {formatSignedPct(anchoredSummary.oi_change_pct)}
            </span>
          ) : (
            <span className="text-text-faint">Lädt…</span>
          )}
        </div>
      )}
    </div>
  );
}
