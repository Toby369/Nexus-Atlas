// Datenbeschaffung fuer die Liquidations-/Hebelkarte (Umsetzungsplan
// Phase 4, 05.09.2026) -- reine Lesefunktion, keine AI, kein Schreiben.
// Nutzt ausschliesslich bereits vorhandene Tabellen: candles (OHLCV +
// taker_buy_base_vol) und market_features.oi_current (Open Interest je
// Stunden-Kerze, von compute-market-state ohnehin schon fuer den
// oi_price-Faktor genutzt).
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

import { supabase } from "./supabase";
import { buildLeverageClusters, type LeverageMapResult, type OiCandlePoint } from "./leverageMap";

const SYMBOL = "BTCUSDT";
const EXCHANGE = "binance";
const INTERVAL = "1h";
// Groessenordnung wie im Vorbild (~41,6h volle Tiefe) -- genug Perioden fuer
// eine stabile Attribution, ohne dass Wochen alte OI-Zuwaechse noch mit
// vollem Gewicht in die aktuelle Karte einfliessen.
const LOOKBACK_HOURS = 48;

interface CandleRow {
  open_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  taker_buy_base_vol: number | null;
}

interface FeatureRow {
  candle_open_time: string;
  oi_current: number | null;
}

/** ~0.1% des Preises, auf eine "runde" Groessenordnung gerundet. */
function pickBucketSize(mid: number): number {
  const raw = mid * 0.001;
  if (!(raw > 0)) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  return Math.max(1, Math.round(raw / magnitude) * magnitude);
}

export async function buildLiveLeverageMap(): Promise<LeverageMapResult | null> {
  const sinceIso = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();

  const [{ data: candleRows }, { data: featureRows }] = await Promise.all([
    supabase
      .from("candles")
      .select("open_time, open, high, low, close, volume, taker_buy_base_vol")
      .eq("exchange", EXCHANGE)
      .eq("symbol", SYMBOL)
      .eq("interval", INTERVAL)
      .gte("open_time", sinceIso)
      .order("open_time", { ascending: true }),
    supabase
      .from("market_features")
      .select("candle_open_time, oi_current")
      .eq("symbol", SYMBOL)
      .eq("interval", INTERVAL)
      .gte("candle_open_time", sinceIso)
      .order("candle_open_time", { ascending: true }),
  ]);

  const candles = (candleRows ?? []) as CandleRow[];
  const features = (featureRows ?? []) as FeatureRow[];
  if (candles.length < 2 || features.length === 0) return null;

  const oiByTime = new Map(features.map((f) => [f.candle_open_time, f.oi_current]));

  const points: OiCandlePoint[] = [];
  for (const c of candles) {
    const oi = oiByTime.get(c.open_time);
    // Nur Perioden mit bekanntem OI verwenden -- eine Luecke wuerde sonst
    // faelschlich als OI-Rueckgang/-Aufbau interpretiert.
    if (oi === null || oi === undefined) continue;
    points.push({
      t: c.open_time,
      oi,
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: c.volume ?? 0,
      tb: c.taker_buy_base_vol ?? 0,
    });
  }

  if (points.length < 2) return null;

  const mid = points[points.length - 1].c;
  return buildLeverageClusters(points, { mid, bucketSize: pickBucketSize(mid) });
}
