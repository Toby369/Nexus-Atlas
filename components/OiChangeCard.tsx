"use client";

import { useLivePriceData, LivePriceEmptyState } from "@/components/LivePriceDataProvider";
import PriceOiComparisonChart from "@/components/PriceOiComparisonChart";
import PanelInfo from "@/components/PanelInfo";
import { ClockTime, ShortDate } from "@/components/ClientTimestamp";
import { oiChangeInfo, btcOiChartInfo, exchangeDivergenceInfo } from "@/lib/panelInfo";
import { formatSignedPct } from "@/lib/livePriceFormat";
import { formatAnchorBadge, formatAnchorRangeBadge } from "@/lib/anchor";
import { SERIES_EXCHANGES, type SeriesExchangeId } from "@/lib/exchanges";
import type { OiChangeByExchange } from "@/lib/types";

// Aus der ehemaligen LivePricePanel.tsx herausgeloest (Nutzer-Feedback
// 05.09.2026, siehe LivePriceDataProvider.tsx) -- OI Change%/BTC Change%
// samt Boersen-Auswahl, der Preis/OI-Vergleichschart, und die "seit
// Anker"-Zusammenfassung (haengt an derselben Boersen-/Zeitraum-Auswahl).
//
// 13.09.2026 -- ehemals eigene "OI je Börse"-Kachel daneben: laut eigenem
// Code-Kommentar dort explizit der Detail-Blick auf dieselbe OI-Change%-
// Zahl, die hier schon als Headline (mit Boersen-Selector) steht. Gleiches
// Muster wie Marktkontext/Spot-Pressure -- als Aufklapper zusammengefuehrt
// statt zwei Kacheln fuer dieselbe Metrik, kein Datenverlust.

const COMPARE_EXCHANGES = ["bybit", "binance", "okx", "bitget", "bitunix", "pionex"];
const EXCHANGE_LABELS: Record<string, string> = {
  bybit: "Bybit",
  binance: "Binance",
  okx: "OKX",
  bitget: "Bitget",
  bitunix: "Bitunix",
  pionex: "Pionex",
};
// Boersen, ueber die sich ein OI-Change-Durchschnitt ueberhaupt sinnvoll
// bilden laesst -- Bitunix bewusst ausgeschlossen (liefert nachweislich
// dauerhaft kein Open Interest, kein fehlender Einzelwert wie bei den
// anderen Boersen).
const OI_AVERAGEABLE_EXCHANGES = COMPARE_EXCHANGES.filter((ex) => ex !== "bitunix");

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
    oiByExchange,
  } = useLivePriceData();

  if (!hasData) return <LivePriceEmptyState />;

  const tfLabel = selectedTf.label;
  const byExchange = new Map(oiByExchange.map((e) => [e.exchange, e]));
  const anyIncomplete = oiByExchange.some((e) => !e.has_full_history);
  const availableEntries = OI_AVERAGEABLE_EXCHANGES.map((ex) => byExchange.get(ex)).filter(
    (e): e is OiChangeByExchange => !!e && e.oi_change_pct !== null
  );
  const avgOiChangePct =
    availableEntries.length > 0
      ? availableEntries.reduce((sum, e) => sum + (e.oi_change_pct as number), 0) /
        availableEntries.length
      : null;

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

        {anchorIso && (
          <div className="flex flex-col gap-1 text-xs pt-3 mt-3 border-t border-border/60">
            <span className="text-text-faint">
              {anchoredSummary?.anchor_end_timestamp_utc
                ? formatAnchorRangeBadge(new Date(anchorIso), new Date(anchoredSummary.anchor_end_timestamp_utc))
                : `Seit Anker (${formatAnchorBadge(new Date(anchorIso))}):`}
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

        <details className="mt-4 pt-3 border-t border-border/60">
          <summary className="flex items-center justify-between gap-2 cursor-pointer select-none">
            <span className="flex items-center gap-1.5">
              <span className="text-[11px] uppercase tracking-[0.12em] text-text-faint">
                OI je Börse
              </span>
              <PanelInfo title="OI je Börse" content={exchangeDivergenceInfo(tfLabel)} />
            </span>
            {availableEntries.length > 1 && (
              <span
                className={`text-xs font-medium tabular font-mono ${
                  avgOiChangePct === null
                    ? "text-text-faint"
                    : avgOiChangePct >= 0
                    ? "text-up"
                    : "text-down"
                }`}
              >
                Ø {availableEntries.length} Börsen · {formatSignedPct(avgOiChangePct)}
              </span>
            )}
          </summary>

          <div className="mt-3 space-y-2">
            {COMPARE_EXCHANGES.map((ex) => {
              const data = byExchange.get(ex);
              const isUnavailable = ex === "bitunix";

              return (
                <div key={ex} className="flex items-center justify-between text-sm">
                  <span className="text-text-muted w-20 flex-shrink-0">
                    {EXCHANGE_LABELS[ex] ?? ex}
                  </span>
                  {isUnavailable ? (
                    <span className="tabular font-mono text-xs text-text-faint flex-1 text-right">
                      UNAVAILABLE
                    </span>
                  ) : data && data.oi_change_pct !== null ? (
                    <span
                      className={`tabular font-mono flex-1 text-right ${
                        data.oi_change_pct >= 0 ? "text-up" : "text-down"
                      }`}
                    >
                      {formatSignedPct(data.oi_change_pct)}
                      {!data.has_full_history && " *"}
                    </span>
                  ) : (
                    <span className="tabular font-mono text-xs text-text-faint flex-1 text-right">
                      —
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-text-faint mt-3">
            Diese Börsen fliessen in &quot;Aggregiert&quot; oben ein. UNAVAILABLE = Börse
            bietet öffentlich kein Open Interest.
            {anyIncomplete && " * Historie für diesen Zeitraum noch unvollständig."}
          </p>
        </details>
      </section>
    </div>
  );
}
