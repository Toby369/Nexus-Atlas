"use client";

import { getTimeframe, type TimeframeId } from "@/lib/timeframes";
import { SERIES_EXCHANGES } from "@/lib/exchanges";
import { classifyMarketContext } from "@/lib/marketContext";
import { classifySpotPressure } from "@/lib/spotPressure";
import { isExchangeSetConsistentOverWindow } from "@/lib/exchangeConsistency";
import PanelInfo from "@/components/PanelInfo";
import { marktkontextInfo } from "@/lib/panelInfo";
import { useDashboardPoll } from "@/components/DashboardPollProvider";

// Referenzpunkt gilt als "kein voller Zeitraum verfuegbar", wenn er mehr als
// 15 Min spaeter liegt als angefragt -- identische Toleranz wie in
// LivePricePanel.tsx (siehe dortiger Kommentar).
const HISTORY_GAP_TOLERANCE_MS = 15 * 60 * 1000;

function formatSignedPct(value: number | null) {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
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
  // SpotPressurePanel/PositioningPanel.
  const { bundle, fetchedSinceIso, fetchedAtMs } = useDashboardPoll();
  const oiSeries = bundle.oi_series;
  const oiReference = bundle.oi_reference;
  const spotSummary = bundle.spot_summary;
  const exchangeFirstSeen = bundle.exchange_first_seen;

  const tf = getTimeframe(timeframe);

  const latestOiPoint = oiSeries.length > 0 ? oiSeries[oiSeries.length - 1] : null;
  const oiChangePct =
    latestOiPoint?.open_interest !== null &&
    latestOiPoint?.open_interest !== undefined &&
    oiReference?.open_interest !== null &&
    oiReference?.open_interest !== undefined
      ? ((latestOiPoint.open_interest - oiReference.open_interest) /
          oiReference.open_interest) *
        100
      : null;

  const priceChangePct =
    latestOiPoint?.last_price !== null &&
    latestOiPoint?.last_price !== undefined &&
    oiReference?.last_price !== null &&
    oiReference?.last_price !== undefined
      ? ((latestOiPoint.last_price - oiReference.last_price) / oiReference.last_price) * 100
      : null;

  const sumBuy = spotSummary?.sum_taker_buy_vol ?? null;
  const sumSell = spotSummary?.sum_taker_sell_vol ?? null;
  const totalVol = sumBuy !== null && sumSell !== null ? sumBuy + sumSell : null;
  const spotNetFlowPct =
    totalVol !== null && totalVol > 0 && sumBuy !== null && sumSell !== null
      ? ((sumBuy - sumSell) / totalVol) * 100
      : null;

  const expectedSpotCandles = Math.max(1, Math.round(tf.minutes / 5));
  const spotCandleCount = spotSummary?.candle_count ?? 0;
  const spotVerdict = classifySpotPressure({
    netFlowPct: spotNetFlowPct,
    candleCount: spotCandleCount,
    expectedCandles: expectedSpotCandles,
  });

  const requestedSinceMs = fetchedSinceIso ? new Date(fetchedSinceIso).getTime() : null;
  const oiReferenceMs = oiReference ? new Date(oiReference.timestamp_utc).getTime() : null;
  const hasFullOiHistory =
    oiReferenceMs !== null && requestedSinceMs !== null
      ? oiReferenceMs <= requestedSinceMs + HISTORY_GAP_TOLERANCE_MS
      : false;

  // Wieviel Prozent des angefragten Fensters der Referenzpunkt tatsaechlich
  // deckt -- get_market_reference_snapshot faellt bei zu junger Historie
  // auf den aeltesten je verfuegbaren Punkt zurueck (siehe SQL-Definition),
  // oiReferenceMs ist in diesem Fall also das echte Alter der Historie,
  // nicht nur ein potenziell irrefuehrendes "kein Wert".
  const nowMs = fetchedAtMs;
  const requestedWindowMs =
    requestedSinceMs !== null ? nowMs - requestedSinceMs : null;
  const coveredWindowMs =
    oiReferenceMs !== null && requestedSinceMs !== null
      ? nowMs - Math.max(oiReferenceMs, requestedSinceMs)
      : null;
  const historyCoveragePct =
    requestedWindowMs !== null && requestedWindowMs > 0 && coveredWindowMs !== null
      ? Math.min(100, Math.max(0, (coveredWindowMs / requestedWindowMs) * 100))
      : null;
  const earliestDataAgeDays =
    oiReferenceMs !== null ? (nowMs - oiReferenceMs) / (24 * 60 * 60 * 1000) : null;

  const aggregatedExchangeIds = SERIES_EXCHANGES.filter((e) => e.id !== "aggregated").map(
    (e) => e.id
  );
  const oiExchangeSetConsistent =
    requestedSinceMs !== null && exchangeFirstSeen.length > 0
      ? isExchangeSetConsistentOverWindow(exchangeFirstSeen, aggregatedExchangeIds, requestedSinceMs)
      : null;

  const result = classifyMarketContext({
    priceChangePct,
    oiChangePct,
    spotNetFlowPct,
    hasFullOiHistory,
    spotDataQuality: spotVerdict.dataQuality,
    timeframeMinutes: tf.minutes,
    historyCoveragePct,
    earliestDataAgeDays,
    oiExchangeSetConsistent,
  });

  // Farbe zeigt die Richtung des Szenarios (bullisch/baerisch), nicht ob der
  // Spot-Markt es bestaetigt -- ein bestaetigter Short-Aufbau ist trotzdem
  // baerisch, nicht gruen. "confirmed" steht bereits im Label-Text.
  const badgeColor =
    result.bias === "bullish"
      ? "text-up"
      : result.bias === "bearish"
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
    </section>
  );
}
