import type { MarketState } from "./types";

// Kompakte Textdarstellung der NEXUS-Assessment-SSOT (market_states,
// compute-market-state) fuer den "Kurznotiz"-Slot in LivePricePanel.tsx.
//
// Ersetzt die vorher eigenstaendige, regelbasierte Kurznotiz-Generierung
// (collect-btc's frueherer "Markteinschaetzung"-Block, nur Bybit-Preis/OI/
// Funding, eigene feste Schwellenwerte, market_commentary-Tabelle) --
// diese Funktion erzeugt KEINE eigene Einschaetzung, sie fasst nur die
// bereits vorhandenen 14-Faktoren-Werte aus market_states in einem Satz
// zusammen. Ein einziger Rechenweg fuer "wie steht der Markt gerade da" --
// Kurznotiz und NEXUS Assessment koennen sich dadurch nicht mehr
// widersprechen, weil es nur noch eine Quelle gibt.

// Confidence-Gate fuer die Richtungs-Label BULLISH/BEARISH (Phase 1, Punkt
// 3.1 -- Q3 mit "Option A: nur Anzeige-Ebene" beantwortet). compute-
// market-state (Edge Function) und die gespeicherte market_states-Historie
// bleiben UNVERAENDERT -- der rohe, ehrliche Zustand ist die Ground-Truth
// fuer die gesamte Backtest-/Modell-Pipeline (Phase 5/6) und darf dafuer
// nicht nachtraeglich uminterpretiert werden. Diese Schwelle wirkt
// ausschliesslich hier, an der einzigen Stelle, die den gespeicherten
// overall_state in einen ANZEIGE-Text/Label uebersetzt (buildCompactMarketStateSummary
// fuer Kurznotiz, isDirectionalLabelSuppressed fuer MarketStateCard.tsx) --
// beide muessen dieselbe Schwelle verwenden, sonst koennten sie wieder
// auseinanderlaufen (genau das Problem, das der SSOT-Merge oben beheben sollte).
export const DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD = 35;
export const UNCLEAR_STATE_LABEL = "Unklar / kein Zustand";

export function isDirectionalLabelSuppressed(
  state: Pick<MarketState, "overall_state" | "confidence">
): boolean {
  return (
    (state.overall_state === "BULLISH" || state.overall_state === "BEARISH") &&
    state.confidence < DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD
  );
}

const STATE_TEXT: Record<MarketState["overall_state"], string> = {
  BULLISH: "bullisch",
  BEARISH: "bärisch",
  NEUTRAL: "neutral",
  MIXED: "uneinheitlich (gemischte Faktoren)",
  INSUFFICIENT_DATA: "aktuell nicht auswertbar (zu wenig Daten)",
};

const RISK_TEXT: Record<string, string> = {
  LOW: "niedrig",
  MEDIUM: "mittel",
  HIGH: "hoch",
};

export function buildCompactMarketStateSummary(state: MarketState): string {
  if (state.overall_state === "INSUFFICIENT_DATA") {
    return (
      `Marktzustand aktuell nicht auswertbar — nur ${state.data_coverage_pct.toFixed(0)}% ` +
      `Datenabdeckung unter den 14 Faktoren. Details siehe „NEXUS Assessment" oben.`
    );
  }

  const suppressed = isDirectionalLabelSuppressed(state);
  const stateText = suppressed
    ? `${UNCLEAR_STATE_LABEL.toLowerCase()} (Confidence unter ${DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD}/100 für eine Richtungsaussage)`
    : STATE_TEXT[state.overall_state];
  const riskText = state.risk_level && state.risk_level !== "UNKNOWN" ? RISK_TEXT[state.risk_level] : null;
  const topPattern = state.patterns.length > 0 ? state.patterns[0].name : null;

  let text =
    `Marktzustand ${stateText} bei ${state.confidence}/100 Confidence ` +
    `(${state.data_coverage_pct.toFixed(0)}% Datenabdeckung).`;
  if (topPattern) {
    text += ` Muster: „${topPattern}".`;
  }
  if (riskText) {
    text += ` Risk: ${riskText}.`;
  }
  text += " Basis: 14-Faktoren-Engine (NEXUS Assessment) — keine Anlageberatung.";
  return text;
}
