import { supabase } from "./supabase";
import { fetchPaged } from "./fetchPaged";
import { economicEventMarkMs } from "./economicCalendar";
import type { OrderbookWallSnapshot } from "./types";
import {
  HOUR_MS,
  buildLageSeries,
  mergeCandleRows,
  onlyClosed,
  type CandleRow,
  type FeatureRow,
  type FundingSample,
  type HourlyCandle,
  type LageEvent,
  type LageSeries,
} from "./lageChart";
import type { LageWall } from "./lageChartSvg";

// Lage-Chart: laedt Kerzen, Features, Funding und Termine serverseitig und
// rechnet daraus die Serien (siehe lib/lageChart.ts). Alles nur lesend aus
// bestehenden Tabellen, keine neue Tabelle und kein neuer Sammler.
//
// Abfragen pro Seitenaufruf: Kerzen 1h + 4h, Features 1h + 4h, Funding
// (2 Seiten a 1000 Zeilen), Termine = 7 Anfragen.

const SYMBOL = "BTCUSDT";
const FUNDING_EXCHANGE = "binance";
// 800 1h-Kerzen decken den Monats-VWAP (max. 31 Tage = 744 Kerzen) ab.
const HOURLY_LIMIT = 800;
const FOUR_HOUR_LIMIT = 200;
// Funding-Snapshots kommen alle 5 Minuten; ~6,9 Tage = 1986 Zeilen = 2 Seiten.
const FUNDING_DAYS = 6.9;
const FUNDING_MAX_ROWS = 2000;

export const LAGE_KEEP: Record<"1h" | "4h", number> = { "1h": 168, "4h": 60 };

const FEATURE_COLS =
  "candle_open_time, ema_20, ema_50, ema_200, rsi_14, adx_14, atr_14, cvd_delta, cvd_cumulative, oi_delta_pct, basis_pct, bos, bos_direction, choch, choch_direction";

async function loadCandles(interval: "1h" | "4h", limit: number): Promise<CandleRow[]> {
  const { data, error } = await supabase
    .from("candles")
    .select("open_time, open, high, low, close, volume")
    .eq("exchange", "binance")
    .eq("symbol", SYMBOL)
    .eq("interval", interval)
    .order("open_time", { ascending: false })
    .limit(limit);
  if (error) {
    console.error(`Lage-Chart: Kerzen ${interval}:`, error.message);
    return [];
  }
  return (data ?? []) as CandleRow[];
}

async function loadFeatures(interval: "1h" | "4h", limit: number): Promise<FeatureRow[]> {
  const { data, error } = await supabase
    .from("market_features")
    .select(FEATURE_COLS)
    .eq("symbol", SYMBOL)
    .eq("interval", interval)
    .order("candle_open_time", { ascending: false })
    .limit(limit);
  if (error) {
    console.error(`Lage-Chart: Features ${interval}:`, error.message);
    return [];
  }
  return (data ?? []) as FeatureRow[];
}

async function loadFunding(nowMs: number): Promise<FundingSample[]> {
  const since = new Date(nowMs - FUNDING_DAYS * 24 * HOUR_MS).toISOString();
  const { rows, error } = await fetchPaged<{ timestamp_utc: string; funding_rate: number | string | null }>(
    (from, to) =>
      supabase
        .from("market_snapshots")
        .select("timestamp_utc, funding_rate")
        .eq("exchange", FUNDING_EXCHANGE)
        .eq("symbol", SYMBOL)
        .eq("status", "ok")
        .gte("timestamp_utc", since)
        .order("timestamp_utc", { ascending: true })
        .range(from, to),
    FUNDING_MAX_ROWS
  );
  if (error) console.error("Lage-Chart: Funding:", error);
  return rows
    .filter((r) => r.funding_rate !== null)
    .map((r) => ({ t: new Date(r.timestamp_utc).getTime(), rate: Number(r.funding_rate) }));
}

async function loadEvents(nowMs: number): Promise<LageEvent[]> {
  const day = 24 * HOUR_MS;
  const from = new Date(nowMs - 9 * day).toISOString().slice(0, 10);
  const to = new Date(nowMs + 3 * day).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("economic_calendar_events")
    .select("event_key, label, event_date")
    .gte("event_date", from)
    .lte("event_date", to);
  if (error) {
    console.error("Lage-Chart: Termine:", error.message);
    return [];
  }
  const events: LageEvent[] = [];
  for (const e of data ?? []) {
    const t = economicEventMarkMs(e.event_key as string, e.event_date as string);
    if (t !== null) events.push({ t, label: e.label as string });
  }
  return events.sort((a, b) => a.t - b.t);
}

export interface LageChartData {
  series: Record<"1h" | "4h", LageSeries>;
  events: LageEvent[];
  /** Zeitpunkt der Berechnung (UTC-ms), fuer "Stand". */
  asOf: number;
}

export async function buildLageChart(nowMs: number = Date.now()): Promise<LageChartData | null> {
  const [c1h, f1h, c4h, f4h, funding, events] = await Promise.all([
    loadCandles("1h", HOURLY_LIMIT),
    loadFeatures("1h", HOURLY_LIMIT),
    loadCandles("4h", FOUR_HOUR_LIMIT),
    loadFeatures("4h", FOUR_HOUR_LIMIT),
    loadFunding(nowMs),
    loadEvents(nowMs),
  ]);
  if (c1h.length === 0 || c4h.length === 0) return null;

  const hourlyCandles = onlyClosed(mergeCandleRows(c1h, f1h), 1, nowMs);
  const fourHourCandles = onlyClosed(mergeCandleRows(c4h, f4h), 4, nowMs);
  const hourly: HourlyCandle[] = hourlyCandles.map((c) => ({
    t: c.t,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
  }));

  return {
    series: {
      "1h": buildLageSeries({ interval: "1h", candles: hourlyCandles, hourly, funding, events, keep: LAGE_KEEP["1h"] }),
      "4h": buildLageSeries({ interval: "4h", candles: fourHourCandles, hourly, funding, events, keep: LAGE_KEEP["4h"] }),
    },
    events,
    asOf: nowMs,
  };
}

/** Groesste Wand je Seite von Binance (sonst der erste Eintrag), fuer die Linien im Chart. */
export function wallsForChart(snapshots: OrderbookWallSnapshot[]): LageWall[] {
  const pick = snapshots.find((s) => s.exchange === "binance") ?? snapshots[0];
  if (!pick) return [];
  const walls: LageWall[] = [];
  if (pick.bid_wall_price !== null && pick.bid_wall_usd !== null) {
    walls.push({ side: "bid", price: pick.bid_wall_price, usd: pick.bid_wall_usd });
  }
  if (pick.ask_wall_price !== null && pick.ask_wall_usd !== null) {
    walls.push({ side: "ask", price: pick.ask_wall_price, usd: pick.ask_wall_usd });
  }
  return walls;
}
