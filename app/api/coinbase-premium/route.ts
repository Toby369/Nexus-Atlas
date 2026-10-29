import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import {
  computePremiumSeries,
  parseCoinbaseCandles,
  summarizePremium,
  type PricePoint,
} from "@/lib/coinbasePremium";

// GET /api/coinbase-premium
//
// Coinbase wird serverseitig abgefragt statt im Browser: die Exchange-API
// verlangt einen User-Agent und soll nicht von jedem Client einzeln
// angefragt werden. Binance-Seite kommt aus der eigenen DB (collect-spot-
// pressure), damit hier kein Aufruf an Binance noetig ist -- Binance blockt
// Anfragen aus US-Rechenzentren.

const COINBASE_CANDLES = "https://api.exchange.coinbase.com/products/{product}/candles?granularity=300";
const FETCH_TIMEOUT_MS = 8000;
// Coinbase liefert max. 300 Kerzen = 25 h; etwas mehr Binance-Historie
// laden, damit jede Coinbase-Kerze einen Partner finden kann.
const BINANCE_LOOKBACK_MS = 26 * 60 * 60 * 1000;

async function fetchCoinbase(product: "BTC-USD" | "USDT-USD"): Promise<PricePoint[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(COINBASE_CANDLES.replace("{product}", product), {
      signal: controller.signal,
      headers: { "User-Agent": "nexus-atlas", Accept: "application/json" },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Coinbase ${product} HTTP ${res.status}`);
    return parseCoinbaseCandles(await res.json());
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBinanceSpot(): Promise<PricePoint[]> {
  const since = new Date(Date.now() - BINANCE_LOOKBACK_MS).toISOString();
  const { data, error } = await supabase
    .from("spot_market_snapshots")
    .select("timestamp_utc, last_price")
    .eq("exchange", "binance")
    .eq("symbol", "BTCUSDT")
    .eq("status", "ok")
    .gte("timestamp_utc", since)
    .order("timestamp_utc", { ascending: true })
    .limit(400);
  if (error) throw new Error(`spot_market_snapshots: ${error.message}`);
  return (data ?? [])
    .filter((r) => r.last_price !== null)
    .map((r) => ({ t: Date.parse(r.timestamp_utc as string), close: Number(r.last_price) }));
}

export async function GET() {
  try {
    // USDT-USD rechnet Binance in echte USD um; ohne Kurse kein Ergebnis,
    // statt eines USDT-Abschlags, der als Praemie erscheint.
    const [coinbase, binance, usdtUsd] = await Promise.all([
      fetchCoinbase("BTC-USD"),
      fetchBinanceSpot(),
      fetchCoinbase("USDT-USD"),
    ]);
    if (usdtUsd.length === 0) throw new Error("Keine USDT-USD-Kurse von Coinbase");
    const series = computePremiumSeries(coinbase, binance, usdtUsd);
    return NextResponse.json({
      success: true,
      summary: summarizePremium(series),
      series: series.map((p) => ({ t: new Date(p.t).toISOString(), v: p.premiumPct })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
