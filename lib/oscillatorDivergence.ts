import { supabase } from "./supabase";
import { findPivots } from "./swingDetection";

// RSI-/MACD-Divergenz auf 1H/4H/1D -- Tobys Regelwerk (Entscheid 14.10.2026):
// StochRSI faellt im ganzen System weg, gezaehlt werden RSI- und MACD-
// Divergenzen, klassisch und versteckt, und zwar IMMER nur als Hinweis/
// Warnung, nie als Pflicht oder Sperre.
//
// Methode wie detectCvdDivergence() in tradingIndicatorsContext.ts: Pivots
// auf den Schlusskursen, der Oszillator wird an genau diesen Pivot-Indizes
// verglichen (kein zweites, versetztes Oszillator-Pivot).
//   klassisch bärisch: Preis hoeheres Hoch, Oszillator tieferes Hoch
//   versteckt bärisch: Preis tieferes Hoch, Oszillator hoeheres Hoch
//   klassisch bullisch: Preis tieferes Tief, Oszillator hoeheres Tief
//   versteckt bullisch: Preis hoeheres Tief, Oszillator tieferes Tief

export type DivergenceInterval = "1h" | "4h" | "1d";
export type DivergenceOscillator = "RSI" | "MACD";

export interface OscillatorDivergence {
  interval: DivergenceInterval;
  oscillator: DivergenceOscillator;
  direction: "bullish" | "bearish";
  kind: "klassisch" | "versteckt";
  atOpenTime: string;
}

export const DIVERGENCE_INTERVALS: DivergenceInterval[] = ["1h", "4h", "1d"];
export const INTERVAL_LABEL: Record<DivergenceInterval, string> = { "1h": "1H", "4h": "4H", "1d": "1D" };

/** Kerzen links/rechts, die ein Pivot bestaetigen. */
export const DIVERGENCE_PIVOT_LOOKBACK = 5;
/** Nur aktuelle Divergenzen: das juengere Pivot liegt hoechstens so viele Kerzen zurueck. */
export const DIVERGENCE_MAX_AGE_CANDLES = 15;
const FETCH_CANDLES = 120;

interface SeriesPoint {
  openTime: string;
  close: number;
  rsi: number | null;
  macdHist: number | null;
}

function compare(
  series: SeriesPoint[],
  osc: (p: SeriesPoint) => number | null,
  kind: "high" | "low"
): { direction: "bullish" | "bearish"; kind: "klassisch" | "versteckt"; index: number } | null {
  const pivots = findPivots(
    series.map((p) => p.close),
    DIVERGENCE_PIVOT_LOOKBACK
  ).filter((p) => p.kind === kind);
  if (pivots.length < 2) return null;
  const prev = pivots[pivots.length - 2];
  const latest = pivots[pivots.length - 1];
  if (series.length - 1 - latest.index > DIVERGENCE_MAX_AGE_CANDLES) return null;
  const oPrev = osc(series[prev.index]);
  const oLatest = osc(series[latest.index]);
  if (oPrev === null || oLatest === null) return null;

  const priceUp = latest.value > prev.value;
  const oscUp = oLatest > oPrev;
  if (priceUp === oscUp) return null;
  if (kind === "high") {
    return { direction: "bearish", kind: priceUp ? "klassisch" : "versteckt", index: latest.index };
  }
  return { direction: "bullish", kind: priceUp ? "versteckt" : "klassisch", index: latest.index };
}

/** Juengste Divergenz je Oszillator in einer chronologischen Serie (aelteste zuerst). */
export function detectOscillatorDivergences(
  interval: DivergenceInterval,
  series: SeriesPoint[]
): OscillatorDivergence[] {
  const result: OscillatorDivergence[] = [];
  const oscillators: [DivergenceOscillator, (p: SeriesPoint) => number | null][] = [
    ["RSI", (p) => p.rsi],
    ["MACD", (p) => p.macdHist],
  ];
  for (const [name, osc] of oscillators) {
    const found = [compare(series, osc, "high"), compare(series, osc, "low")]
      .filter((d): d is NonNullable<typeof d> => d !== null)
      .sort((a, b) => b.index - a.index)[0];
    if (found) {
      result.push({
        interval,
        oscillator: name,
        direction: found.direction,
        kind: found.kind,
        atOpenTime: series[found.index].openTime,
      });
    }
  }
  return result;
}

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

export async function fetchOscillatorDivergences(): Promise<OscillatorDivergence[]> {
  const perInterval = await Promise.all(
    DIVERGENCE_INTERVALS.map(async (interval) => {
      const { data, error } = await supabase
        .from("market_features")
        .select("candle_open_time, close_price, rsi_14, macd_histogram")
        .eq("symbol", "BTCUSDT")
        .eq("interval", interval)
        .order("candle_open_time", { ascending: false })
        .limit(FETCH_CANDLES);
      if (error || !data) {
        if (error) console.error(`Divergenz ${interval}: Fehler beim Laden:`, error.message);
        return [];
      }
      const series = data
        .slice()
        .reverse()
        .flatMap((r) => {
          const close = num(r.close_price);
          return close === null
            ? []
            : [{ openTime: r.candle_open_time as string, close, rsi: num(r.rsi_14), macdHist: num(r.macd_histogram) }];
        });
      return detectOscillatorDivergences(interval, series);
    })
  );
  return perInterval.flat();
}

/** Kurztext, z.B. "4H RSI klassisch bärisch". */
export function formatDivergence(d: OscillatorDivergence): string {
  return `${INTERVAL_LABEL[d.interval]} ${d.oscillator} ${d.kind} ${d.direction === "bullish" ? "bullisch" : "bärisch"}`;
}
