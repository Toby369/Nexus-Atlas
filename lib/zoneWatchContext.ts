import { supabase } from "./supabase";
import type { Candle } from "./candles";
import type { OwnZone } from "./ownZones";
import type { OrderbookWallSnapshot } from "./types";
import { timeframeFromLabel, zoneKey, type ZoneTimeframe } from "./zoneHistory";
import { episodeStart, summarizeZoneWatch, zoneWatchLines } from "./zoneWatch";

// Zonen-Beobachtung (Phase 3) fuer die Seite: nur wenn der Kurs gerade an
// einer eigenen Zone steht, werden OI und Liquidationen seit dem Eintritt
// geladen (hoechstens 2 zusaetzliche Abfragen, sonst keine).

export interface ZoneWatchView {
  key: string;
  low: number;
  high: number;
  label: string | null;
  lines: string[];
  /** Beginn der letzten 15m-Kerze (ISO), Stand der Auswertung. */
  asOf: string;
}

const TF_TEXT: Record<ZoneTimeframe, string> = { "1h": "1h", "4h": "4h", "1d": "1D" };

export async function buildZoneWatches(
  ownZones: OwnZone[],
  c15: Candle[],
  zoneCandles: Record<ZoneTimeframe, Candle[]>,
  walls: OrderbookWallSnapshot[]
): Promise<ZoneWatchView[]> {
  const active = ownZones
    .map((z) => ({ z, level: { price: z.price, low: z.low ?? z.price, high: z.high ?? z.price } }))
    .map((x) => ({ ...x, start: episodeStart(c15, x.level) }))
    .filter((x): x is typeof x & { start: number } => x.start !== null);
  if (active.length === 0) return [];
  const sinceIso = c15[Math.min(...active.map((x) => x.start))].openTime;
  const [oiRes, liqRes] = await Promise.all([
    supabase
      .from("market_features")
      .select("candle_open_time, oi_current")
      .eq("symbol", "BTCUSDT")
      .eq("interval", "15m")
      .gte("candle_open_time", sinceIso)
      .order("candle_open_time", { ascending: true })
      .limit(200),
    supabase
      .from("liquidation_events")
      .select("event_time_utc, side")
      .eq("symbol", "BTCUSDT")
      .eq("status", "ok")
      .gte("event_time_utc", sinceIso)
      .limit(1000),
  ]);
  if (oiRes.error) console.error("Zonen-Beobachtung: OI nicht geladen:", oiRes.error.message);
  if (liqRes.error) console.error("Zonen-Beobachtung: Liquidationen nicht geladen:", liqRes.error.message);
  const oi = (oiRes.data ?? []).map((r) => ({ time: r.candle_open_time as string, oi: Number(r.oi_current) }));
  const liquidations = liqRes.error ? undefined : (liqRes.data ?? []).map((r) => ({ time: r.event_time_utc as string, side: r.side as string }));
  return active.flatMap(({ z, level }) => {
    const tf = timeframeFromLabel(z.label);
    const last = tf ? zoneCandles[tf][zoneCandles[tf].length - 1] : undefined;
    const w = summarizeZoneWatch({
      zone: level,
      c15,
      oi,
      liquidations,
      walls,
      tfCandle: tf && last ? { tf: TF_TEXT[tf], candle: last } : null,
    });
    return w
      ? [{ key: zoneKey(level.low, level.high), low: level.low, high: level.high, label: z.label, lines: zoneWatchLines(w), asOf: c15[c15.length - 1].openTime }]
      : [];
  });
}
