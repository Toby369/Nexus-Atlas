import type { MarketRegime } from "@/lib/types";

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
