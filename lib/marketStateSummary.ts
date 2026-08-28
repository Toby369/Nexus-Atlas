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

  const stateText = STATE_TEXT[state.overall_state];
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
