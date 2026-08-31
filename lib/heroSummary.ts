import type { MarketRegime, MarketState } from "./types";
import type { SpotPressureVerdict } from "./spotPressure";
import { DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD } from "./marketStateSummary";

// Hero-Verdikt (Ebene 0/1 der neuen Dashboard-Hierarchie, Nutzer-Feedback
// vom 31.08.2026): "kompaktere App mit einem Hinweis, wohin der Kurs geht".
// Bewusst KEIN neuer Blend-Score -- nur ein Vorzeichen-Vergleich zwischen
// bereits vorhandenen, unabhaengig berechneten Richtungsaussagen. Jede
// Sparte behaelt ihre eigene Bedeutung; hier wird lediglich gezaehlt, wie
// viele davon mit der primaeren Richtung (14-Faktoren-Assessment)
// uebereinstimmen -- keine neue Gewichtung, keine neue Formel.
export type SignalDirection = "bullish" | "bearish" | "not_comparable";

export interface ConfirmationSignal {
  name: string;
  direction: SignalDirection;
}

// Regime Matrix -> Richtung. Nur die beiden gerichteten Trendausweitungs-
// Regimes zaehlen als Richtungsaussage -- dieselbe Konvention wie
// lib/marketRegime.ts::computeEngineDivergence (Squeeze/Reversion/
// Unresolved sind nicht gerichtet, also nicht vergleichbar).
export function regimeDirection(regime: MarketRegime | null): SignalDirection {
  if (regime === "TREND_EXPANSION_BULLISH") return "bullish";
  if (regime === "TREND_EXPANSION_BEARISH") return "bearish";
  return "not_comparable";
}

// Spot Pressure -> Richtung. NEUTRAL/INSUFFICIENT_DATA sind explizit keine
// Richtungsaussage (siehe lib/spotPressure.ts), zaehlen hier bewusst nicht
// als Widerspruch, sondern als nicht vergleichbar.
export function spotPressureDirection(verdict: SpotPressureVerdict | null): SignalDirection {
  if (verdict === "BUYING_PRESSURE") return "bullish";
  if (verdict === "SELLING_PRESSURE") return "bearish";
  return "not_comparable";
}

export interface ConfirmationSummary {
  primaryDirection: "bullish" | "bearish" | null;
  confirmingCount: number;
  totalComparable: number;
  confirming: string[];
  contradicting: string[];
}

// primaryDirection ist null, wenn der 14-Faktoren-Zustand selbst schon
// nicht gerichtet ist (NEUTRAL/MIXED/INSUFFICIENT_DATA) oder die
// Confidence-Sperre greift (< 35/100) -- dieselbe Schwelle wie
// MarketStateCard/RegimeMatrixCard, keine zweite, neu erfundene Zahl. In
// dem Fall ist die Bestaetigungs-Zeile bedeutungslos und wird von der
// aufrufenden Komponente ausgeblendet.
export function summarizeConfirmation(
  overallState: MarketState["overall_state"],
  confidence: number,
  signals: ConfirmationSignal[]
): ConfirmationSummary {
  const primaryDirection: "bullish" | "bearish" | null =
    confidence < DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD
      ? null
      : overallState === "BULLISH"
        ? "bullish"
        : overallState === "BEARISH"
          ? "bearish"
          : null;

  const comparable = signals.filter((s) => s.direction !== "not_comparable");
  const confirming = primaryDirection
    ? comparable.filter((s) => s.direction === primaryDirection)
    : [];
  const contradicting = primaryDirection
    ? comparable.filter((s) => s.direction !== primaryDirection)
    : [];

  return {
    primaryDirection,
    confirmingCount: confirming.length,
    totalComparable: comparable.length,
    confirming: confirming.map((s) => s.name),
    contradicting: contradicting.map((s) => s.name),
  };
}
