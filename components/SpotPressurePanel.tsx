"use client";

import SpotPressureChart from "@/components/SpotPressureChart";
import { getTimeframe, type TimeframeId } from "@/lib/timeframes";
import { classifySpotPressure } from "@/lib/spotPressure";
import PanelInfo from "@/components/PanelInfo";
import { spotPressureInfo } from "@/lib/panelInfo";
import { useDashboardPoll } from "@/components/DashboardPollProvider";

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

export default function SpotPressurePanel({
  timeframe,
}: {
  // Geteilter Zeitraum aus app/page.tsx (URL-Query-Param "tf") -- kein
  // eigener, unabhaengiger Selector mehr (siehe LivePricePanel-Kommentar).
  timeframe: TimeframeId;
}) {
  // Datenquelle: DashboardPollProvider (Phase 2, Punkt 3) statt eigenem
  // 30s-Poll -- siehe dortiger Kommentar zur Buendelung mit
  // MarketContextCard/PositioningPanel.
  const { bundle, isLoading } = useDashboardPoll();
  const summary = bundle.spot_summary;
  const series = bundle.spot_series;
  const loading = isLoading;

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
  const verdict = classifySpotPressure({ netFlowPct, candleCount, expectedCandles });
  const verdictColor =
    verdict.verdict === "BUYING_PRESSURE"
      ? "text-up"
      : verdict.verdict === "SELLING_PRESSURE"
      ? "text-down"
      : "text-text";

  return (
    <section className="rounded-lg border border-border bg-surface p-5">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-4">
        <div className="flex items-center gap-1.5">
          <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">
            Spot Pressure
          </h2>
          <PanelInfo title="Spot Pressure" content={spotPressureInfo(selectedTf.label)} />
        </div>
        <p className="text-xs text-text-faint">{selectedTf.label}</p>
      </div>

      <p className={`text-xl sm:text-2xl font-semibold ${verdictColor}`}>
        {verdict.label}
      </p>

      {!summary || candleCount === 0 ? (
        <p className="text-sm text-text-muted mt-2">
          Noch keine Spot-Kerzen fuer diesen Zeitraum erfasst — der Collector
          sammelt alle 5 Minuten eine neue Kerze, schau in Kürze wieder vorbei.
        </p>
      ) : (
        <>
          <div className="flex items-end gap-6 flex-wrap mt-3 mb-1">
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

          <p className="text-xs text-text-faint mt-3">
            Datenabdeckung: {candleCount} / {expectedCandles} Kerzen · Status:{" "}
            {verdict.dataQuality}
            {verdict.dataQuality !== "OK" &&
              " — Verdikt basiert nur auf den tatsächlich vorhandenen Kerzen."}
          </p>

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
    </section>
  );
}
