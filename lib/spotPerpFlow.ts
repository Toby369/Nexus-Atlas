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
