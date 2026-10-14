// TP-Standard nach Abstand zum naechsten Keylevel (Tobys Regelwerk,
// 14.10.2026): gewaehlt wird der groesste Standard, dessen TP noch VOR dem
// naechsten Widerstand (Long) bzw. der naechsten Unterstuetzung (Short)
// liegt. Liegt das Level naeher als 1,0 %, gilt "kein Trade" (CRV unter 2:1
// bei SL -0,5 %). Parameter der Standards: knowledge_base "Toby Setup -- 4
// Standards" (20x Hebel, SL 10 % Marge, TP 20-35 % Marge).

export interface TpStandard {
  id: 1 | 2 | 3 | 4;
  /** TP als Kursbewegung in Prozent. */
  tpPct: number;
  /** TP in Prozent der Marge (20x Hebel). */
  marginPct: number;
  crv: number;
}

// Groesster TP zuerst -- suggestTpStandard nimmt den ersten, der passt.
export const TP_STANDARDS: TpStandard[] = [
  { id: 1, tpPct: 1.75, marginPct: 35, crv: 3.5 },
  { id: 2, tpPct: 1.5, marginPct: 30, crv: 3 },
  { id: 3, tpPct: 1.25, marginPct: 25, crv: 2.5 },
  { id: 4, tpPct: 1.0, marginPct: 20, crv: 2 },
];

export function suggestTpStandard(distancePct: number): TpStandard | null {
  return TP_STANDARDS.find((s) => s.tpPct <= distancePct) ?? null;
}

export interface TpSuggestion {
  side: "long" | "short";
  /** Naechster Widerstand (Long) bzw. naechste Unterstuetzung (Short), null wenn keiner bekannt. */
  levelPrice: number | null;
  /** Abstand in Prozent, immer positiv. */
  distancePct: number | null;
  /** null = kein Trade (Level zu nah) oder kein Level bekannt (levelPrice null). */
  standard: TpStandard | null;
}

/**
 * Levels naeher als die Retest-Toleranz (Regelwerk: 1H-Retest bis +/-0,25 %)
 * sind das Einstiegs-Level selbst, nicht das Ziel -- sie werden uebersprungen.
 */
export const ENTRY_LEVEL_TOLERANCE_PCT = 0.25;

// Nur Levels auf der richtigen Seite des aktuellen Kurses zaehlen -- die
// Einordnung "resistance"/"support" stammt vom Zeitpunkt der Berechnung,
// der Live-Preis kann inzwischen darueber/darunter liegen.
export function computeTpSuggestions(
  levels: { price: number; side: "resistance" | "support" }[],
  price: number | null
): TpSuggestion[] {
  if (price === null || price <= 0) return [];
  const minGap = price * (ENTRY_LEVEL_TOLERANCE_PCT / 100);
  const above = levels.filter((l) => l.price > price + minGap).sort((a, b) => a.price - b.price)[0] ?? null;
  const below = levels.filter((l) => l.price < price - minGap).sort((a, b) => b.price - a.price)[0] ?? null;
  const build = (side: "long" | "short", level: { price: number } | null): TpSuggestion => {
    if (!level) return { side, levelPrice: null, distancePct: null, standard: null };
    const distancePct = (Math.abs(level.price - price) / price) * 100;
    return { side, levelPrice: level.price, distancePct, standard: suggestTpStandard(distancePct) };
  };
  return [build("long", above), build("short", below)];
}

/** Kurztext, z.B. "Long → Widerstand 83'750 (+1,4 %) → Standard 3". */
export function formatTpSuggestion(s: TpSuggestion): string {
  const sideLabel = s.side === "long" ? "Long" : "Short";
  if (s.levelPrice === null || s.distancePct === null) {
    return `${sideLabel} → ${s.side === "long" ? "kein Widerstand" : "keine Unterstützung"} bekannt`;
  }
  const levelLabel = s.side === "long" ? "Widerstand" : "Unterstützung";
  const price = s.levelPrice.toLocaleString("de-CH", { maximumFractionDigits: 0 });
  const dist = `${s.side === "long" ? "+" : "−"}${s.distancePct.toFixed(1)} %`;
  const verdict = s.standard ? `Standard ${s.standard.id} (TP ${s.standard.marginPct} %)` : "kein Trade (< 1 %)";
  return `${sideLabel} → ${levelLabel} ${price} (${dist}) → ${verdict}`;
}
