import { ENTRY_LEVEL_TOLERANCE_PCT } from "./tpStandard";

// Zonen fuer das Dashboard (Toby 22.10.2026, Abstimmung mit der Session
// "Bitcoin Preisbewegungen verstehen": "er fragt staendig, wo ist das
// naechste Level?"). Die Rolle einer Zone richtet sich nach ihrer Lage zum
// aktuellen Kurs, nicht nach der gespeicherten Seite: ueber dem Kurs
// Verkaeufer-Zone, darunter Kaeufer-Zone (Rollentausch). Das Level, an dem
// der Kurs gerade steht (Retest-Toleranz), bleibt aussen vor.

export interface ZoneLevel {
  price: number;
}

export interface ZoneRow {
  price: number;
  role: "Verkäufer-Zone" | "Käufer-Zone";
  /** Abstand zum Kurs in Prozent, immer positiv. */
  distancePct: number;
}

export function nearestZones(
  levels: ZoneLevel[],
  price: number | null,
  perSide = 2
): { above: ZoneRow[]; below: ZoneRow[] } {
  if (price === null || price <= 0) return { above: [], below: [] };
  const gap = price * (ENTRY_LEVEL_TOLERANCE_PCT / 100);
  const toRow = (p: number, role: ZoneRow["role"]): ZoneRow => ({
    price: p,
    role,
    distancePct: (Math.abs(p - price) / price) * 100,
  });
  const above = levels
    .filter((l) => l.price > price + gap)
    .sort((a, b) => a.price - b.price)
    .slice(0, perSide)
    .map((l) => toRow(l.price, "Verkäufer-Zone"));
  const below = levels
    .filter((l) => l.price < price - gap)
    .sort((a, b) => b.price - a.price)
    .slice(0, perSide)
    .map((l) => toRow(l.price, "Käufer-Zone"));
  return { above, below };
}

const fmt = (n: number) => n.toLocaleString("de-CH", { maximumFractionDigits: 0 });

/** Plan-Satz nach Tobys Routine: "Ueber X Long am Retest, unter Y Short, dazwischen nichts." */
export function planSentence(levels: ZoneLevel[], price: number | null): string | null {
  const { above, below } = nearestZones(levels, price, 1);
  if (above.length === 0 && below.length === 0) return null;
  if (above.length === 0) return `Unter ${fmt(below[0].price)} Short. Darüber kein Widerstand in den Keylevels.`;
  if (below.length === 0) return `Über ${fmt(above[0].price)} Long am Retest. Darunter keine Unterstützung in den Keylevels.`;
  return `Über ${fmt(above[0].price)} Long am Retest, unter ${fmt(below[0].price)} Short. Dazwischen kein Trade.`;
}

/** 1D-Trend aus der MTF-Ampel fuer den TP-Standard (Regelwerk Punkt 13: Gegentrend hoechstens Standard 4). */
export function dailyTrendFromMtf(dots: { timeframe: string; status: string }[]): "bullish" | "bearish" | null {
  const status = dots.find((d) => d.timeframe === "1D")?.status ?? "no_data";
  return status.startsWith("bullish") ? "bullish" : status.startsWith("bearish") ? "bearish" : null;
}
