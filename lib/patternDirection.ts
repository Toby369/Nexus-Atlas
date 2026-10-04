// Richtung je benanntem Warn-Muster (compute-market-state Edge Function,
// market_states.patterns) -- ausgelagert aus components/HeroHeader.tsx
// (03.10.2026), wo diese Zuordnung urspruenglich stand, weil
// lib/levelStructureContext.ts dieselbe Zuordnung fuer den Signal-Abgleich
// braucht. Beide liegen im selben Next.js-Repo (kein Cross-Runtime-Grund
// fuer eine Kopie wie bei den Supabase Edge Functions) -- ein gemeinsamer
// Import statt einer zweiten Kopie.
//
// Die Edge Function selbst speichert keine Richtung je Pattern, nur
// name+note -- diese geschlossene Namensmenge ist dort als
// RISK_ELEVATING_PATTERNS dupliziert (gleiches Duplizierungs-Muster wie
// andere Edge-Function-Konstanten im Next.js-Repo, siehe z.B.
// send-state-change-push). Richtung = wohin das Muster deutet, nicht die
// reine Namens-Herkunft: "Fragile Bullish"/"Distribution Warning" warnen
// TROTZ bullischer Oberflaeche vor baerischer Schwaeche/Umkehr,
// "Capitulation" beschreibt eine laufende baerische Erschoepfung (keine
// erfundene Boden-Prognose), "Short Squeeze" deutet auf einen bullischen
// Squeeze nach oben.
export const PATTERN_DIRECTION: Record<string, "bullish" | "bearish"> = {
  "Bullish Confirmation": "bullish",
  "Fragile Bullish": "bearish",
  "Distribution Warning": "bearish",
  Capitulation: "bearish",
  "Short Squeeze": "bullish",
};

// Dieselbe Namensmenge wie RISK_ELEVATING_PATTERNS in compute-market-state
// (Edge Function) -- jedes dieser Muster loest dort IMMER den
// "warning_pattern"-Risk-Factor aus. "Bullish Confirmation" ist NICHT in
// dieser Menge (kein Risk-Factor).
export const RISK_ELEVATING_PATTERN_NAMES = new Set([
  "Fragile Bullish",
  "Distribution Warning",
  "Capitulation",
  "Short Squeeze",
]);

export const PATTERN_DIRECTION_LABEL: Record<"bullish" | "bearish", string> = {
  bullish: "bullisch",
  bearish: "bärisch",
};
