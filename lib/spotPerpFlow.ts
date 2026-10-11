// Vergleich des Netto-Taker-Flows (CVD ueber ein Zeitfenster) auf dem
// Spot- und dem Perp-Markt. Beantwortet, WER eine Bewegung traegt: echte
// Spot-Kaeufer/-Verkaeufer oder Hebel-Trader auf den Perps.
//
// Spot: Binance Spot BTCUSDT (spot_market_snapshots, dieselbe Basis wie
// Spot Pressure). Perp: Binance Futures BTCUSDT (candles, collect-candles).
// Beide liefern den echten Taker-Buy-Anteil je Kerze, keine Schaetzung.
//
// Schwellen: Spot nutzt dieselbe ±5 %-Grenze wie das Spot-Pressure-Verdikt.
// Perp-Flow schwankt deutlich weniger (60-Tage-Auswertung 08–10/2026,
// Tagesfenster: Median |Perp-Netto| 2,3 %, |Spot-Netto| 5,2 %), daher ±2 %.
// Beide Schwellen liegen damit etwa beim Median: "steigt/faellt" heisst
// "staerker als an einem typischen Tag".

import { FLAT_THRESHOLD_PCT as SPOT_FLAT_THRESHOLD_PCT } from "./spotPressure";

export const PERP_FLAT_THRESHOLD_PCT = 2;
// Unter dieser Abdeckung der erwarteten Perp-Kerzen keine Aussage.
const MIN_PERP_COVERAGE = 0.5;

export type FlowDirection = "up" | "flat" | "down";
export type SpotPerpTone = "bullish" | "bearish" | "watch" | "neutral";

export interface PerpCandleRow {
  volume: number;
  taker_buy_base_vol: number | null;
}

export interface SpotPerpVerdict {
  key: `${FlowDirection}|${FlowDirection}`;
  label: string;
  tone: SpotPerpTone;
  text: string;
}

export interface SpotPerpFlowResult {
  spotNetPct: number | null;
  perpNetPct: number | null;
  spotDirection: FlowDirection | null;
  perpDirection: FlowDirection | null;
  /** Perp-Volumen als Vielfaches des Spot-Volumens im selben Fenster. */
  perpToSpotVolume: number | null;
  verdict: SpotPerpVerdict | null;
}

const VERDICTS: Record<SpotPerpVerdict["key"], Omit<SpotPerpVerdict, "key">> = {
  "up|up": {
    label: "Breite Nachfrage",
    tone: "bullish",
    text: "Spot und Perps kaufen gemeinsam. Stärkste Konstellation; wird Funding extrem, kippt sie in Überhitzung.",
  },
  "up|flat": {
    label: "Organische Nachfrage",
    tone: "bullish",
    text: "Spot-Käufer tragen den Markt, Hebel hält sich zurück. Solche Anstiege sind tendenziell nachhaltiger.",
  },
  "up|down": {
    label: "Spot-Absorption",
    tone: "watch",
    text: "Spot kauft, auf den Perps wird verkauft (oft Absicherungen oder Basis-Trades). Steigt der Preis trotzdem, geraten Perp-Shorts unter Druck.",
  },
  "flat|up": {
    label: "Hebelgetrieben",
    tone: "watch",
    text: "Nur Perp-Käufer treiben, Spot zieht nicht mit. Fragil, Liquidationsrisiko bei einem Rücksetzer.",
  },
  "flat|flat": {
    label: "Kein klarer Treiber",
    tone: "neutral",
    text: "Keine Seite handelt auffällig aggressiv. Eher Range.",
  },
  "flat|down": {
    label: "Perp-Druck",
    tone: "watch",
    text: "Hebel-Shorts drücken, Spot verkauft nicht mit. Hält ein wichtiges Level, droht ein Short-Squeeze.",
  },
  "down|up": {
    label: "Dip-Käufer gegen Verteilung",
    tone: "bearish",
    text: "Perp-Trader kaufen den Rücksetzer, Spot-Halter verkaufen in sie hinein. Warnsignal für gefangene Longs.",
  },
  "down|flat": {
    label: "Echter Spot-Verkauf",
    tone: "bearish",
    text: "Spot-Halter verkaufen ohne Hebel-Beteiligung. Deutet auf Verteilung hin.",
  },
  "down|down": {
    label: "Breiter Verkauf",
    tone: "bearish",
    text: "Spot und Perps verkaufen gemeinsam. Hohes Kaskadenrisiko, besonders nach vorher hohem Open Interest.",
  },
};

export function classifyFlow(netPct: number | null, thresholdPct: number): FlowDirection | null {
  if (netPct === null || !Number.isFinite(netPct)) return null;
  if (netPct > thresholdPct) return "up";
  if (netPct < -thresholdPct) return "down";
  return "flat";
}

/** Netto-Taker-Flow in % des Volumens: (Kauf − Verkauf) / Gesamt. */
export function perpNetFlow(rows: PerpCandleRow[]): { netPct: number | null; volume: number } {
  let volume = 0;
  let delta = 0;
  for (const r of rows) {
    if (r.taker_buy_base_vol === null || !Number.isFinite(r.volume)) continue;
    volume += r.volume;
    delta += 2 * r.taker_buy_base_vol - r.volume;
  }
  return { netPct: volume > 0 ? (delta / volume) * 100 : null, volume };
}

/** Kerzen-Intervall fuer das Perp-Fenster, so gewaehlt, dass es unter dem 1000-Zeilen-Deckel von PostgREST bleibt. */
export function perpIntervalFor(windowMinutes: number): { interval: "1m" | "15m" | "1h" | "4h"; minutes: number } {
  if (windowMinutes <= 4 * 60) return { interval: "1m", minutes: 1 };
  if (windowMinutes <= 24 * 60) return { interval: "15m", minutes: 15 };
  if (windowMinutes <= 7 * 24 * 60) return { interval: "1h", minutes: 60 };
  return { interval: "4h", minutes: 240 };
}

export function compareSpotPerpFlow(input: {
  spotBuy: number | null;
  spotSell: number | null;
  perpRows: PerpCandleRow[];
  expectedPerpCandles: number;
}): SpotPerpFlowResult {
  const { spotBuy, spotSell, perpRows, expectedPerpCandles } = input;
  const spotVolume = spotBuy !== null && spotSell !== null ? spotBuy + spotSell : null;
  const spotNetPct =
    spotVolume !== null && spotVolume > 0 && spotBuy !== null && spotSell !== null
      ? ((spotBuy - spotSell) / spotVolume) * 100
      : null;

  const coverage = expectedPerpCandles > 0 ? perpRows.length / expectedPerpCandles : 0;
  const perp = coverage >= MIN_PERP_COVERAGE ? perpNetFlow(perpRows) : { netPct: null, volume: 0 };

  const spotDirection = classifyFlow(spotNetPct, SPOT_FLAT_THRESHOLD_PCT);
  const perpDirection = classifyFlow(perp.netPct, PERP_FLAT_THRESHOLD_PCT);
  const key = spotDirection && perpDirection ? (`${spotDirection}|${perpDirection}` as const) : null;

  return {
    spotNetPct,
    perpNetPct: perp.netPct,
    spotDirection,
    perpDirection,
    perpToSpotVolume: spotVolume && perp.volume > 0 ? perp.volume / spotVolume : null,
    verdict: key ? { key, ...VERDICTS[key] } : null,
  };
}

// --- Verlauf: Spot-CVD gegen Perp-CVD -------------------------------------
// Kumulierter Netto-Taker-Flow je Markt, normiert auf dessen Gesamtvolumen im
// Fenster -- dadurch sind Spot und Perp trotz ~10x Volumenunterschied auf
// einer Achse vergleichbar, und der letzte Punkt entspricht dem Netto-Flow
// oben in der Anzeige. Divergenz = Spot minus Perp: positiv, wenn Spot
// relativ staerker kauft als die Perps.

export interface SpotFlowPoint {
  t: number; // ms
  buy: number | null;
  sell: number | null;
}

export interface PerpFlowPoint {
  t: number; // ms
  volume: number;
  takerBuy: number | null;
}

export interface CvdComparisonPoint {
  t: number;
  spot: number;
  perp: number;
  divergence: number;
}

export function buildCvdComparison(
  spot: SpotFlowPoint[],
  perp: PerpFlowPoint[],
  bucketMs: number
): CvdComparisonPoint[] {
  const spotBuckets = new Map<number, { delta: number; volume: number }>();
  for (const p of spot) {
    if (p.buy === null || p.sell === null) continue;
    const key = Math.floor(p.t / bucketMs) * bucketMs;
    const b = spotBuckets.get(key) ?? { delta: 0, volume: 0 };
    b.delta += p.buy - p.sell;
    b.volume += p.buy + p.sell;
    spotBuckets.set(key, b);
  }
  const perpBuckets = new Map<number, { delta: number; volume: number }>();
  for (const p of perp) {
    if (p.takerBuy === null || !Number.isFinite(p.volume)) continue;
    const key = Math.floor(p.t / bucketMs) * bucketMs;
    const b = perpBuckets.get(key) ?? { delta: 0, volume: 0 };
    b.delta += 2 * p.takerBuy - p.volume;
    b.volume += p.volume;
    perpBuckets.set(key, b);
  }
  if (spotBuckets.size === 0 || perpBuckets.size === 0) return [];

  const sum = (m: Map<number, { volume: number }>) => [...m.values()].reduce((a, b) => a + b.volume, 0);
  const spotTotal = sum(spotBuckets);
  const perpTotal = sum(perpBuckets);
  if (spotTotal <= 0 || perpTotal <= 0) return [];

  // Erst ab dem Bucket, in dem beide Maerkte Daten haben -- sonst startet eine
  // Linie scheinbar bei 0, waehrend die andere schon laeuft.
  const start = Math.max(Math.min(...spotBuckets.keys()), Math.min(...perpBuckets.keys()));
  const keys = [...new Set([...spotBuckets.keys(), ...perpBuckets.keys()])].sort((a, b) => a - b);

  let spotCum = 0;
  let perpCum = 0;
  const out: CvdComparisonPoint[] = [];
  for (const k of keys) {
    spotCum += spotBuckets.get(k)?.delta ?? 0;
    perpCum += perpBuckets.get(k)?.delta ?? 0;
    if (k < start) continue;
    const s = (spotCum / spotTotal) * 100;
    const p = (perpCum / perpTotal) * 100;
    out.push({ t: k, spot: s, perp: p, divergence: s - p });
  }
  return out;
}
