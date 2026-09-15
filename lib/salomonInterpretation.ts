import type { MarketStatePattern, MarketStateMtfAlignment } from "@/lib/types";

// Salomon-Interpretationsschicht (Nutzer-Wunsch 15.09.2026: "salomon in
// nexus integrieren"). Uebersetzt bereits vorhandene, live berechnete
// NEXUS-Patterns/MTF-Alignment (aus market_states, geschrieben von
// compute-market-state) in Stefan Salomons Phasenmodell-Sprache
// (Akkumulation/Markup/Distribution/Markdown) -- siehe Mapping-Tabelle in
// knowledge_base (module='salomon', section='Salomon-Interpretationsschicht').
//
// Bewusst eine REINE Funktion, kein neues Feld/keine neue Tabelle: alle
// benoetigten Rohdaten (patterns, mtf_alignment) existieren schon in
// market_states, die Interpretation ist reine Textuebersetzung derselben
// Werte -- keine zweite, unabhaengige Berechnung. Regelbasiert, kein
// LLM-Call, passend zur bestehenden "kein Black-Box-Score"-Philosophie
// (siehe compute-market-state-Kommentar). Wiederverwendbar sowohl fuer die
// UI (HeroHeader-Pattern-Badges) als auch als Kontext-Baustein fuer
// bestehende AI-Kacheln (Trade-Debate).
//
// Mapping-Prioritaet bei mehreren gleichzeitig aktiven Patterns: Capitulation
// > Distribution Warning > Fragile Bullish > Bullish Confirmation -- die
// "spaetere" Zyklusphase ist informativer als eine frueher im Zyklus
// stehende gleichzeitig erkannte Konfirmation.
const PATTERN_TO_PHASE: Record<string, { phase: string; sentence: string }> = {
  "Bullish Confirmation": {
    phase: "Markup (gesund)",
    sentence:
      "Trend in gesunder Markup-Phase nach Salomon — Struktur, Orderflow und Positionsaufbau bestätigen sich gegenseitig.",
  },
  "Fragile Bullish": {
    phase: "Beginnende Distribution innerhalb Markup",
    sentence:
      "Struktur zeigt noch Markup, doch der nachlassende Orderflow ist nach Salomon ein frühes Distributionssignal.",
  },
  "Distribution Warning": {
    phase: "Distribution",
    sentence:
      "Preis nahe Zyklushoch bei fallendem Orderflow — klassisches Distributionsmuster nach Salomon, Markdown-Risiko steigt.",
  },
  Capitulation: {
    phase: "Ende Markdown / möglicher Boden",
    sentence:
      "Überverkaufte Lage mit hohen Liquidationen — typisches Kapitulationsende einer Markdown-Phase nach Salomon.",
  },
};

const PATTERN_PRIORITY = ["Capitulation", "Distribution Warning", "Fragile Bullish", "Bullish Confirmation"];

const MTF_CONFLUENCE_THRESHOLD_PCT = 80;

export interface SalomonInterpretation {
  phase: string;
  sentence: string;
}

/**
 * Leitet aus den bereits vorhandenen NEXUS-Patterns und dem MTF-Alignment
 * eine Salomon-Phasen-Einordnung ab. Gibt null zurueck, wenn keines der
 * gemappten Patterns aktiv ist UND das MTF-Alignment die Konfluenz-Schwelle
 * nicht erreicht -- lieber keine Aussage als eine erfundene.
 */
export function getSalomonInterpretation(
  patterns: MarketStatePattern[],
  mtfAlignment: MarketStateMtfAlignment | null
): SalomonInterpretation | null {
  const activeNames = new Set(patterns.map((p) => p.name));
  for (const name of PATTERN_PRIORITY) {
    if (activeNames.has(name)) return PATTERN_TO_PHASE[name];
  }

  if (mtfAlignment && mtfAlignment.alignment_pct > MTF_CONFLUENCE_THRESHOLD_PCT) {
    return {
      phase: "Multi-Timeframe-Konfluenz",
      sentence: "Alle relevanten Zeitrahmen bestätigen dieselbe Richtung — hohe Konfluenz nach Salomon.",
    };
  }

  return null;
}
