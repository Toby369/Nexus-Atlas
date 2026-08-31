"use client";

import { getTimeframe, type TimeframeId } from "@/lib/timeframes";
import { deriveMarketContext } from "@/lib/marketContext";
import PanelInfo from "@/components/PanelInfo";
import { marktkontextInfo } from "@/lib/panelInfo";
import { useDashboardPoll } from "@/components/DashboardPollProvider";

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
