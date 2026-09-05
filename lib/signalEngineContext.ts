// Kontext-Builder fuer die Signal-Engine-Kachel (Thema KI, Punkt 2/2,
// 05.09.2026) -- zweite ueber runTileAnalysis() aktivierte Kachel, mit
// Anthropic als primaerem Provider (siehe lib/ai/tileConfig.ts
// "signal-engine" -> "auto" -> "signal-logic"-Kategorie -> Anthropic,
// Fallback DeepSeek).
//
// Aufgabe dieser Kachel: ein unabhaengiges "zweites Paar Augen" auf die
// bereits bestehende, regelbasierte Gesamteinschaetzung (market_states,
// compute-market-state) -- prueft NICHT neu, ob der Markt bullisch/baerisch
// ist (das macht die 14-Faktoren-Engine bereits), sondern ob deren eigene
// Ausgabe (overall_state/score/confidence/risk_level/patterns) in sich
// logisch konsistent mit den einzelnen Faktor-Werten ist. Eigenstaendig von
// Handelslage (kurze Stunden-Einschaetzung) und Divergenz-Radar
// (paarweise regelbasierte Vergleiche) -- diese Kachel liest ausschliesslich
// die 14 Faktoren selbst.
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

import { supabase } from "./supabase";
import { computeConfidenceBreakdown } from "./marketStateSummary";
import type { MarketState } from "./types";

type StateRow = Pick<
  MarketState,
  "timestamp_utc" | "factors" | "overall_state" | "score" | "confidence" | "data_coverage_pct" | "risk_level" | "risk_factors" | "patterns"
>;

export interface SignalEngineContext {
  timestamp_utc: string;
  overall_state: MarketState["overall_state"];
  score: number | null;
  confidence: number;
  confidence_breakdown: {
    coverage_pct: number;
    consensus_pct: number | null;
    signal_strength_pct: number;
  };
  risk_level: MarketState["risk_level"];
  risk_factors: string[] | null;
  patterns: MarketState["patterns"];
  // Je Faktor nur Name + Wert + Basis -- dieselbe Rohform wie market_states.factors,
  // keine Neuberechnung.
  factors: MarketState["factors"];
}

/** Liest die neueste market_states-Zeile, oder null wenn (noch) keine existiert. */
export async function buildSignalEngineContext(): Promise<SignalEngineContext | null> {
  const { data: stateRows } = await supabase
    .from("market_states")
    .select(
      "timestamp_utc, factors, overall_state, score, confidence, data_coverage_pct, risk_level, risk_factors, patterns"
    )
    .order("timestamp_utc", { ascending: false })
    .limit(1);

  const state = stateRows?.[0] as StateRow | undefined;
  if (!state) return null;

  const breakdown = computeConfidenceBreakdown(state);

  return {
    timestamp_utc: state.timestamp_utc,
    overall_state: state.overall_state,
    score: state.score,
    confidence: state.confidence,
    confidence_breakdown: {
      coverage_pct: breakdown.coveragePct,
      consensus_pct: breakdown.consensusPct,
      signal_strength_pct: breakdown.signalStrengthPct,
    },
    risk_level: state.risk_level,
    risk_factors: state.risk_factors,
    patterns: state.patterns,
    factors: state.factors,
  };
}
