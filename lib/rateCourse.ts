import type { Light } from "./lageOverview";

// Zinskurs (Toby 15.11.2026): Zinsentscheide wirken ueber Monate, nicht nur
// eine Stunde. Zwei Fragen, beide aus Daten, die Nexus selbst sammelt:
// 1) Wohin hat die Fed zuletzt bewegt? (fed_rate_changes, FRED DFEDTARU/L)
// 2) Was erwartet der Markt? 2-jaehrige US-Rendite (DGS2) gegen die Mitte
//    des Zielbands: deutlich darueber = Markt rechnet mit Erhoehungen,
//    deutlich darunter = mit Senkungen.
// Kein Handelssignal, nur Rueckenwind/Gegenwind als Hintergrund.

export interface FedRateChange {
  effective_date: string; // YYYY-MM-DD
  lower_pct: number;
  upper_pct: number;
}

export type RateDirection = "hikes" | "cuts" | "pause";
export type RateExpectation = "hikes" | "cuts" | "steady";

/** Ab so vielen Tagen ohne Schritt gilt der Kurs als Pause. */
export const RATE_PAUSE_DAYS = 180;
/** Abstand 2J-Rendite zur Bandmitte, ab dem der Markt einen Schritt erwartet. */
export const EXPECTATION_SPREAD_PCT = 0.25;

export interface RateCourse {
  lower: number;
  upper: number;
  direction: RateDirection;
  lastStep: { date: string; deltaPct: number } | null;
  expectation: RateExpectation | null;
  twoYearPct: number | null;
  light: Light;
  /** Kurzform fuer die Zeile, z.B. "Erhöhungen". */
  short: string;
  /** Ein Satz Wirkung, z.B. "Gegenwind für BTC". */
  effect: string;
}

const fmt = (n: number) => n.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function rateCourse(
  changes: FedRateChange[],
  twoYearPct: number | null,
  nowMs: number
): RateCourse | null {
  if (changes.length === 0) return null;
  const sorted = [...changes].sort((a, b) => a.effective_date.localeCompare(b.effective_date));
  const current = sorted[sorted.length - 1];
  const prev = sorted.length > 1 ? sorted[sorted.length - 2] : null;
  const lastStep = prev ? { date: current.effective_date, deltaPct: current.upper_pct - prev.upper_pct } : null;
  const ageDays = lastStep ? (nowMs - Date.parse(`${lastStep.date}T00:00:00Z`)) / 86_400_000 : Infinity;
  const direction: RateDirection =
    !lastStep || ageDays > RATE_PAUSE_DAYS ? "pause" : lastStep.deltaPct > 0 ? "hikes" : "cuts";

  const mid = (current.lower_pct + current.upper_pct) / 2;
  const spread = twoYearPct === null ? null : twoYearPct - mid;
  const expectation: RateExpectation | null =
    spread === null ? null : spread > EXPECTATION_SPREAD_PCT ? "hikes" : spread < -EXPECTATION_SPREAD_PCT ? "cuts" : "steady";

  const score =
    (direction === "hikes" ? -1 : direction === "cuts" ? 1 : 0) +
    (expectation === "hikes" ? -1 : expectation === "cuts" ? 1 : 0);
  const light: Light = score < 0 ? "down" : score > 0 ? "up" : "neutral";
  const short = { hikes: "Erhöhungen", cuts: "Senkungen", pause: "Pause" }[direction];
  const effect = light === "down" ? "Gegenwind für BTC" : light === "up" ? "Rückenwind für BTC" : "kein klarer Rückenwind";
  return { lower: current.lower_pct, upper: current.upper_pct, direction, lastStep, expectation, twoYearPct, light, short, effect };
}

/** "Leitzins 3,75–4,00 %, zuletzt +0,25 ab 17.9." */
export function rateCourseLine(c: RateCourse, dateText: (iso: string) => string): string {
  const step = c.lastStep
    ? `, zuletzt ${c.lastStep.deltaPct > 0 ? "+" : "−"}${fmt(Math.abs(c.lastStep.deltaPct))} ab ${dateText(c.lastStep.date)}`
    : "";
  return `Leitzins ${fmt(c.lower)}–${fmt(c.upper)} %${step}`;
}

/** "2J 4,86 %: Markt erwartet weitere Erhöhungen" */
export function expectationLine(c: RateCourse): string | null {
  if (c.twoYearPct === null || c.expectation === null) return null;
  const what = {
    hikes: c.direction === "hikes" ? "weitere Erhöhungen" : "Erhöhungen",
    cuts: c.direction === "cuts" ? "weitere Senkungen" : "Senkungen",
    steady: "keinen grossen Schritt",
  }[c.expectation];
  return `2J-Rendite ${fmt(c.twoYearPct)} %: Markt erwartet ${what}`;
}
