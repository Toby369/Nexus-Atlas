import type { MarketRegime, MarketState } from "./types";

// Kompakte Textdarstellung der NEXUS-Assessment-SSOT (market_states,
// compute-market-state) fuer den "Kurznotiz"-Slot in LivePricePanel.tsx.
//
// Ersetzt die vorher eigenstaendige, regelbasierte Kurznotiz-Generierung
// (collect-btc's frueherer "Markteinschaetzung"-Block, nur Bybit-Preis/OI/
// Funding, eigene feste Schwellenwerte, market_commentary-Tabelle) --
// diese Funktion erzeugt KEINE eigene Einschaetzung, sie fasst nur die
// bereits vorhandenen 14-Faktoren-Werte aus market_states in einem Satz
// zusammen. Ein einziger Rechenweg fuer "wie steht der Markt gerade da" --
// Kurznotiz und Gesamteinschätzung koennen sich dadurch nicht mehr
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
      `Datenabdeckung unter den 14 Faktoren. Details siehe „Gesamteinschätzung" oben.`
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
  text += " Basis: 14-Faktoren-Engine (Gesamteinschätzung) — keine Anlageberatung.";
  return text;
}

// --- Confidence-Aufspaltung (Institutional-Grade-Professionalisierung,
// Punkt 2: "unkalibrierte Confidence im UI in Coverage, Consensus und
// Signal Strength aufspalten") -----------------------------------------
//
// compute-market-state (Edge Function) berechnet Confidence als
// `(Coverage/100) * (|Score|/n_verfuegbar) * 100`. Das vermischt zwei
// unabhaengige Ursachen fuer eine niedrige Zahl: (a) viele verfuegbare
// Faktoren sind schlicht NEUTRAL (kein Rauschen, kein Widerspruch -- nur
// keine Aussage), und (b) die Faktoren, die eine Richtung zeigen,
// widersprechen sich tatsaechlich. Ein Nutzer kann diese beiden Faelle aus
// der einen Zahl nicht unterscheiden.
//
// Diese Funktion zerlegt dieselbe Formel exakt (keine neue Kennzahl,
// keine Aenderung der gespeicherten Confidence) in drei unabhaengig
// interpretierbare Anteile:
//   - Coverage: identisch mit state.data_coverage_pct (wie viele der 14
//     Faktoren ueberhaupt Daten haben).
//   - Signal Strength: Anteil der VERFUEGBAREN Faktoren, die ueberhaupt
//     eine Richtung zeigen (nicht neutral) -- macht sichtbar, wie stark
//     die Confidence durch reine Neutralitaet verduennt ist.
//   - Consensus: von den Faktoren, die eine Richtung zeigen, wie viele
//     stimmen mit der Mehrheitsrichtung ueberein (100% = einstimmig,
//     50% = genau haelftig gespalten) -- macht den eigentlichen
//     Widerspruch sichtbar, getrennt von reiner Neutralitaet.
// Rechnerisch gilt: Confidence = Coverage * SignalStrength * |2*Consensus-1|
// * 100 (Betrag, da Consensus < 50% durch die max()-Definition nicht
// vorkommt) -- die drei Anteile rekonstruieren also exakt den bestehenden
// Wert, machen aber sichtbar, WARUM er niedrig oder hoch ist.
export interface ConfidenceBreakdown {
  coveragePct: number;
  // null, wenn kein einziger verfuegbarer Faktor eine Richtung zeigt (alle
  // neutral oder keine Faktoren verfuegbar) -- kein erfundener Wert.
  consensusPct: number | null;
  signalStrengthPct: number;
}

export function computeConfidenceBreakdown(
  state: Pick<MarketState, "data_coverage_pct" | "factors">
): ConfidenceBreakdown {
  const values = Object.values(state.factors ?? {})
    .map((f) => f.value)
    .filter((v): v is -1 | 0 | 1 => v !== null);

  if (values.length === 0) {
    return { coveragePct: state.data_coverage_pct, consensusPct: null, signalStrengthPct: 0 };
  }

  const positiveCount = values.filter((v) => v === 1).length;
  const negativeCount = values.filter((v) => v === -1).length;
  const directionalCount = positiveCount + negativeCount;

  return {
    coveragePct: state.data_coverage_pct,
    signalStrengthPct: (directionalCount / values.length) * 100,
    consensusPct:
      directionalCount === 0
        ? null
        : (Math.max(positiveCount, negativeCount) / directionalCount) * 100,
  };
}

// --- Engine Divergence (Institutional-Grade-Professionalisierung, Sprint
// B: Meta-Signal aus dem Vergleich der beiden unabhaengigen Engines) -----
//
// Vergleicht die Richtungsaussage von Market State (14-Faktoren-Summe,
// overall_state) und Regime Matrix (5-Saeulen-ADX/Steigungs-Klassifikation,
// regime) direkt anhand ihrer gespeicherten Ground-Truth-Werte -- keine
// dritte, neu erfundene Kennzahl. Uneinigkeit zwischen unabhaengigen
// Modellen ist in der quantitativen Praxis selbst ein Signal (sinngemaess
// "Meta-Labeling", Lopez de Prado / Ensemble-Disagreement), keine
// Redundanz: macht sichtbar, was man sonst nur durch manuellen Abgleich
// beider Kacheln erkennen wuerde (siehe docs/research/
// METHODIC_DIVERGENCE_2026-08-29.md fuer die auslösende Fallstudie).
//
// NOT_COMPARABLE, sobald eine der beiden Engines keine gerichtete Aussage
// liefert (NEUTRAL/MIXED/INSUFFICIENT_DATA bzw. ein nicht-trendendes
// Regime) -- ein erzwungener Vergleich ohne zwei echte Richtungen waere
// kein Befund, sondern eine erfundene Aussage.
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

// Fester UI-Status-Text (Vorgabe Sprint B) fuer den High-Severity-Fall --
// nur bei tatsaechlicher Divergenz, nie bei Uebereinstimmung oder fehlender
// Vergleichbarkeit (dort gibt es nichts zu warnen).
export const ENGINE_DIVERGENCE_HIGH_LABEL = "Regime Transition / Engine Divergence HIGH";

export function engineDivergenceStatusLabel(status: EngineDivergenceStatus): string | null {
  return status === "DIVERGENCE" ? ENGINE_DIVERGENCE_HIGH_LABEL : null;
}
