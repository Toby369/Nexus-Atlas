import { supabase } from "./supabase";

// "Hat die letzte 4H-Kerze mit dem Koerper ueber/unter dem Level
// geschlossen?" (Regelwerk Punkt 1, 14.10.2026: ein Docht allein zaehlt
// nicht). Verglichen werden die letzten zwei abgeschlossenen 4H-Kerzen:
// liegt ein Keylevel zwischen dem vorletzten und dem letzten Schluss, ist
// es mit dem Koerper gebrochen; reicht nur der Docht darueber/darunter, ist
// es ein Docht-Test.

export interface Candle4h {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
}

export type BreakoutKind = "body_above" | "body_below" | "wick_above" | "wick_below" | "none";

export interface FourHourBreakout {
  kind: BreakoutKind;
  level: number | null;
  candle: Candle4h | null;
}

export function evaluateFourHourBreakout(
  levels: number[],
  prev: Candle4h | null,
  last: Candle4h | null
): FourHourBreakout {
  if (!prev || !last) return { kind: "none", level: null, candle: last };
  const nearestTo = (list: number[]) =>
    list.sort((a, b) => Math.abs(a - last.close) - Math.abs(b - last.close))[0] ?? null;

  const bodyAbove = nearestTo(levels.filter((l) => prev.close < l && last.close > l));
  if (bodyAbove !== null) return { kind: "body_above", level: bodyAbove, candle: last };
  const bodyBelow = nearestTo(levels.filter((l) => prev.close > l && last.close < l));
  if (bodyBelow !== null) return { kind: "body_below", level: bodyBelow, candle: last };
  const bodyTop = Math.max(last.open, last.close);
  const bodyBottom = Math.min(last.open, last.close);
  const wickAbove = nearestTo(levels.filter((l) => last.high > l && bodyTop < l));
  if (wickAbove !== null) return { kind: "wick_above", level: wickAbove, candle: last };
  const wickBelow = nearestTo(levels.filter((l) => last.low < l && bodyBottom > l));
  if (wickBelow !== null) return { kind: "wick_below", level: wickBelow, candle: last };
  return { kind: "none", level: null, candle: last };
}

const INTERVAL_MS = { "15m": 15 * 60 * 1000, "1h": 60 * 60 * 1000, "4h": 4 * 60 * 60 * 1000 } as const;
export type CandleInterval = keyof typeof INTERVAL_MS;

export function intervalMs(interval: CandleInterval): number {
  return INTERVAL_MS[interval];
}

/** Letzte abgeschlossene Kerzen (Binance), aelteste zuerst. */
export async function fetchClosedCandles(
  interval: CandleInterval,
  limit: number,
  nowMs: number = Date.now()
): Promise<Candle4h[]> {
  const { data, error } = await supabase
    .from("candles")
    .select("open_time, open, high, low, close")
    .eq("exchange", "binance")
    .eq("symbol", "BTCUSDT")
    .eq("interval", interval)
    .order("open_time", { ascending: false })
    .limit(limit + 1);
  if (error || !data) {
    if (error) console.error(`Kerzen ${interval}: Fehler beim Laden:`, error.message);
    return [];
  }
  return data
    .map((r) => ({
      openTime: r.open_time as string,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
    }))
    .filter((c) => new Date(c.openTime).getTime() + INTERVAL_MS[interval] <= nowMs)
    .slice(0, limit)
    .reverse();
}

/** Letzte zwei abgeschlossene 4H-Kerzen (Binance), aelteste zuerst. */
export async function fetchLastClosed4h(nowMs: number = Date.now()): Promise<[Candle4h | null, Candle4h | null]> {
  const closed = await fetchClosedCandles("4h", 2, nowMs);
  return [closed[closed.length - 2] ?? null, closed[closed.length - 1] ?? null];
}
