import type { SpotPressurePoint } from "./types";

// Spot-Druck je Stunde (Toby 22.11.2026): Der 4H-Wert "Spot verkauft −5 %"
// verdeckte um 08:01 zwei Kaufstunden (07 Uhr +9 %, 08 Uhr +10 %), Toby
// stieg aus einem guten Long aus. Darum: 12 Stundenbalken in "Wer treibt?"
// und eine Drehung, wenn die letzten zwei geschlossenen Stunden gegen die
// 4H-Richtung laufen. Nur Anzeige: Spot-Druck sagt den Kurs der naechsten
// Stunden nicht voraus (30 Tage, 4H rot 43 % / gruen 46 % steigend), er
// zeigt, wer gerade handelt.

const HOUR_MS = 3_600_000;
export const SPOT_HOURS = 12;
/** Ab diesem Netto-Anteil gilt eine Stunde als klar kaufend/verkaufend. */
export const TURN_HOUR_PCT = 5;

export interface SpotHourBar {
  startMs: number;
  /** (Kauf − Verkauf) / (Kauf + Verkauf) in %, null ohne Daten. */
  netPct: number | null;
  /** false = laufende Stunde. */
  complete: boolean;
}

export function hourlySpotNet(points: SpotPressurePoint[], nowMs: number, hours = SPOT_HOURS): SpotHourBar[] {
  const currentStart = Math.floor(nowMs / HOUR_MS) * HOUR_MS;
  const firstStart = currentStart - (hours - 1) * HOUR_MS;
  const sums = new Map<number, { b: number; s: number }>();
  for (const p of points) {
    const t = Date.parse(p.timestamp_utc);
    if (!(t >= firstStart) || p.taker_buy_vol === null || p.taker_sell_vol === null) continue;
    const k = Math.floor(t / HOUR_MS) * HOUR_MS;
    const cur = sums.get(k) ?? { b: 0, s: 0 };
    cur.b += Number(p.taker_buy_vol);
    cur.s += Number(p.taker_sell_vol);
    sums.set(k, cur);
  }
  return Array.from({ length: hours }, (_, i) => {
    const startMs = firstStart + i * HOUR_MS;
    const v = sums.get(startMs);
    const total = v ? v.b + v.s : 0;
    return { startMs, netPct: v && total > 0 ? ((v.b - v.s) / total) * 100 : null, complete: startMs < currentStart };
  });
}

/**
 * Dreht der Spot gegen die 4H-Richtung? Die letzten zwei GESCHLOSSENEN
 * Stunden muessen beide klar (ab ±5 %) auf der Gegenseite liegen.
 */
export function spotTurn(bars: SpotHourBar[], spot4h: "up" | "down" | "flat" | null): "up" | "down" | null {
  const closed = bars.filter((b) => b.complete);
  const last2 = closed.slice(-2);
  if (last2.length < 2 || last2.some((b) => b.netPct === null)) return null;
  if (spot4h === "down" && last2.every((b) => b.netPct! >= TURN_HOUR_PCT)) return "up";
  if (spot4h === "up" && last2.every((b) => b.netPct! <= -TURN_HOUR_PCT)) return "down";
  return null;
}
