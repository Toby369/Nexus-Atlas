// Coinbase-Premium: Preisabstand Coinbase BTC-USD zu Binance BTC-USDT.
// Coinbase ist die Hauptboerse der US-Institutionen und ETF-Verwahrer;
// eine anhaltend positive Praemie zeigt US-Kaufdruck, eine negative
// US-Verkaeufe. Binance-Seite aus spot_market_snapshots (5-Min-Kerzen,
// timestamp_utc = Kerzen-Open, last_price = Close), Coinbase-Seite aus
// deren oeffentlichen 5-Min-Kerzen (time = Kerzen-Open). Verglichen werden
// nur Kerzen mit identischer Open-Zeit, damit kein Zeitversatz als Praemie
// erscheint.
//
// USD gegen USDT: Der Binance-Preis wird mit dem USDT-USD-Kurs (Coinbase,
// gleiche 5-Min-Kerzen) in echte USD umgerechnet. Ohne diese Korrektur
// stuende ein USDT-Abschlag direkt als Praemie da -- bei USDT = 0,9987 USD
// waeren das -0,13 % "Verkaufsdruck", der keiner ist.
//
// Schwellen sind Faustregeln: Abweichungen unter 0,03 % liegen im
// Rauschen von Spread und Umrechnung.

export const PREMIUM_NOISE_PCT = 0.03;
export const PREMIUM_STRONG_PCT = 0.1;
// Juengste 6 gemeinsame Kerzen = 30 Minuten fuer den "aktuellen" Wert,
// damit eine einzelne Ausreisser-Kerze nicht das Verdikt kippt.
const CURRENT_WINDOW_POINTS = 6;

export interface PricePoint {
  t: number; // Kerzen-Open in ms
  close: number;
}

export interface PremiumPoint {
  t: number;
  premiumPct: number;
}

export type PremiumLevel = "strong_buying" | "buying" | "neutral" | "selling" | "strong_selling";

export interface PremiumSummary {
  currentPct: number | null;
  averagePct: number | null;
  level: PremiumLevel | null;
  label: string;
  pointCount: number;
  latestT: number | null;
}

/** Coinbase-Exchange-Kerzen: [time(s), low, high, open, close, volume]. */
export function parseCoinbaseCandles(raw: unknown): PricePoint[] {
  if (!Array.isArray(raw)) return [];
  const out: PricePoint[] = [];
  for (const row of raw) {
    if (!Array.isArray(row) || row.length < 5) continue;
    const t = Number(row[0]) * 1000;
    const close = Number(row[4]);
    if (Number.isFinite(t) && Number.isFinite(close) && close > 0) out.push({ t, close });
  }
  return out.sort((a, b) => a.t - b.t);
}

/**
 * usdtUsd: USDT-USD-Kerzen. Fehlt zu einer Zeit eine Kerze (kein Handel),
 * gilt der letzte bekannte Kurs davor; vor dem ersten Kurs wird nicht
 * verglichen. Ohne Kurse (leere Liste) bleibt es beim Rohvergleich.
 */
export function computePremiumSeries(
  coinbase: PricePoint[],
  binance: PricePoint[],
  usdtUsd: PricePoint[] = [],
): PremiumPoint[] {
  const binanceByT = new Map(binance.map((p) => [p.t, p.close]));
  const usdt = [...usdtUsd].sort((a, b) => a.t - b.t);
  const series: PremiumPoint[] = [];
  let ui = -1;
  for (const cb of [...coinbase].sort((a, b) => a.t - b.t)) {
    while (ui + 1 < usdt.length && usdt[ui + 1].t <= cb.t) ui++;
    const rate = usdt.length === 0 ? 1 : ui >= 0 ? usdt[ui].close : null;
    const bn = binanceByT.get(cb.t);
    if (rate === null || bn === undefined || bn <= 0) continue;
    const bnUsd = bn * rate;
    series.push({ t: cb.t, premiumPct: ((cb.close - bnUsd) / bnUsd) * 100 });
  }
  return series;
}

const LEVEL_LABELS: Record<PremiumLevel, string> = {
  strong_buying: "Starker US-Kaufdruck",
  buying: "US-Kaufdruck",
  neutral: "Neutral",
  selling: "US-Verkaufsdruck",
  strong_selling: "Starker US-Verkaufsdruck",
};

export function classifyPremium(pct: number): PremiumLevel {
  if (pct >= PREMIUM_STRONG_PCT) return "strong_buying";
  if (pct >= PREMIUM_NOISE_PCT) return "buying";
  if (pct <= -PREMIUM_STRONG_PCT) return "strong_selling";
  if (pct <= -PREMIUM_NOISE_PCT) return "selling";
  return "neutral";
}

function mean(values: number[]): number | null {
  return values.length === 0 ? null : values.reduce((a, b) => a + b, 0) / values.length;
}

export function summarizePremium(series: PremiumPoint[]): PremiumSummary {
  const currentPct = mean(series.slice(-CURRENT_WINDOW_POINTS).map((p) => p.premiumPct));
  const averagePct = mean(series.map((p) => p.premiumPct));
  const level = currentPct === null ? null : classifyPremium(currentPct);
  return {
    currentPct,
    averagePct,
    level,
    label: level ? LEVEL_LABELS[level] : "Keine Daten",
    pointCount: series.length,
    latestT: series.length > 0 ? series[series.length - 1].t : null,
  };
}
