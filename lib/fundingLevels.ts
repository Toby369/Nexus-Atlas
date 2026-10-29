// Stufen-Einordnung der Funding-Rate, damit die Funding-Kachel nicht nur
// eine nackte Zahl zeigt, sondern sagt, ob sie normal, erhoeht oder extrem
// ist. Rechnet intern in Prozent pro 8 Stunden: das ist das Abrechnungs-
// intervall der grossen Boersen fuer BTCUSDT-Perps und die Basis, auf der
// die ueblichen Faustregeln formuliert sind.
//
// 0,01 % pro 8 h ist der Standardwert (Zinskomponente) bei Binance/Bybit
// und damit der Grundwert, nicht "leicht bullisch". Die Extrem-Schwelle
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
  neutral: {
    label: "Neutral",
    tone: "calm",
    hint: "Grundwert: Perp und Spot gleichauf. Die Börsen setzen standardmässig 0,01 % pro 8 h. Kein Signal.",
  },
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

// Grundwert = 0 bis 0,01 % pro 8 h. In ruhigen Phasen liegt das Funding fast
// immer dort; aussagekraeftig ist, wann es ihn zuletzt verlassen hat.
export const FUNDING_HISTORY_DAYS = 30;

export interface FundingEvent {
  t: number; // ms
  pct: number; // % pro 8 h
}

export interface FundingBaselineStatus {
  inBaseline: boolean;
  /** Text fuer die Kachel, z. B. "Seit 6 Std. im Grundwert." */
  lines: string[];
}

export function isFundingBaseline(pctPer8h: number): boolean {
  const pct = roundPct(pctPer8h);
  return pct >= 0 && pct <= FUNDING_BASELINE_PCT;
}

function ago(ms: number): string {
  const h = ms / 3_600_000;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} Min.`;
  if (h < 48) return `${Math.round(h)} Std.`;
  return `${Math.round(h / 24)} Tagen`;
}

function signedPct(pct: number): string {
  return `${pct >= 0 ? "+" : "−"}${Math.abs(pct).toLocaleString("de-CH", { minimumFractionDigits: 4, maximumFractionDigits: 4 })} %`;
}

/**
 * lastNegative/lastAbove: juengster Wert unter 0 bzw. ueber 0,01 % in den
 * letzten FUNDING_HISTORY_DAYS Tagen; lastBaseline: juengster Wert im
 * Grundwert (nur noetig, wenn das Funding gerade ausserhalb liegt).
 */
export function fundingBaselineStatus(
  currentPct: number,
  lastNegative: FundingEvent | null,
  lastAbove: FundingEvent | null,
  lastBaseline: FundingEvent | null,
  now: number,
): FundingBaselineStatus {
  const inBaseline = isFundingBaseline(currentPct);
  const lines: string[] = [];
  if (inBaseline) {
    const lastOut = Math.max(lastNegative?.t ?? 0, lastAbove?.t ?? 0);
    lines.push(
      lastOut > 0 ? `Seit ${ago(now - lastOut)} im Grundwert.` : `Seit über ${FUNDING_HISTORY_DAYS} Tagen im Grundwert.`,
    );
  } else {
    lines.push(
      lastBaseline
        ? `Seit ${ago(now - lastBaseline.t)} ausserhalb des Grundwerts.`
        : `Seit über ${FUNDING_HISTORY_DAYS} Tagen ausserhalb des Grundwerts.`,
    );
  }
  lines.push(
    lastNegative
      ? `Zuletzt negativ (Shorts zahlen): vor ${ago(now - lastNegative.t)}, ${signedPct(lastNegative.pct)}.`
      : `Negativ: nicht in den letzten ${FUNDING_HISTORY_DAYS} Tagen.`,
  );
  lines.push(
    lastAbove
      ? `Zuletzt über 0,01 % (Longs zahlen mehr): vor ${ago(now - lastAbove.t)}, ${signedPct(lastAbove.pct)}.`
      : `Über 0,01 %: nicht in den letzten ${FUNDING_HISTORY_DAYS} Tagen.`,
  );
  return { inBaseline, lines };
}
