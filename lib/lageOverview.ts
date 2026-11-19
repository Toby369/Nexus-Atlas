import { FUNDING_ELEVATED_PCT } from "./fundingLevels";
import { CROWD_HEAVY_LONG, CROWD_SHORT } from "./positioning";
import type { FlowDirection } from "./spotPerpFlow";

// Reiter "Lage" (Toby 15.11.2026: "Ruhe im Dashboard, Klarheit"): vier
// Fragen mit je einer Zeile und Ampel, darueber ein Satz Gesamtlage --
// regelbasiert aus genau diesen vier Zeilen, ohne KI und ohne neue Daten
// (Vorbild: AutarkTrades "Gesamtlage" aus den Kachelwerten).

export type Light = "up" | "down" | "warn" | "neutral";

export interface LageRow {
  id: "driver" | "leverage" | "us" | "macro";
  title: string;
  light: Light;
  chip: string;
  line: string;
}

const fmt = (n: number, d = 0) => n.toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (n: number, d = 1) => `${n >= 0 ? "+" : "−"}${fmt(Math.abs(n), d)}`;

/** 1) Wer treibt? Spot gegen Perp (Netto-Taker-Flow) plus OI-Szenario. */
export function driverRow(input: {
  spot: FlowDirection | null;
  perp: FlowDirection | null;
  verdictLabel: string | null;
  oiChangePct: number | null;
  scenarioLabel: string;
}): LageRow {
  const { spot, perp } = input;
  let light: Light = "neutral";
  let chip = "unklar";
  if (spot === "up") [light, chip] = ["up", "Spot kauft"];
  else if (spot === "down") [light, chip] = ["down", "Spot verkauft"];
  else if (perp === "up" || perp === "down") [light, chip] = ["warn", "nur Hebel"];
  else if (spot === "flat") chip = "ruhig";
  const oi = input.oiChangePct === null ? "" : ` · OI ${signed(input.oiChangePct)} %`;
  return {
    id: "driver",
    title: "Wer treibt?",
    light,
    chip,
    line: `${input.verdictLabel ?? "Keine Flow-Daten"}${oi} · ${input.scenarioLabel}`,
  };
}

/** 2) Hebel und Masse: Funding und Anteil Long-Konten (Schwellen aus dem Regelwerk). */
export function leverageRow(input: {
  fundingPct: number | null;
  crowdLongPct: number | null;
  liqAbove: number | null;
  liqBelow: number | null;
}): LageRow {
  const { fundingPct: f, crowdLongPct: c } = input;
  const longCrowded = (f !== null && f >= FUNDING_ELEVATED_PCT) || (c !== null && c >= CROWD_HEAVY_LONG * 100);
  const shortCrowded = (f !== null && f <= -FUNDING_ELEVATED_PCT) || (c !== null && c < CROWD_SHORT * 100);
  const [light, chip]: [Light, string] = longCrowded
    ? ["warn", "Longs überfüllt"]
    : shortCrowded
      ? ["warn", "Shorts überfüllt"]
      : ["neutral", "ausgeglichen"];
  const parts = [
    f === null ? null : `Funding ${fmt(f, 3)} %`,
    c === null ? null : `Masse ${fmt(c)} % long`,
    input.liqAbove === null ? null : `Liq ↑ ${fmt(input.liqAbove)}`,
    input.liqBelow === null ? null : `↓ ${fmt(input.liqBelow)}`,
  ].filter(Boolean);
  return { id: "leverage", title: "Hebel und Masse", light, chip, line: parts.join(" · ") || "Keine Daten" };
}

/** 3) US-Anleger: ETF-Flows und Coinbase-Praemie zaehlen, Fear & Greed nur als Kontext. */
export function usInvestorsRow(input: {
  etfLastUsdM: number | null;
  etfSumUsdM: number | null;
  etfDays: number;
  premiumPct: number | null;
  premiumLabel: string | null;
  fearGreed: number | null;
  fearGreedLabel: string | null;
}): LageRow {
  let score = 0;
  if (input.etfSumUsdM !== null) score += input.etfSumUsdM > 0 ? 1 : input.etfSumUsdM < 0 ? -1 : 0;
  if (input.premiumPct !== null) score += input.premiumPct > 0.03 ? 1 : input.premiumPct < -0.03 ? -1 : 0;
  const [light, chip]: [Light, string] = score > 0 ? ["up", "kaufen"] : score < 0 ? ["down", "verkaufen"] : ["neutral", "gemischt"];
  const parts = [
    input.etfSumUsdM === null ? null : `ETF ${signed(input.etfSumUsdM, 0)} Mio. $ (${input.etfDays} T)`,
    input.premiumPct === null ? null : `Coinbase ${signed(input.premiumPct, 3)} %`,
    input.fearGreed === null ? null : `F&G ${input.fearGreed}${input.fearGreedLabel ? ` ${input.fearGreedLabel}` : ""}`,
  ].filter(Boolean);
  return { id: "us", title: "US-Anleger", light, chip, line: parts.join(" · ") || "Keine Daten" };
}

/** 4) US-Makro: naechster Termin, letzte Einordnung, Makro-Regime (DXY, Renditen, Indizes). */
export function macroRow(input: {
  next: { label: string; whenText: string; hoursAway: number } | null;
  lastResult: { label: string; bias: "bullish" | "bearish" | "neutral"; dateText: string } | null;
  regime: string | null;
  /** Zinskurs (lib/rateCourse.ts): langsamer Hintergrund, ueber Monate. */
  rate?: { short: string; light: Light } | null;
}): LageRow {
  const soon = input.next !== null && input.next.hoursAway <= 24;
  const regime = input.regime ?? "";
  const regimeLight: Light = /risk.?off/i.test(regime) ? "down" : /risk.?on/i.test(regime) ? "up" : "neutral";
  // Regime (Tage) und Zinskurs (Monate): einig oder einer neutral -> dieser
  // Ton; widersprechen sie sich -> neutral.
  const rateLight: Light = input.rate?.light ?? "neutral";
  const background: Light =
    regimeLight === "neutral" ? rateLight : rateLight === "neutral" || rateLight === regimeLight ? regimeLight : "neutral";
  const light: Light = soon ? "warn" : background;
  const chip = soon ? `${input.next!.label} bald` : input.next ? `${input.next.label} ${input.next.whenText}` : regime || "ruhig";
  const biasWord = { bullish: "bullisch", bearish: "bärisch", neutral: "neutral" } as const;
  const parts = [
    input.rate ? `Zinskurs ${input.rate.short}` : null,
    input.next ? `Nächster Termin: ${input.next.label} ${input.next.whenText}` : null,
    input.lastResult ? `zuletzt ${input.lastResult.label} ${input.lastResult.dateText}: ${biasWord[input.lastResult.bias]}` : null,
    regime ? `Makro ${regime}` : null,
  ].filter(Boolean);
  return { id: "macro", title: "US-Makro", light, chip, line: parts.join(" · ") || "Keine Daten" };
}

/** Ein Satz Gesamtlage aus den vier Zeilen. */
export function overallSentence(rows: LageRow[]): { light: Light; text: string } {
  const by = Object.fromEntries(rows.map((r) => [r.id, r])) as Record<LageRow["id"], LageRow>;
  const tail: string[] = [];
  const reasons: string[] = [];
  let score = 0;
  for (const id of ["driver", "us"] as const) {
    const r = by[id];
    if (!r) continue;
    if (r.light === "up") score++;
    if (r.light === "down") score--;
  }
  if (by.driver?.light === "up") reasons.push("Spot kauft mit");
  if (by.driver?.light === "down") reasons.push("Spot verkauft");
  if (by.driver?.light === "warn") reasons.push("nur der Hebel treibt");
  if (by.us?.light === "up") reasons.push("US-Anleger kaufen");
  if (by.us?.light === "down") reasons.push("US-Anleger ziehen ab");
  if (by.leverage?.light === "warn") tail.push(`${by.leverage.chip}, Gegenbewegung möglich`);
  if (by.macro?.light === "warn") tail.push(`${by.macro.chip.replace(" bald", "")} steht an, kleiner handeln`);

  const head = score > 0 ? "Rückenwind" : score < 0 ? "Gegenwind" : "Gemischt";
  const light: Light = tail.length > 0 ? "warn" : score > 0 ? "up" : score < 0 ? "down" : "neutral";
  const body = reasons.length > 0 ? `: ${reasons.join(", ")}.` : ": keine klare Seite.";
  return { light, text: `${head}${body}${tail.length ? ` ${tail.join(". ")}.` : ""}` };
}
