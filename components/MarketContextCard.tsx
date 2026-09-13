"use client";

import { getTimeframe, type TimeframeId } from "@/lib/timeframes";
import { deriveMarketContext } from "@/lib/marketContext";
import { classifySpotPressure } from "@/lib/spotPressure";
import PanelInfo from "@/components/PanelInfo";
import { marktkontextInfo, spotPressureInfo } from "@/lib/panelInfo";
import { useDashboardPoll } from "@/components/DashboardPollProvider";
import SpotPressureChart from "@/components/SpotPressureChart";

function formatSignedPct(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function formatBtc(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toLocaleString("de-CH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

export default function MarketContextCard({
  timeframe,
}: {
  // Geteilter Zeitraum aus app/page.tsx (URL-Query-Param "tf") -- vorher war
  // dieser Wert hier fest auf 4H codiert, unabhaengig von jeder UI-Auswahl.
  // Jetzt nutzt das Assessment exakt denselben Zeitraum wie OI Change/BTC
  // Change/Chart/Spot-Flow, damit die Werte tatsaechlich vergleichbar sind.
  timeframe: TimeframeId;
}) {
  // Datenquelle: DashboardPollProvider (Phase 2, Punkt 3) statt eigenem
  // 30s-Poll -- siehe dortiger Kommentar zur Buendelung mit
  // PositioningPanel.
  const { bundle, fetchedSinceIso, fetchedAtMs, isLoading } = useDashboardPoll();
  const tf = getTimeframe(timeframe);

  const {
    result,
    priceChangePct,
    oiChangePct,
    spotNetFlowPct,
    spotCandleCount,
    expectedSpotCandles,
    hasFullOiHistory,
  } = deriveMarketContext(bundle, timeframe, fetchedSinceIso, fetchedAtMs);

  // Farbe zeigt die Richtung des Szenarios (bullisch/baerisch), nicht ob der
  // Spot-Markt es bestaetigt -- ein bestaetigter Short-Aufbau ist trotzdem
  // baerisch, nicht gruen. "confirmed" steht bereits im Label-Text.
  const badgeColor =
    result.bias === "bullish"
      ? "text-up"
      : result.bias === "bearish"
      ? "text-down"
      : "text-text";

  // 13.09.2026 -- ehemals eigene "Spot Pressure"-Kachel daneben: beide
  // nutzten denselben Binance-Spot-Taker-Netto-Flow ueber denselben
  // Zeitraum, Marktkontext nur als EINEN von 3 Inputs (Preis+OI+Spot-Flow),
  // Spot Pressure als eigenstaendiges Detail-Verdikt zum Spot-Flow allein.
  // Zusammengefuehrt statt nebeneinander doppelt zu zeigen -- Detail jetzt
  // als Aufklapper hier, kein Datenverlust (gleiches Muster wie "Signale im
  // Detail" beim Setup-Score).
  const spotSummary = bundle.spot_summary;
  const spotSeries = bundle.spot_series;
  const sumBuy = spotSummary?.sum_taker_buy_vol ?? null;
  const sumSell = spotSummary?.sum_taker_sell_vol ?? null;
  const totalVol = sumBuy !== null && sumSell !== null ? sumBuy + sumSell : null;
  const spotVerdictNetFlowPct =
    totalVol !== null && totalVol > 0 && sumBuy !== null && sumSell !== null
      ? ((sumBuy - sumSell) / totalVol) * 100
      : null;
  const spotPriceChangePct =
    spotSummary?.first_price !== null &&
    spotSummary?.first_price !== undefined &&
    spotSummary?.last_price !== null &&
    spotSummary?.last_price !== undefined
      ? ((spotSummary.last_price - spotSummary.first_price) / spotSummary.first_price) * 100
      : null;
  const expectedSpotCandlesDetail = Math.max(1, Math.round(tf.minutes / 5));
  const spotCandleCountDetail = spotSummary?.candle_count ?? 0;
  const spotVerdict = classifySpotPressure({
    netFlowPct: spotVerdictNetFlowPct,
    candleCount: spotCandleCountDetail,
    expectedCandles: expectedSpotCandlesDetail,
  });
  const spotVerdictColor =
    spotVerdict.verdict === "BUYING_PRESSURE"
      ? "text-up"
      : spotVerdict.verdict === "SELLING_PRESSURE"
      ? "text-down"
      : "text-text";

  return (
    <section className="rounded-lg border border-accent/25 bg-surface-raised p-5">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-xs uppercase tracking-[0.15em] text-text-muted">
          Marktkontext (regelbasiert) · {tf.label}
        </h2>
        <PanelInfo title="Marktkontext" content={marktkontextInfo(tf.label)} />
      </div>

      {result.scenario === null ? (
        <>
          <p
            className={`text-xl sm:text-2xl font-semibold ${
              result.dataQuality === "LOCKED" ? "text-down" : "text-text"
            }`}
          >
            {result.label}
          </p>
          <p className="text-sm text-text-muted mt-2">{result.explanation}</p>
        </>
      ) : (
        <>
          <p className={`text-xl sm:text-2xl font-semibold ${badgeColor}`}>{result.label}</p>
          <p className="text-sm text-text-muted mt-2 leading-relaxed">{result.explanation}</p>
          <div className="flex gap-4 mt-3 text-xs text-text-faint flex-wrap">
            <span>Preis {formatSignedPct(priceChangePct)}</span>
            <span>OI {formatSignedPct(oiChangePct)}</span>
            <span>Spot-Flow {formatSignedPct(spotNetFlowPct)}</span>
          </div>
          <p className="text-xs text-text-faint mt-2">
            Datenqualität: {result.dataQuality}
            {result.dataQuality !== "OK" &&
              ` — Spot-Basis ${spotCandleCount}/${expectedSpotCandles} Kerzen${
                !hasFullOiHistory ? ", OI-Historie für diesen Zeitraum unvollständig" : ""
              }.`}
          </p>
        </>
      )}

      <p className="text-xs text-text-faint mt-3">
        Regelbasierte Einordnung aus Preis-, OI- (aggregiert) und Spot-Flow-Richtung
        über {tf.label} — keine KI, keine Anlageberatung. Schwellenwerte sind
        bewusst konservativ gewählt.
      </p>

      <details className="mt-4 pt-3 border-t border-border/60">
        <summary className="flex items-center justify-between gap-2 cursor-pointer select-none">
          <span className="flex items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-[0.12em] text-text-faint">
              Spot Pressure im Detail
            </span>
            <PanelInfo title="Spot Pressure" content={spotPressureInfo(tf.label)} />
          </span>
          <span className={`text-xs font-medium ${spotVerdictColor}`}>{spotVerdict.label}</span>
        </summary>

        <div className="mt-3">
          {!spotSummary || spotCandleCountDetail === 0 ? (
            <p className="text-sm text-text-muted">
              Noch keine Spot-Kerzen fuer diesen Zeitraum erfasst — der Collector
              sammelt alle 5 Minuten eine neue Kerze, schau in Kürze wieder vorbei.
            </p>
          ) : (
            <>
              <div className="flex items-end gap-6 flex-wrap mb-1">
                <div>
                  <span
                    className={`tabular font-mono text-2xl sm:text-3xl font-semibold ${
                      spotVerdictNetFlowPct === null
                        ? "text-text-faint"
                        : spotVerdictNetFlowPct >= 0
                        ? "text-up"
                        : "text-down"
                    }`}
                  >
                    {formatSignedPct(spotVerdictNetFlowPct)}
                  </span>
                  <p className="text-xs text-text-faint mt-1">
                    Netto Taker-Flow · {tf.label}
                  </p>
                </div>
                <div>
                  <span
                    className={`tabular font-mono text-base font-medium ${
                      spotPriceChangePct === null
                        ? "text-text-faint"
                        : spotPriceChangePct >= 0
                        ? "text-up"
                        : "text-down"
                    }`}
                  >
                    {formatSignedPct(spotPriceChangePct)}
                  </span>
                  <p className="text-xs text-text-faint mt-1">
                    BTC Preis (Spot) · {tf.label}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3 mt-4">
                <div>
                  <p className="tabular font-mono text-sm text-up">{formatBtc(sumBuy)} BTC</p>
                  <p className="text-xs text-text-faint mt-0.5">Taker Buy</p>
                </div>
                <div>
                  <p className="tabular font-mono text-sm text-down">{formatBtc(sumSell)} BTC</p>
                  <p className="text-xs text-text-faint mt-0.5">Taker Sell</p>
                </div>
                <div>
                  <p className="tabular font-mono text-sm text-text">
                    {spotCandleCountDetail} / {expectedSpotCandlesDetail}
                  </p>
                  <p className="text-xs text-text-faint mt-0.5">Kerzen im Fenster</p>
                </div>
              </div>

              <p className="text-xs text-text-faint mt-3">
                Datenabdeckung: {spotCandleCountDetail} / {expectedSpotCandlesDetail} Kerzen · Status:{" "}
                {spotVerdict.dataQuality}
                {spotVerdict.dataQuality !== "OK" &&
                  " — Verdikt basiert nur auf den tatsächlich vorhandenen Kerzen."}
              </p>

              <div className="mt-4 pt-4 border-t border-border">
                {isLoading ? (
                  <div className="h-[140px] flex items-center justify-center text-xs text-text-faint">
                    Lade Zeitreihe…
                  </div>
                ) : (
                  <SpotPressureChart data={spotSeries} />
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
        </div>
      </details>
    </section>
  );
}
