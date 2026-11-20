import type { Candle } from "./candles";
import { ENTRY_LEVEL_TOLERANCE_PCT } from "./tpStandard";
import { isAtZone, zoneHigh, zoneLow, type ZoneLevel } from "./zones";

// Zonen mit Gedaechtnis, Phase 3 (docs/research/ZONEN-GEDAECHTNIS-PLAN_2026-11-20.md):
// Steht der Kurs an einer eigenen Zone, zeigt Nexus neutral, was dort seit dem
// Eintritt passiert. Keine Deutung, keine Richtung: Toby entscheidet in der Zone.
// Grundlage: 15m-Kerzen (mit Taker-Volumen fuer das CVD), OI je 15m-Kerze,
// Liquidationen (nur Stichprobe) und die Orderbuch-Waende.

/** Hoechstens so viele 15m-Kerzen zurueck (25 Stunden). */
export const ZONE_WATCH_MAX_CANDLES = 100;

export interface FlowCandle extends Candle {
  volume?: number;
  takerBuy?: number;
}

export interface ZoneWatch {
  /** Kerzenbeginn der ersten 15m-Kerze im aktuellen Aufenthalt (ISO). */
  since: string;
  /** Anzahl 15m-Kerzen im Aufenthalt; mit atLimit = mindestens so viele. */
  candles: number;
  atLimit: boolean;
  closes: { above: number; inside: number; below: number };
  /** Dochte ueber die Oberkante mit Schluss darunter (oben) bzw. unter die Unterkante mit Schluss darueber (unten). */
  rejects: { top: number; bottom: number };
  /** Taker-Kauf minus -Verkauf in BTC, null ohne Volumendaten. */
  cvdBtc: number | null;
  oiPct: number | null;
  liquidations: { long: number; short: number } | null;
  /** Groesste Orderbuch-Wand in der Zone (Retest-Band). */
  wall: { side: "bid" | "ask"; price: number; usd: number; exchange: string } | null;
  /** Letzter Schluss der Zeiteinheit der Zone relativ zur Zone. */
  tfClose: { tf: string; where: "über" | "in" | "unter" } | null;
}

/** Ueberschneidet die Kerze das Retest-Band der Zone (Unterkante −0,25 % bis Oberkante +0,25 %, wie isAtZone)? */
function touchesBand(c: Candle, z: ZoneLevel): boolean {
  const tol = ENTRY_LEVEL_TOLERANCE_PCT / 100;
  return c.low <= zoneHigh(z) * (1 + tol) && c.high >= zoneLow(z) * (1 - tol);
}

/** Index der ersten Kerze im aktuellen Aufenthalt; null, wenn die letzte Kerze nicht an der Zone ist. */
export function episodeStart(c15: Candle[], z: ZoneLevel): number | null {
  if (!c15.length || !touchesBand(c15[c15.length - 1], z)) return null;
  let i = c15.length - 1;
  while (i > 0 && touchesBand(c15[i - 1], z)) i--;
  return i;
}

export const whereIs = (price: number, z: ZoneLevel): "über" | "in" | "unter" =>
  price > zoneHigh(z) ? "über" : price < zoneLow(z) ? "unter" : "in";

export interface ZoneWatchInput {
  zone: ZoneLevel;
  c15: FlowCandle[];
  /** OI je 15m-Kerze, aelteste zuerst. */
  oi?: { time: string; oi: number }[];
  liquidations?: { time: string; side: string }[];
  walls?: { exchange: string; bid_wall_price: number | null; bid_wall_usd: number | null; ask_wall_price: number | null; ask_wall_usd: number | null }[];
  tfCandle?: { tf: string; candle: Candle } | null;
}

export function summarizeZoneWatch(input: ZoneWatchInput): ZoneWatch | null {
  const { zone: z, c15 } = input;
  const start = episodeStart(c15, z);
  if (start === null) return null;
  const ep = c15.slice(start);
  const lo = zoneLow(z);
  const hi = zoneHigh(z);
  const closes = { above: 0, inside: 0, below: 0 };
  const rejects = { top: 0, bottom: 0 };
  for (const c of ep) {
    const w = whereIs(c.close, z);
    if (w === "über") closes.above++;
    else if (w === "unter") closes.below++;
    else closes.inside++;
    if (c.high > hi && c.close < hi) rejects.top++;
    if (c.low < lo && c.close > lo) rejects.bottom++;
  }
  const flow = ep.every((c) => Number.isFinite(c.volume) && Number.isFinite(c.takerBuy));
  const cvdBtc = flow ? ep.reduce((s, c) => s + 2 * (c.takerBuy as number) - (c.volume as number), 0) : null;
  const since = ep[0].openTime;
  const sinceMs = new Date(since).getTime();
  const oi = (input.oi ?? []).filter((o) => new Date(o.time).getTime() >= sinceMs && o.oi > 0);
  const oiPct = oi.length >= 2 ? ((oi[oi.length - 1].oi - oi[0].oi) / oi[0].oi) * 100 : null;
  const liq = input.liquidations
    ? input.liquidations
        .filter((l) => new Date(l.time).getTime() >= sinceMs)
        .reduce((a, l) => ({ long: a.long + (l.side === "long" ? 1 : 0), short: a.short + (l.side === "short" ? 1 : 0) }), { long: 0, short: 0 })
    : null;
  let wall: ZoneWatch["wall"] = null;
  for (const w of input.walls ?? []) {
    const cands = [
      { side: "bid" as const, price: w.bid_wall_price, usd: w.bid_wall_usd },
      { side: "ask" as const, price: w.ask_wall_price, usd: w.ask_wall_usd },
    ];
    for (const c of cands) {
      if (c.price === null || c.usd === null || !isAtZone(z, c.price)) continue;
      if (!wall || c.usd > wall.usd) wall = { side: c.side, price: c.price, usd: c.usd, exchange: w.exchange };
    }
  }
  return {
    since,
    candles: ep.length,
    atLimit: start === 0 && c15.length >= ZONE_WATCH_MAX_CANDLES,
    closes,
    rejects,
    cvdBtc,
    oiPct,
    liquidations: liq,
    wall,
    tfClose: input.tfCandle ? { tf: input.tfCandle.tf, where: whereIs(input.tfCandle.candle.close, z) } : null,
  };
}

const timeFmt = new Intl.DateTimeFormat("de-CH", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
const fmt = (n: number) => n.toLocaleString("de-CH", { maximumFractionDigits: 0 });
const signed = (n: number, digits = 0) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(digits)}`;
const usdM = (usd: number) => (usd >= 1e9 ? `${(usd / 1e9).toFixed(1)} Mrd. $` : `${(usd / 1e6).toFixed(1)} Mio. $`);

/** Kurze Zeilen fuer die Zonen-Kachel, ohne Deutung. */
export function zoneWatchLines(w: ZoneWatch): string[] {
  const c = w.closes;
  const closeParts = [c.above && `${c.above} über`, c.inside && `${c.inside} in`, c.below && `${c.below} unter`].filter(Boolean);
  const lines = [
    `seit ${timeFmt.format(new Date(w.since))} (${w.atLimit ? "≥" : ""}${w.candles}× 15m) · Schlüsse ${closeParts.join(", ")}`,
    `Dochte oben ${w.rejects.top}×, unten ${w.rejects.bottom}×${w.tfClose ? ` · ${w.tfClose.tf}-Schluss ${w.tfClose.where} Zone` : ""}`,
  ];
  const flow = [
    w.cvdBtc !== null && `CVD ${signed(w.cvdBtc)} BTC`,
    w.oiPct !== null && `OI ${signed(w.oiPct, 1)} %`,
    w.liquidations && `Liq. L ${w.liquidations.long} / S ${w.liquidations.short}`,
  ].filter(Boolean);
  if (flow.length) lines.push(flow.join(" · "));
  if (w.wall) lines.push(`Wand ${w.wall.side === "bid" ? "Bid" : "Ask"} ${usdM(w.wall.usd)} bei ${fmt(w.wall.price)} (${w.wall.exchange})`);
  return lines;
}
