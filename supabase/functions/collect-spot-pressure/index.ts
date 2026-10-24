import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// BTC Spot Buying/Selling Pressure Collector.
// Bewusst nur Binance Spot: die einzige oeffentliche, kostenlose Kline-Route,
// die den Taker-Buy/Sell-Split je Kerze mitliefert (Bybit/OKX-Spot-Klines
// tun das nicht). Ein Datenpunkt pro abgeschlossener 5-Min-Kerze, gleicher
// Takt wie die uebrigen Market-Collectoren. taker_sell_vol wird nicht
// geschaetzt, sondern exakt aus base_volume - taker_buy_vol berechnet (Binance
// liefert beide Rohwerte direkt aus dem Trade-Tape).
//
// Es wird immer die letzte GARANTIERT abgeschlossene Kerze verwendet (bei
// limit=2 also data[0]), nie die noch offene aktuelle Kerze -- sonst waere
// der Buy/Sell-Split unvollstaendig und wuerde eine falsche Richtung
// suggerieren.

interface SpotCandleSnapshot {
  timestamp_utc: string;
  last_price: number | null;
  open_price: number | null;
  base_volume: number | null;
  quote_volume: number | null;
  taker_buy_vol: number | null;
  taker_sell_vol: number | null;
  taker_buy_quote_vol: number | null;
  taker_sell_quote_vol: number | null;
  taker_buy_sell_ratio: number | null;
  trade_count: number | null;
  status: "ok" | "error";
  error: string | null;
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} bei ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function errorSnapshot(err: unknown): SpotCandleSnapshot {
  const message = err instanceof Error ? err.message : String(err);
  return {
    timestamp_utc: new Date().toISOString(),
    last_price: null,
    open_price: null,
    base_volume: null,
    quote_volume: null,
    taker_buy_vol: null,
    taker_sell_vol: null,
    taker_buy_quote_vol: null,
    taker_sell_quote_vol: null,
    taker_buy_sell_ratio: null,
    trade_count: null,
    status: "error",
    error: message,
  };
}

async function collectSpotPressure(symbol: string): Promise<SpotCandleSnapshot> {
  try {
    const klines = await fetchJson(
      `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=5m&limit=2`,
    );
    const candle = klines?.[0];
    if (!Array.isArray(candle) || candle.length < 10) {
      throw new Error("Unvollstaendige Binance-Kline-Antwort");
    }

    const [openTimeMs, open, , , close, volume, , quoteVolume, numTrades, takerBuyBaseVol, takerBuyQuoteVol] =
      candle;

    const baseVolume = parseFloat(volume);
    const quoteVol = parseFloat(quoteVolume);
    const takerBuyVol = parseFloat(takerBuyBaseVol);
    const takerBuyQuoteVolNum = parseFloat(takerBuyQuoteVol);
    const takerSellVol = baseVolume - takerBuyVol;
    const takerSellQuoteVol = quoteVol - takerBuyQuoteVolNum;

    return {
      timestamp_utc: new Date(openTimeMs).toISOString(),
      last_price: parseFloat(close),
      open_price: parseFloat(open),
      base_volume: baseVolume,
      quote_volume: quoteVol,
      taker_buy_vol: takerBuyVol,
      taker_sell_vol: takerSellVol,
      taker_buy_quote_vol: takerBuyQuoteVolNum,
      taker_sell_quote_vol: takerSellQuoteVol,
      taker_buy_sell_ratio: takerSellVol !== 0 ? takerBuyVol / takerSellVol : null,
      trade_count: Number.isFinite(numTrades) ? numTrades : parseInt(numTrades, 10),
      status: "ok",
      error: null,
    };
  } catch (err) {
    return errorSnapshot(err);
  }
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const symbol = "BTCUSDT";
  const snapshot = await collectSpotPressure(symbol);

  // Dieselbe abgeschlossene Kerze mehrfach abzufragen (z.B. bei einem
  // verspaeteten Cron-Tick) darf keine Duplikatzeile erzeugen -- Konflikt auf
  // (exchange, symbol, timestamp_utc) still ignorieren statt zu fehlern.
  const { error: insertError } = await supabase
    .from("spot_market_snapshots")
    .upsert(
      {
        timestamp_utc: snapshot.timestamp_utc,
        symbol,
        exchange: "binance",
        interval_minutes: 5,
        last_price: snapshot.last_price,
        open_price: snapshot.open_price,
        base_volume: snapshot.base_volume,
        quote_volume: snapshot.quote_volume,
        taker_buy_vol: snapshot.taker_buy_vol,
        taker_sell_vol: snapshot.taker_sell_vol,
        taker_buy_quote_vol: snapshot.taker_buy_quote_vol,
        taker_sell_quote_vol: snapshot.taker_sell_quote_vol,
        taker_buy_sell_ratio: snapshot.taker_buy_sell_ratio,
        trade_count: snapshot.trade_count,
        status: snapshot.status,
        error: snapshot.error,
      },
      { onConflict: "exchange,symbol,timestamp_utc", ignoreDuplicates: true },
    );

  if (insertError) {
    return new Response(JSON.stringify({ success: false, error: insertError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ success: true, symbol, status: snapshot.status, error: snapshot.error }),
    { headers: { "Content-Type": "application/json" } },
  );
});
