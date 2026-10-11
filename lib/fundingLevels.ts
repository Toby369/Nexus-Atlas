// Stufen-Einordnung der Funding-Rate, damit die Funding-Kachel nicht nur
// eine nackte Zahl zeigt, sondern sagt, ob sie normal, erhoeht oder extrem
// ist. Rechnet intern in Prozent pro 8 Stunden: das ist das Abrechnungs-
// intervall der grossen Boersen fuer BTCUSDT-Perps und die Basis, auf der
// die ueblichen Faustregeln formuliert sind.
//
// 0,01 % pro 8 h ist der Standardwert (Zinskomponente) bei Binance/Bybit
// und damit der Ruhezustand, nicht "leicht bullisch". Die Extrem-Schwelle
// 0,05 % ist dieselbe wie FUNDING_EXTREME_THRESHOLD in compute-market-state
// und in Tobys Mein-System-Checkliste. Die uebrigen Stufen sind Faustregeln,
// keine backtest-validierten Signale (siehe phase6-factor-diagnostics.md:
// Funding hat im Backtest-Zeitraum keine Datenabdeckung).

export const FUNDING_BASELINE_PCT = 0.01;
export const FUNDING_ELEVATED_PCT = 0.03;
export const FUNDING_EXTREME_PCT = 0.05;
export const FUNDING_EUPHORIA_PCT = 0.1;

const INTERVALS_PER_YEAR_8H = 3 * 365;

export type FundingLevelId =
  | "extreme_negative"
  | "negative"
  | "slightly_negative"
  | "neutral"
  | "elevated"
  | "high"
  | "extreme"
  | "euphoria";

// "calm" = kein Handlungsbedarf, "watch" = beobachten, "risk" = Crowding
// mit erhoehter Squeeze-Gefahr (in beide Richtungen).
export type FundingTone = "calm" | "watch" | "risk";

export interface FundingLevel {
  id: FundingLevelId;
  label: string;
  tone: FundingTone;
  hint: string;
}

const LEVELS: Record<FundingLevelId, Omit<FundingLevel, "id">> = {
  extreme_negative: {
    label: "Extrem negativ",
    tone: "risk",
    hint: "Shorts überfüllt, Gefahr eines Short-Squeeze.",
  },
  negative: { label: "Negativ", tone: "watch", hint: "Shorts dominieren." },
  slightly_negative: { label: "Leicht negativ", tone: "calm", hint: "Leichter Short-Überhang." },
  neutral: { label: "Neutral", tone: "calm", hint: "Ruhezustand, Standardwert der Börsen." },
  elevated: { label: "Erhöht", tone: "watch", hint: "Long-lastig, typisch im Aufwärtstrend." },
  high: { label: "Hoch", tone: "watch", hint: "Deutliches Long-Crowding." },
  extreme: {
    label: "Extrem",
    tone: "risk",
    hint: "Longs überfüllt, Gefahr eines Long-Squeeze.",
  },
  euphoria: {
    label: "Euphorie",
    tone: "risk",
    hint: "Ausnahmezustand, hohe Gefahr eines Long-Squeeze.",
  },
};

// Rundung gegen Gleitkomma-Artefakte: 0.0001 * 100 ergibt 0.010000000000000002
// und wuerde sonst knapp ueber der Neutral-Grenze landen.
function roundPct(pct: number): number {
  return Math.round(pct * 1e6) / 1e6;
}

/** Rechnet eine Rate (Bruch, z.B. 0.0001) mit beliebigem Intervall auf % pro 8 h um. */
export function fundingPctPer8h(rate: number, intervalHours = 8): number {
  return roundPct(rate * 100 * (8 / intervalHours));
}

/** Hochgerechnete Jahresrate in %, ohne Zinseszins (so rechnen auch die Börsen). */
export function fundingAnnualizedPct(ratePer8hPct: number): number {
  return ratePer8hPct * INTERVALS_PER_YEAR_8H;
}

export function classifyFundingPct(pctPer8h: number): FundingLevel {
  const pct = roundPct(pctPer8h);
  let id: FundingLevelId;
  if (pct <= -FUNDING_EXTREME_PCT) id = "extreme_negative";
  else if (pct < -FUNDING_BASELINE_PCT) id = "negative";
  else if (pct < 0) id = "slightly_negative";
  else if (pct <= FUNDING_BASELINE_PCT) id = "neutral";
  else if (pct < FUNDING_ELEVATED_PCT) id = "elevated";
  else if (pct < FUNDING_EXTREME_PCT) id = "high";
  else if (pct < FUNDING_EUPHORIA_PCT) id = "extreme";
  else id = "euphoria";
  return { id, ...LEVELS[id] };
}

/** Einordnung direkt aus dem DB-Wert (Bruch pro Intervall). */
export function classifyFunding(rate: number | null, intervalHours = 8): FundingLevel | null {
  if (rate === null || !Number.isFinite(rate)) return null;
  return classifyFundingPct(fundingPctPer8h(rate, intervalHours));
}
