import { supabase } from "./supabase";

// Abgeschlossene Binance-Kerzen fuer den Regelcheck (lib/ruleCheck.ts).

export interface Candle {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
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
): Promise<Candle[]> {
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
