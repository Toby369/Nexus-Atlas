import type { MarketRegime, OiPriceQuadrant } from "@/lib/types";
import { DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD } from "@/lib/marketStateSummary";

// Engine-Divergenz lebt in lib/marketStateSummary.ts (Institutional-Grade-
// Professionalisierung, Sprint B) -- hier nur re-exportiert, damit
// bestehende Importe (`@/lib/marketRegime`) unveraendert funktionieren.
export {
  computeEngineDivergence,
  type EngineDivergenceStatus,
  ENGINE_DIVERGENCE_HIGH_LABEL,
  engineDivergenceStatusLabel,
} from "@/lib/marketStateSummary";

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

// Pro-Kennzahl Richtungs-Badges fuer die aufgeklappte Saeulen-Ansicht in
// RegimeMatrixCard.tsx (gleiches Bedarfsmuster wie factorColor/factorLabel
// in MarketStateCard.tsx fuer die 14 Faktoren, hier auf die rohen 5-Saeulen-
// Kennzahlen uebertragen). Absichtlich NICHT auf jede Kennzahl angewendet:
// reine Magnitude-/Volatilitaets-Werte (Garman-Klass Vol, Bollinger-Breite,
// ATR-Ratio, R², Liq.-Cluster-Density) und OI-Delta allein (richtungslos
// ohne Preis-Kontext, dafuer existiert der separate OI/Preis-Quadrant) haben
// keine Richtung und bleiben unbadged statt eine erfundene zu zeigen.
export type SignalDirection = "up" | "down" | "neutral";

export const SIGNAL_DIRECTION_LABEL: Record<SignalDirection, string> = {
  up: "bullisch",
  down: "bärisch",
  neutral: "neutral",
};

export const SIGNAL_DIRECTION_COLOR: Record<SignalDirection, string> = {
  up: "text-up",
  down: "text-down",
  neutral: "text-text-faint",
};

// Trend-Verdikt fuer ADX/+DI/-DI/Regressionssteigung: dieselben drei
// Kennzahlen wirken in classify_market_regime() (research-python/src/
// regime.py) ohnehin nur GEMEINSAM richtungsbestimmend -- deshalb hier ein
// einzelnes Verdikt statt drei unabhaengig geratener Einzel-Badges, mit
// demselben adx_trend_threshold=25 (RegimeThresholds in regime.py).
export function trendVerdict(
  adx: number | null,
  plusDi: number | null,
  minusDi: number | null,
  slope: number | null
): SignalDirection {
  if (adx === null || plusDi === null || minusDi === null || slope === null) return "neutral";
  if (adx >= 25 && plusDi > minusDi && slope > 0) return "up";
  if (adx >= 25 && minusDi > plusDi && slope < 0) return "down";
  return "neutral";
}

// Generischer Vorzeichen-Badge mit Totzone (deadband) gegen Rauschen um
// null herum -- fuer Kennzahlen, deren Vorzeichen unumstritten eine
// Richtung anzeigt (Distanz-Z-Scores, Funding-/CVD-Z-Score, Preis-Δ,
// Net-Taker-Flow): positiv = ueber dem Referenzpunkt/mehr Kaeuferdruck,
// negativ = umgekehrt.
export function signDirection(value: number | null, deadband = 0): SignalDirection {
  if (value === null) return "neutral";
  if (value > deadband) return "up";
  if (value < -deadband) return "down";
  return "neutral";
}

// RSI um die Mittellinie (50): oberhalb = Momentum tendenziell bullisch,
// unterhalb = baerisch -- bewusst NICHT die klassische "70=overbought/
// 30=oversold"-Reversion-Lesart (die ist gegenteilig gerichtet und in der
// Praxis umstritten, siehe RSI/MACD-Divergenz-Signal in docs/tradingview/,
// das explizit auf dieser Ambiguitaet aufbaut). Deadband 45-55 gegen
// Rauschen nahe der Mittellinie.
export function rsiDirection(rsi: number | null): SignalDirection {
  if (rsi === null) return "neutral";
  if (rsi > 55) return "up";
  if (rsi < 45) return "down";
  return "neutral";
}

// Bollinger %b: Position des Preises innerhalb der Baender (0 = unteres
// Band, 1 = oberes Band). >0.8/<0.2 als "nahe/ueber dem jeweiligen Band".
export function bbPercentBDirection(bbPercentB: number | null): SignalDirection {
  if (bbPercentB === null) return "neutral";
  if (bbPercentB > 0.8) return "up";
  if (bbPercentB < 0.2) return "down";
  return "neutral";
}

// OI/Preis-Quadrant-Semantik (dieselbe Taxonomie wie InstitutionalPlaybook-
// Card/QUADRANT_LABELS in RegimeMatrixCard.tsx): Long-Aufbau/Short-Covering
// sind beide preistreibend nach oben, Short-Aufbau/Long-Abbau nach unten.
export function quadrantDirection(quadrant: OiPriceQuadrant | null): SignalDirection {
  if (quadrant === "long_buildup" || quadrant === "short_covering") return "up";
  if (quadrant === "short_buildup" || quadrant === "long_unwind") return "down";
  return "neutral";
}
