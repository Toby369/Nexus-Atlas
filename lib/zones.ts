import { ENTRY_LEVEL_TOLERANCE_PCT } from "./tpStandard";
import { ganzzahlCh } from "./zahlCh";

// Zonen fuer das Dashboard (Toby 22.10.2026, Abstimmung mit der Session
// "Bitcoin Preisbewegungen verstehen": "er fragt staendig, wo ist das
// naechste Level?"). Die Rolle einer Zone richtet sich nach ihrer Lage zum
// aktuellen Kurs, nicht nach der gespeicherten Seite: ueber dem Kurs
// Verkaeufer-Zone, darunter Kaeufer-Zone (Rollentausch). Das Level, an dem
// der Kurs gerade steht (Retest-Toleranz), bleibt aussen vor.

export interface ZoneLevel {
  price: number;
  /** Zonen-Bereich (AutarkTrade-Rechteck). Fehlt er, ist die Zone eine Linie bei price. */
  low?: number | null;
  high?: number | null;
  label?: string | null;
}

/** Unter- und Oberkante; bei einer Linie beide = price. */
export const zoneLow = (l: ZoneLevel) => Math.min(l.low ?? l.price, l.high ?? l.price);
export const zoneHigh = (l: ZoneLevel) => Math.max(l.low ?? l.price, l.high ?? l.price);

/**
 * Kurs "an der Zone" (Retest-Band, Abstimmung 28.10.2026):
 * low*(1-0,25 %) <= Kurs <= high*(1+0,25 %). Fuer eine Linie genau +-0,25 % um den Preis.
 */
export function isAtZone(l: ZoneLevel, price: number): boolean {
  const tol = ENTRY_LEVEL_TOLERANCE_PCT / 100;
  return zoneLow(l) * (1 - tol) <= price && price <= zoneHigh(l) * (1 + tol);
}

export interface ZoneRow {
  /** Kante zum Kurs hin: Unterkante bei Zonen darueber, Oberkante bei Zonen darunter. */
  price: number;
  low: number;
  high: number;
  label: string | null;
  role: "Verkäufer-Zone" | "Käufer-Zone";
  /** Abstand vom Kurs zur nahen Kante in Prozent, immer positiv. */
  distancePct: number;
}

export function nearestZones(
  levels: ZoneLevel[],
  price: number | null,
  perSide = 2
): { above: ZoneRow[]; below: ZoneRow[] } {
  if (price === null || price <= 0) return { above: [], below: [] };
  const toRow = (l: ZoneLevel, role: ZoneRow["role"]): ZoneRow => {
    const edge = role === "Verkäufer-Zone" ? zoneLow(l) : zoneHigh(l);
    return {
      price: edge,
      low: zoneLow(l),
      high: zoneHigh(l),
      label: l.label ?? null,
      role,
      distancePct: (Math.abs(edge - price) / price) * 100,
    };
  };
  const away = levels.filter((l) => !isAtZone(l, price));
  const above = away
    .filter((l) => zoneLow(l) > price)
    .sort((a, b) => zoneLow(a) - zoneLow(b))
    .slice(0, perSide)
    .map((l) => toRow(l, "Verkäufer-Zone"));
  const below = away
    .filter((l) => zoneHigh(l) < price)
    .sort((a, b) => zoneHigh(b) - zoneHigh(a))
    .slice(0, perSide)
    .map((l) => toRow(l, "Käufer-Zone"));
  return { above, below };
}

const fmt = ganzzahlCh;

/** Plan-Satz nach Tobys Routine: "Ueber X Long am Retest, unter Y Short, dazwischen nichts." */
export function planSentence(levels: ZoneLevel[], price: number | null): string | null {
  const { above, below } = nearestZones(levels, price, 1);
  if (above.length === 0 && below.length === 0) return null;
  // Long erst ueber der Oberkante der Zone darueber, Short erst unter der Unterkante darunter.
  const longAt = above[0] ? fmt(above[0].high) : null;
  const shortAt = below[0] ? fmt(below[0].low) : null;
  if (longAt === null) return `Unter ${shortAt} Short. Darüber kein Widerstand in den Keylevels.`;
  if (shortAt === null) return `Über ${longAt} Long am Retest. Darunter keine Unterstützung in den Keylevels.`;
  return `Über ${longAt} Long am Retest, unter ${shortAt} Short. Dazwischen kein Trade.`;
}

/** 1D-Trend aus der MTF-Ampel fuer den TP-Standard (Regelwerk Punkt 13: Gegentrend hoechstens Standard 4). */
export function dailyTrendFromMtf(dots: { timeframe: string; status: string }[]): "bullish" | "bearish" | null {
  const status = dots.find((d) => d.timeframe === "1D")?.status ?? "no_data";
  return status.startsWith("bullish") ? "bullish" : status.startsWith("bearish") ? "bearish" : null;
}

export interface LiquidationTarget {
  low: number;
  high: number;
  massUsd: number;
  /** Abstand vom Kurs zum nahen Rand der Zone in Prozent, immer positiv. */
  distancePct: number;
}

/**
 * Naechste Liquidations-Zone ueber (Short-Liquidationen) und unter dem Kurs
 * (Long-Liquidationen) als Ziel -- Regelwerk Punkt 7 (14.10.2026): "Cluster als Ziel".
 */
export function nearestLiquidationTargets(
  zones: { side: "long" | "short"; priceLow: number; priceHigh: number; massUsd: number }[],
  price: number | null
): { above: LiquidationTarget | null; below: LiquidationTarget | null } {
  if (price === null || price <= 0) return { above: null, below: null };
  const toTarget = (z: (typeof zones)[number], edge: number): LiquidationTarget => ({
    low: z.priceLow,
    high: z.priceHigh,
    massUsd: z.massUsd,
    distancePct: (Math.abs(edge - price) / price) * 100,
  });
  const above = zones
    .filter((z) => z.side === "short" && z.priceLow > price)
    .sort((a, b) => a.priceLow - b.priceLow)[0];
  const below = zones
    .filter((z) => z.side === "long" && z.priceHigh < price)
    .sort((a, b) => b.priceHigh - a.priceHigh)[0];
  return {
    above: above ? toTarget(above, above.priceLow) : null,
    below: below ? toTarget(below, below.priceHigh) : null,
  };
}

/** Regelwerk 29.10.2026 (Toby): Stop hinter der Zone statt fest 0,5 %. */
export const STOP_BEYOND_ZONE_PCT = 0.25;
/** Nie enger als dieser Abstand vom Einstieg (1H-Rauschen liegt im Median bei ~0,5 %). */
export const MIN_STOP_PCT = 0.5;

/**
 * Stop hinter der Zone: Long 0,25 % unter der Unterkante, Short 0,25 % ueber
 * der Oberkante -- mindestens 0,5 % vom Einstieg entfernt.
 */
export function stopBehindZone(side: "long" | "short", zone: ZoneLevel | null, entry: number): { stop: number; stopPct: number } {
  const beyond = STOP_BEYOND_ZONE_PCT / 100;
  const minDist = MIN_STOP_PCT / 100;
  const stop =
    side === "long"
      ? Math.min(zone ? zoneLow(zone) * (1 - beyond) : Infinity, entry * (1 - minDist))
      : Math.max(zone ? zoneHigh(zone) * (1 + beyond) : -Infinity, entry * (1 + minDist));
  return { stop, stopPct: (Math.abs(entry - stop) / entry) * 100 };
}

/**
 * Zone, an der ein Trade ab Kurs einsteigen wuerde: Long an der naechsten Zone
 * auf oder unter dem Kurs, Short an der naechsten auf oder ueber dem Kurs.
 */
export function entryZone(levels: ZoneLevel[], price: number, side: "long" | "short"): ZoneLevel | null {
  const tol = ENTRY_LEVEL_TOLERANCE_PCT / 100;
  if (side === "long") {
    return levels.filter((l) => zoneLow(l) <= price * (1 + tol)).sort((a, b) => zoneHigh(b) - zoneHigh(a))[0] ?? null;
  }
  return levels.filter((l) => zoneHigh(l) >= price * (1 - tol)).sort((a, b) => zoneLow(a) - zoneLow(b))[0] ?? null;
}

/** Risiko je Trade fix 10 % Marge (Regelwerk 29.10.2026), hoechstens 20x Hebel. */
export const RISK_MARGIN_PCT = 10;
export const MAX_LEVERAGE = 20;

/** Hebel, bei dem der Stop genau 10 % Marge kostet: 10 % / Stop-Abstand, abgerundet, max. 20x. */
export function leverageForStop(stopPct: number): number {
  if (!(stopPct > 0)) return MAX_LEVERAGE;
  return Math.max(1, Math.min(MAX_LEVERAGE, Math.floor(RISK_MARGIN_PCT / stopPct + 1e-9)));
}
