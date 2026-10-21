// Zonen-Trainer: Toby zeichnet Zonen in einen 4H-Ausschnitt, danach werden
// die naechsten Kerzen aufgedeckt und jede Zone bewertet. Die Schwellen
// (1,5 % Abprall, 0,3 % Bruch, 2 Tage Fenster) sind Lern-Faustregeln.

export type Ohlc = [open: number, high: number, low: number, close: number];

export interface Zone {
  lo: number;
  hi: number;
}

export const ZONE_HIST_CANDLES = 120; // 20 Tage auf 4H
export const ZONE_FUTURE_CANDLES = 36; // 6 Tage auf 4H
export const REACT_PCT = 0.015;
export const BREAK_PCT = 0.003;
export const REACT_WINDOW = 12; // 2 Tage auf 4H
export const MAX_ZONES = 6;

export type ZoneResultKind = "react" | "break" | "weak" | "none";

export interface ZoneResult {
  kind: ZoneResultKind;
  /** Index der ersten Kerze nach dem Schnitt, die die Zone erreicht (0-basiert), sonst null. */
  touchedAt: number | null;
}

export const ZONE_RESULT_LABELS: Record<ZoneResultKind, string> = {
  react: "Reaktion",
  break: "Durchbrochen",
  weak: "Berührt",
  none: "Nicht erreicht",
};

/**
 * Zone ueber dem letzten Schluss = Widerstand, darunter = Unterstuetzung.
 * Reaktion: nach der ersten Beruehrung innerhalb von REACT_WINDOW Kerzen
 * mindestens REACT_PCT Abprall, bevor eine Kerze mehr als BREAK_PCT hinter
 * der Zone schliesst.
 */
export function evaluateZone(candles: Ohlc[], nHist: number, z: Zone): ZoneResult {
  const last = candles[nHist - 1][3];
  const above = (z.lo + z.hi) / 2 > last;
  const future = candles.slice(nHist);
  const t = future.findIndex(([, h, l]) => (above ? h >= z.lo : l <= z.hi));
  if (t < 0) return { kind: "none", touchedAt: null };
  // In der Beruehrungskerze ist die Reihenfolge von Hoch und Tief unbekannt
  // (sie kam ja von der anderen Seite); dort zaehlt nur der Schluss als Bruch.
  const touchClose = future[t][3];
  if (above ? touchClose > z.hi * (1 + BREAK_PCT) : touchClose < z.lo * (1 - BREAK_PCT)) {
    return { kind: "break", touchedAt: t };
  }
  for (const [, h, l, c] of future.slice(t + 1, t + REACT_WINDOW + 1)) {
    if (above) {
      if (c > z.hi * (1 + BREAK_PCT)) return { kind: "break", touchedAt: t };
      if (l <= z.lo * (1 - REACT_PCT)) return { kind: "react", touchedAt: t };
    } else {
      if (c < z.lo * (1 - BREAK_PCT)) return { kind: "break", touchedAt: t };
      if (h >= z.hi * (1 + REACT_PCT)) return { kind: "react", touchedAt: t };
    }
  }
  return { kind: "weak", touchedAt: t };
}

interface Pivot {
  price: number;
  index: number;
}

function pivots(candles: Ohlc[], n: number): Pivot[] {
  const out: Pivot[] = [];
  for (let i = n; i < candles.length - n; i++) {
    const win = candles.slice(i - n, i + n + 1);
    if (candles[i][1] === Math.max(...win.map((k) => k[1]))) out.push({ price: candles[i][1], index: i });
    if (candles[i][2] === Math.min(...win.map((k) => k[2]))) out.push({ price: candles[i][2], index: i });
  }
  return out;
}

export interface RefZone extends Zone {
  touches: number;
}

/**
 * Automatische Vergleichszonen aus Swing-Hochs und -Tiefs der Vorgeschichte
 * (5 Kerzen links/rechts), um einen Anker auf 0,6 % gruppiert, mindestens
 * +-0,25 % breit, nahe Zonen zusammengelegt. Je zwei naechste ueber und
 * unter dem letzten Schluss, bevorzugt mit mindestens zwei Beruehrungen.
 */
export function referenceZones(candles: Ohlc[], nHist: number): RefZone[] {
  const hist = candles.slice(0, nHist);
  const last = hist[hist.length - 1][3];
  const highs = hist.map((k) => k[1]);
  const lows = hist.map((k) => k[2]);
  const pv = pivots(hist, 5);
  pv.push({ price: Math.max(...highs), index: highs.indexOf(Math.max(...highs)) });
  pv.push({ price: Math.min(...lows), index: lows.indexOf(Math.min(...lows)) });
  pv.sort((a, b) => a.price - b.price);

  const clusters: Pivot[][] = [];
  for (const p of pv) {
    const cl = clusters[clusters.length - 1];
    if (cl && p.price <= cl[0].price * 1.006) cl.push(p);
    else clusters.push([p]);
  }
  let zones: RefZone[] = clusters.map((cl) => {
    let lo = Math.min(...cl.map((p) => p.price));
    let hi = Math.max(...cl.map((p) => p.price));
    const mid = (lo + hi) / 2;
    lo = Math.min(lo, mid * 0.9975);
    hi = Math.max(hi, mid * 1.0025);
    return { lo, hi, touches: new Set(cl.map((p) => p.index)).size };
  });
  const merged: RefZone[] = [];
  for (const z of zones) {
    const m = merged[merged.length - 1];
    if (m && z.lo <= m.hi * 1.004 && (Math.max(z.hi, m.hi) - m.lo) / m.lo < 0.012) {
      m.hi = Math.max(m.hi, z.hi);
      m.touches += z.touches;
    } else merged.push({ ...z });
  }
  zones = merged;
  const pick = (list: RefZone[]) => {
    const out = list.filter((z) => z.touches >= 2).slice(0, 2);
    for (const z of list) if (out.length < 2 && !out.includes(z)) out.push(z);
    return out;
  };
  const above = zones.filter((z) => z.lo > last).sort((a, b) => a.lo - b.lo);
  const below = zones.filter((z) => z.hi < last).sort((a, b) => b.hi - a.hi);
  return [...pick(above), ...pick(below)];
}

export type Regime = "up" | "down" | "range";

/** Grobe Einordnung der Vorgeschichte fuer die Auswertung: Veraenderung ueber 20 Tage. */
export function classifyRegime(candles: Ohlc[], nHist: number): Regime {
  const first = candles[0][0];
  const last = candles[nHist - 1][3];
  const change = (last - first) / first;
  if (change > 0.08) return "up";
  if (change < -0.08) return "down";
  return "range";
}

export const REGIME_TEXT: Record<Regime, string> = {
  up: "Aufwärtstrend in der Vorgeschichte (über +8 % in 20 Tagen). Alte Widerstände werden nach dem Ausbruch oft zu Unterstützungen.",
  down: "Abwärtstrend in der Vorgeschichte (über −8 % in 20 Tagen). Unterstützungen halten oft nur kurz, Erholungen scheitern an alten Tiefs.",
  range: "Seitwärtsphase in der Vorgeschichte (weniger als ±8 % in 20 Tagen). Die Range-Ränder sind die wichtigsten Zonen.",
};

/** Tipps nach dem Aufdecken, aus den eigenen Zonen abgeleitet. */
export function zoneTips(candles: Ohlc[], nHist: number, zones: Zone[]): string[] {
  const last = candles[nHist - 1][3];
  const tips: string[] = [];
  const hasAbove = zones.some((z) => z.lo > last);
  const hasBelow = zones.some((z) => z.hi < last);
  if (zones.length > 0 && (!hasAbove || !hasBelow)) {
    tips.push(
      `Du hast nur Zonen ${hasAbove ? "über" : "unter"} dem Preis eingezeichnet. Zeichne immer die nächste Zone auf beiden Seiten, denn vorher weisst du nicht, wohin es geht.`
    );
  }
  if (zones.length > 5) tips.push("Viele Zonen machen es leicht, irgendwo richtig zu liegen. Übe, dich auf 4 gute zu beschränken.");
  if (zones.some((z) => (z.hi - z.lo) / z.lo > 0.015)) {
    tips.push("Eine Zone ist breiter als 1,5 %. Zu breite Zonen taugen nicht für Stop und Einstieg. Ziel: Docht bis Körper.");
  }
  const results = zones.map((z) => evaluateZone(candles, nHist, z));
  const reached = results.filter((r) => r.kind !== "none");
  if (reached.length > 0 && reached.filter((r) => r.kind === "react").length / reached.length < 0.5) {
    tips.push("Weniger als die Hälfte deiner erreichten Zonen hat reagiert. Achte auf Stellen mit scharfem Abprall und mehreren Berührungen.");
  }
  return tips;
}
