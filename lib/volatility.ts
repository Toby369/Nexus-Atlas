// Reine Rechenlogik der Volatilitaets-Kachel (keine I/O, voll testbar).
// Datenbeschaffung: lib/volatilityContext.ts.
//
// Fragen, die die Kachel beantwortet: Wie viel Bewegung preist der
// Optionsmarkt ein (DVOL, 30-Tage-ATM-IV), wie viel hat sich BTC zuletzt
// tatsaechlich bewegt (realisierte Volatilitaet), und wird eher Schutz nach
// unten oder Spekulation nach oben bezahlt (Skew)? Alle Einordnungen sind
// beschreibend, keine Handelssignale. Die Schwellen sind gaengige
// Faustregeln, nicht im Backtest ermittelt.

export type VolTone = "calm" | "watch" | "risk";

export interface DeribitOptionSummary {
  instrument_name: string;
  mark_iv: number | null;
  underlying_price: number | null;
}

export interface ParsedOption {
  expiry: string;
  expiryMs: number;
  strike: number;
  type: "C" | "P";
  markIv: number;
  forward: number;
}

const MONTHS: Record<string, number> = {
  JAN: 0, FEB: 1, MAR: 2, APR: 3, MAY: 4, JUN: 5, JUL: 6, AUG: 7, SEP: 8, OCT: 9, NOV: 10, DEC: 11,
};

const DAY_MS = 24 * 60 * 60 * 1000;

// Deribit: BTC-25DEC26-95000-P, Verfall 08:00 UTC.
export function parseOption(row: DeribitOptionSummary): ParsedOption | null {
  const parts = row.instrument_name.split("-");
  if (parts.length !== 4) return null;
  const [, expiry, strikeStr, type] = parts;
  const m = expiry.match(/^(\d{1,2})([A-Z]{3})(\d{2})$/);
  const strike = Number(strikeStr);
  if (!m || MONTHS[m[2]] === undefined || !Number.isFinite(strike) || (type !== "C" && type !== "P")) return null;
  if (row.mark_iv === null || row.underlying_price === null || !(row.mark_iv > 0) || !(row.underlying_price > 0)) {
    return null;
  }
  const expiryMs = Date.UTC(2000 + Number(m[3]), MONTHS[m[2]], Number(m[1]), 8);
  return { expiry, expiryMs, strike, type, markIv: row.mark_iv, forward: row.underlying_price };
}

// Ziel 30 Tage; Verfaelle unter 7 Tagen sind zu unruhig und fallen weg.
export const TARGET_DAYS = 30;
export const MIN_DAYS = 7;
// Skew: Put ~10 % unter, Call ~10 % ueber dem Forward. Liegt der naechste
// gehandelte Strike mehr als 3 % daneben, gibt es keinen Skew-Wert.
export const SKEW_MONEYNESS = 0.1;
const STRIKE_TOLERANCE = 0.03;

export interface ThirtyDayOptions {
  // Verwendete Verfaelle (einer, wenn keine zwei 30 Tage einschliessen).
  expiries: string[];
  // 30, wenn interpoliert; sonst Restlaufzeit des einzigen Verfalls.
  daysToExpiry: number;
  interpolated: boolean;
  atmIv: number | null;
  skew: number | null;
}

interface ExpiryPoint {
  expiry: string;
  days: number;
  atmIv: number | null;
  skew: number | null;
}

function nearest(options: ParsedOption[], type: "C" | "P", target: number): ParsedOption | null {
  let best: ParsedOption | null = null;
  for (const o of options) {
    if (o.type !== type) continue;
    if (!best || Math.abs(o.strike - target) < Math.abs(best.strike - target)) best = o;
  }
  if (!best || Math.abs(best.strike - target) / target > STRIKE_TOLERANCE) return null;
  return best;
}

function expiryPoint(list: ParsedOption[], nowMs: number): ExpiryPoint {
  const forward = list[0].forward;
  const atm = [nearest(list, "C", forward), nearest(list, "P", forward)].filter((o): o is ParsedOption => o !== null);
  const otmPut = nearest(list, "P", forward * (1 - SKEW_MONEYNESS));
  const otmCall = nearest(list, "C", forward * (1 + SKEW_MONEYNESS));
  return {
    expiry: list[0].expiry,
    days: (list[0].expiryMs - nowMs) / DAY_MS,
    atmIv: atm.length ? atm.reduce((s, o) => s + o.markIv, 0) / atm.length : null,
    skew: otmPut && otmCall ? otmPut.markIv - otmCall.markIv : null,
  };
}

// ATM-IV auf genau 30 Tage: Interpolation der Gesamtvarianz (sigma^2 * T)
// zwischen den beiden Verfaellen, die 30 Tage einschliessen (Methode wie beim
// VIX). Skew linear in der Laufzeit. Schliessen keine zwei Verfaelle 30 Tage
// ein, gilt der naechstgelegene Verfall.
export function thirtyDayOptions(rows: DeribitOptionSummary[], nowMs: number): ThirtyDayOptions | null {
  const byExpiry = new Map<string, ParsedOption[]>();
  for (const o of rows.map(parseOption)) {
    if (!o || (o.expiryMs - nowMs) / DAY_MS < MIN_DAYS) continue;
    const list = byExpiry.get(o.expiry) ?? [];
    list.push(o);
    byExpiry.set(o.expiry, list);
  }
  const points = [...byExpiry.values()]
    .map((list) => expiryPoint(list, nowMs))
    .filter((p) => p.atmIv !== null)
    .sort((a, b) => a.days - b.days);
  if (points.length === 0) return null;

  const below = points.filter((p) => p.days <= TARGET_DAYS).pop();
  const above = points.find((p) => p.days > TARGET_DAYS);
  if (below && above) {
    const t = TARGET_DAYS;
    const w1 = below.atmIv! ** 2 * below.days;
    const w2 = above.atmIv! ** 2 * above.days;
    const share = (t - below.days) / (above.days - below.days);
    const skew =
      below.skew !== null && above.skew !== null ? below.skew + (above.skew - below.skew) * share : null;
    return {
      expiries: [below.expiry, above.expiry],
      daysToExpiry: t,
      interpolated: true,
      atmIv: Math.sqrt((w1 + (w2 - w1) * share) / t),
      skew,
    };
  }
  const only = (below ?? above)!;
  return { expiries: [only.expiry], daysToExpiry: only.days, interpolated: false, atmIv: only.atmIv, skew: only.skew };
}

// Annualisierte realisierte Volatilitaet in Prozent aus aufsteigend
// sortierten Stundenschlusskursen (Standardabweichung der Log-Renditen,
// BTC handelt 24/7 -> 24 * 365 Stunden pro Jahr).
export function realizedVolPct(hourlyCloses: number[], hours: number): number | null {
  const closes = hourlyCloses.slice(-(hours + 1));
  if (closes.length < hours + 1) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const mean = rets.reduce((s, r) => s + r, 0) / rets.length;
  const variance = rets.reduce((s, r) => s + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance * 24 * 365) * 100;
}

// Anteil der Werte in `history`, die kleiner oder gleich `value` sind (0-100).
export function percentileRank(value: number, history: number[]): number | null {
  if (history.length === 0) return null;
  return (history.filter((h) => h <= value).length / history.length) * 100;
}

// Aus einer annualisierten Volatilitaet die typische Tagesbewegung (1 Sigma).
export function expectedDailyMovePct(annualVolPct: number): number {
  return annualVolPct / Math.sqrt(365);
}

export type SkewDirection = "up" | "down" | "flat";

export interface Assessment {
  tone: VolTone;
  label: string;
}

export interface SkewAssessment extends Assessment {
  // Richtung, in die der Optionsmarkt gerade eher Geld setzt (Stimmung, keine
  // Prognose): Calls teurer -> "up", Puts teurer -> "down", sonst "flat".
  direction: SkewDirection;
}

export function classifyDvolPercentile(pct: number): Assessment {
  if (pct < 20) return { tone: "watch", label: "Sehr ruhig – auf tiefe Volatilität folgt oft eine Ausdehnung" };
  if (pct > 80) return { tone: "risk", label: "Angespannt – der Markt preist grosse Bewegungen ein" };
  return { tone: "calm", label: "Normal" };
}

// Differenz implizit minus realisiert, in Volatilitaetspunkten.
export function classifyIvRvSpread(spread: number): Assessment {
  if (spread > 10) return { tone: "watch", label: "Optionen teuer – erwartet wird mehr Bewegung als zuletzt" };
  if (spread < -5) return { tone: "risk", label: "Optionen billig – der Kurs bewegt sich mehr als eingepreist" };
  return { tone: "calm", label: "Eingepreiste und tatsächliche Bewegung passen zusammen" };
}

// Skew = IV(Put 10 % OTM) - IV(Call 10 % OTM), in Volatilitaetspunkten.
export function classifySkew(skew: number): SkewAssessment {
  if (skew > 5) return { tone: "watch", label: "Puts teurer – Absicherung nach unten gefragt", direction: "down" };
  if (skew < -2) return { tone: "watch", label: "Calls teurer – Spekulation nach oben gefragt", direction: "up" };
  return { tone: "calm", label: "Ausgeglichen", direction: "flat" };
}
