import type { MarketRegime, MarketState } from "./types";
import type { SpotPressureVerdict } from "./spotPressure";
import type { MarketScenario } from "./marketContext";
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

// --- Ebene-0-Statuszeilen (Nutzer-Feedback vom 31.08.2026: "am Ende jeder
// Sparte noch ein Pfeil... oben gruen bullisch, unten rot baerisch, rechts
// neutral, und ein Zeichen fuer nicht anzeigbar") --------------------------
//
// Bewusst ein EIGENER 4-Zustands-Typ statt einer Erweiterung von
// SignalDirection oben: SignalDirection fasst jedes nicht gerichtete Regime
// (Squeeze/Reversion/Unresolved) zu einem einzigen "not_comparable" zusammen,
// weil das fuer die Ebene-1-Bestaetigungszaehlung reicht (dort zaehlt nur
// bullisch/baerisch/nicht vergleichbar). Fuer die Statuszeilen muss aber ein
// echtes, neutrales Regime (Squeeze/Reversion -- "es gibt eine Aussage, sie
// ist nur nicht gerichtet") von einem Fall unterscheidbar sein, in dem gar
// keine belastbare Aussage moeglich ist (UNRESOLVED_NEUTRAL, Confidence-
// Sperre, fehlende Daten) -- letzteres zeigt "nicht anzeigbar" (—), ersteres
// einen echten neutralen Pfeil (→). Keine neue Berechnung, nur eine feinere
// Kategorisierung derselben bereits vorhandenen Werte.
export type ArrowDirection = "up" | "down" | "neutral" | "not_available";

export function regimeArrowDirection(
  regime: MarketRegime | null,
  suppressed: boolean
): ArrowDirection {
  if (suppressed || regime === null || regime === "UNRESOLVED_NEUTRAL") return "not_available";
  if (regime === "TREND_EXPANSION_BULLISH") return "up";
  if (regime === "TREND_EXPANSION_BEARISH") return "down";
  return "neutral"; // VOLA_SQUEEZE_RANGING, HIGH_VOLA_REVERSION
}

export function spotPressureArrowDirection(verdict: SpotPressureVerdict | null): ArrowDirection {
  if (verdict === "BUYING_PRESSURE") return "up";
  if (verdict === "SELLING_PRESSURE") return "down";
  if (verdict === "NEUTRAL") return "neutral";
  return "not_available"; // INSUFFICIENT_DATA / null
}

// scenario === null deckt sowohl INSUFFICIENT_DATA als auch die Coverage-/
// Boersen-Onboarding-Sperre (LOCKED) ab -- classifyMarketContext liefert in
// beiden Faellen bias:"neutral" zurueck, das waere hier aber ein erfundener
// neutraler Pfeil statt einer echten Aussage ("Preis/OI bewegen sich zu
// wenig fuer eine Struktur" vs. "wir wissen es schlicht nicht").
export function marketContextArrowDirection(
  scenario: MarketScenario | null,
  bias: "bullish" | "bearish" | "neutral"
): ArrowDirection {
  if (scenario === null) return "not_available";
  if (bias === "bullish") return "up";
  if (bias === "bearish") return "down";
  return "neutral";
}

// Rein faktisches Vorzeichen (Preisaenderung, Netto-ETF-Flow) -- keine
// Marktkontext-Bewertung, nur die Richtung der Zahl selbst.
export function signArrowDirection(value: number | null): ArrowDirection {
  if (value === null) return "not_available";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "neutral";
}
