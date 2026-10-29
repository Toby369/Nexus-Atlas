// Termin-Basis (annualisiert) des vordersten Deribit-Futures gegen den
// Deribit-Index -- Naeherung fuer die CME-Basis. Zeigt, wie viel Anleger
// fuer gehebeltes Long-Exposure auf Termin zahlen, und wie attraktiv der
// Basis-Trade (Spot/ETF kaufen, Future verkaufen) gerade ist.
//
// Stufen sind Faustregeln aus der CME-Basis-Historie seit Einfuehrung der
// Spot-ETFs, keine im Backtest validierten Signale. Daten in
// term_basis_snapshots (supabase/functions/collect-term-basis).

export const TERM_BASIS_WEAK_PCT = 5;
export const TERM_BASIS_ELEVATED_PCT = 10;
export const TERM_BASIS_HOT_PCT = 15;
// Ab diesem Rueckgang in Prozentpunkten ueber 7 Tage gilt die Basis als
// "deutlich fallend" -- Groessenordnung, ab der Basis-Trades sichtbar
// unattraktiver werden.
export const TERM_BASIS_DROP_PP = 2;

export type TermBasisLevelId = "backwardation" | "weak" | "normal" | "elevated" | "hot";
export type TermBasisTone = "calm" | "watch" | "risk";

export interface TermBasisLevel {
  id: TermBasisLevelId;
  label: string;
  tone: TermBasisTone;
  hint: string;
}

const LEVELS: Record<TermBasisLevelId, Omit<TermBasisLevel, "id">> = {
  backwardation: {
    label: "Negativ",
    tone: "risk",
    hint: "Termin unter Spot: Stress, Absicherung nach unten dominiert.",
  },
  weak: {
    label: "Schwach",
    tone: "watch",
    hint: "Wenig Nachfrage nach Long-Exposure; Basis-Trades lohnen kaum und werden eher aufgelöst.",
  },
  normal: { label: "Normal", tone: "calm", hint: "Übliche Prämie, keine Überhitzung." },
  elevated: { label: "Erhöht", tone: "watch", hint: "Spürbare Nachfrage nach gehebeltem Long-Exposure." },
  hot: {
    label: "Überhitzt",
    tone: "risk",
    hint: "Sehr teures Long-Exposure; historisch oft in späten Rally-Phasen.",
  },
};

export function classifyTermBasis(annualizedPct: number): TermBasisLevel {
  let id: TermBasisLevelId;
  if (annualizedPct < 0) id = "backwardation";
  else if (annualizedPct < TERM_BASIS_WEAK_PCT) id = "weak";
  else if (annualizedPct < TERM_BASIS_ELEVATED_PCT) id = "normal";
  else if (annualizedPct < TERM_BASIS_HOT_PCT) id = "elevated";
  else id = "hot";
  return { id, ...LEVELS[id] };
}

export interface TermBasisPoint {
  t: number; // ms
  annualizedPct: number;
}

/** Wert, der zeitlich am naechsten an (latest - days) liegt, aber nicht danach. */
export function valueDaysAgo(points: TermBasisPoint[], days: number): number | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const target = sorted[sorted.length - 1].t - days * 24 * 60 * 60 * 1000;
  let best: TermBasisPoint | null = null;
  for (const p of sorted) {
    if (p.t <= target) best = p;
    else break;
  }
  return best?.annualizedPct ?? null;
}

export interface TermBasisSummary {
  current: number;
  level: TermBasisLevel;
  change7dPp: number | null;
  /** Basis faellt deutlich UND ETFs fliessen netto ab -> moeglicher Basis-Trade-Abbau. */
  possibleUnwind: boolean;
}

export function summarizeTermBasis(points: TermBasisPoint[], etfNetFlow5dUsdM: number | null): TermBasisSummary | null {
  if (points.length === 0) return null;
  const sorted = [...points].sort((a, b) => a.t - b.t);
  const current = sorted[sorted.length - 1].annualizedPct;
  const weekAgo = valueDaysAgo(sorted, 7);
  const change7dPp = weekAgo === null ? null : current - weekAgo;
  return {
    current,
    level: classifyTermBasis(current),
    change7dPp,
    possibleUnwind:
      change7dPp !== null && change7dPp <= -TERM_BASIS_DROP_PP && etfNetFlow5dUsdM !== null && etfNetFlow5dUsdM < 0,
  };
}
