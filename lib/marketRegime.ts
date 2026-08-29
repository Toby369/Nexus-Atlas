import type { MarketRegime, MarketState } from "@/lib/types";
import { DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD } from "@/lib/marketStateSummary";

// Anzeige-Schicht fuer die Market-State-Matrix-Engine (Phase 3, Punkt 2) --
// deutsche Labels/Kurzbeschreibungen fuer die 5 Regime-Werte, die
// SQL-seitig von classify_market_regime() (Migration
// add_market_state_matrix_engine) geliefert werden, mit exakt denselben
// Bezeichnern wie research-python/src/regime.py::ALL_REGIMES. Bewusst reine,
// von React/Supabase entkoppelte Funktionen (kein UI-Panel bisher
// angebunden -- dieselbe Konvention wie lib/exchangeConsistency.ts).

export const ALL_MARKET_REGIMES: readonly MarketRegime[] = [
  "HIGH_VOLA_REVERSION",
  "TREND_EXPANSION_BULLISH",
  "TREND_EXPANSION_BEARISH",
  "VOLA_SQUEEZE_RANGING",
  "UNRESOLVED_NEUTRAL",
];

const REGIME_LABELS: Record<MarketRegime, string> = {
  HIGH_VOLA_REVERSION: "Hohe Volatilität / Reversion",
  TREND_EXPANSION_BULLISH: "Trendausweitung (bullisch)",
  TREND_EXPANSION_BEARISH: "Trendausweitung (bärisch)",
  VOLA_SQUEEZE_RANGING: "Volatilitäts-Squeeze / Seitwärts",
  UNRESOLVED_NEUTRAL: "Unklar / kein Regime",
};

const REGIME_DESCRIPTIONS: Record<MarketRegime, string> = {
  HIGH_VOLA_REVERSION:
    "Volatilität ist deutlich erhöht und der Preis weit von seinem 50-Perioden-Mittel entfernt — ein klassisches Erschöpfungs-/Reversion-Setup.",
  TREND_EXPANSION_BULLISH:
    "Starker, aufwärtsgerichteter Trend: ADX zeigt Trendstärke, +DI dominiert -DI, und die Regressionssteigung ist positiv.",
  TREND_EXPANSION_BEARISH:
    "Starker, abwärtsgerichteter Trend: ADX zeigt Trendstärke, -DI dominiert +DI, und die Regressionssteigung ist negativ.",
  VOLA_SQUEEZE_RANGING:
    "Schwacher Trend (niedriger ADX) bei gleichzeitig komprimierten Bollinger-Bändern — typische \"Coiling\"-Phase vor einem möglichen Ausbruch.",
  UNRESOLVED_NEUTRAL:
    "Die verfügbaren Signale stimmen nicht auf ein eindeutiges Regime überein (oder Kerndaten fehlen) — bewusst kein erfundenes Ergebnis.",
};

const REGIME_COLOR_CLASSES: Record<MarketRegime, string> = {
  HIGH_VOLA_REVERSION: "text-accent",
  TREND_EXPANSION_BULLISH: "text-up",
  TREND_EXPANSION_BEARISH: "text-down",
  VOLA_SQUEEZE_RANGING: "text-text-muted",
  UNRESOLVED_NEUTRAL: "text-text-faint",
};

export function regimeLabel(regime: MarketRegime): string {
  return REGIME_LABELS[regime];
}

export function regimeDescription(regime: MarketRegime): string {
  return REGIME_DESCRIPTIONS[regime];
}

export function regimeColorClass(regime: MarketRegime): string {
  return REGIME_COLOR_CLASSES[regime];
}

// true fuer die beiden gerichteten Trend-Regimes -- Hilfsfunktion fuer
// zukuenftige UI-Filter/Badges (z.B. "nur Trend-Phasen anzeigen").
export function isTrendingRegime(regime: MarketRegime): boolean {
  return regime === "TREND_EXPANSION_BULLISH" || regime === "TREND_EXPANSION_BEARISH";
}

// Confidence-Sperre fuer die Regime-Anzeige (Phase 4, Punkt 2 -- "Behalte
// dabei alle in Phase 1 integrierten Sicherheits-Regeln bei"). Dieselbe
// Schwelle wie MarketStateCard/lib/marketStateSummary.ts::
// isDirectionalLabelSuppressed, angewendet auf die beiden gerichteten
// Regimes: liegt die Confidence des primaeren NEXUS-Assessments (market_
// states.confidence) unter der Schwelle, wird TREND_EXPANSION_BULLISH/
// BEARISH hier NICHT als gerichtete Aussage angezeigt -- verhindert, dass
// das neue Regime-Panel dieselbe Richtungsaussage zeigt, die MarketStateCard
// im selben Moment bereits als "Unklar / kein Zustand" sperrt.
// VOLA_SQUEEZE_RANGING/HIGH_VOLA_REVERSION/UNRESOLVED_NEUTRAL sind keine
// gerichteten bullisch/baerisch-Aussagen und werden nie gesperrt.
//
// `marketStateConfidence` ist nullable, weil noch keine market_states-Zeile
// vorliegen kann (z.B. ganz frischer Deploy) -- in dem Fall wird defensiv
// NICHT gesperrt (kein Confidence-Wert zum Vergleichen vorhanden), das
// Regime selbst bleibt aber ohnehin UNRESOLVED_NEUTRAL, solange die
// zugrundeliegenden Saeulen-Werte fehlen (siehe regime.py).
export function shouldSuppressRegimeDirectionalLabel(
  regime: MarketRegime,
  marketStateConfidence: number | null
): boolean {
  if (!isTrendingRegime(regime)) return false;
  if (marketStateConfidence === null) return false;
  return marketStateConfidence < DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD;
}

// Engine-Divergenz: vergleicht die Richtungsaussage der beiden unabhaengigen
// Engines (Market State: additive 14-Faktoren-Summe, Regime Matrix:
// ADX/Steigungs-basierte 5-Saeulen-Klassifikation) direkt anhand ihrer
// gespeicherten Ground-Truth-Werte -- keine dritte, neu erfundene Kennzahl.
// Uneinigkeit zwischen unabhaengigen Modellen ist in der quantitativen
// Praxis selbst ein Signal (sinngemaess "Meta-Labeling", Lopez de Prado /
// Ensemble-Disagreement), keine Redundanz: macht sichtbar, was man sonst nur
// durch manuellen Abgleich beider Kacheln erkennen wuerde.
//
// NOT_COMPARABLE, sobald eine der beiden Engines keine gerichtete Aussage
// liefert (NEUTRAL/MIXED/INSUFFICIENT_DATA bzw. ein nicht-trendendes
// Regime) -- ein erzwungener Vergleich ohne zwei echte Richtungen waere kein
// Befund, sondern eine erfundene Aussage.
export type EngineDivergenceStatus = "AGREEMENT" | "DIVERGENCE" | "NOT_COMPARABLE";

function directionFromOverallState(
  overallState: MarketState["overall_state"]
): "BULLISH" | "BEARISH" | null {
  if (overallState === "BULLISH") return "BULLISH";
  if (overallState === "BEARISH") return "BEARISH";
  return null;
}

function directionFromRegime(regime: MarketRegime): "BULLISH" | "BEARISH" | null {
  if (regime === "TREND_EXPANSION_BULLISH") return "BULLISH";
  if (regime === "TREND_EXPANSION_BEARISH") return "BEARISH";
  return null;
}

export function computeEngineDivergence(
  overallState: MarketState["overall_state"] | null,
  regime: MarketRegime | null
): EngineDivergenceStatus {
  if (overallState === null || regime === null) return "NOT_COMPARABLE";
  const marketStateDirection = directionFromOverallState(overallState);
  const regimeDirection = directionFromRegime(regime);
  if (marketStateDirection === null || regimeDirection === null) return "NOT_COMPARABLE";
  return marketStateDirection === regimeDirection ? "AGREEMENT" : "DIVERGENCE";
}
