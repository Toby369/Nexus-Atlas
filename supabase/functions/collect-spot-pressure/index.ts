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
// Seit 26.11.2026 zusaetzlich OKX und Coinbase (Toby: "moeglichst den
// gesamten Spot-Druck") fuer DIESELBE abgeschlossene 5-Min-Kerze, in die
// eigene Tabelle spot_flow_extra (in Binance-Tabelle wuerden Leser ohne
// Boersen-Filter Werte mischen). Die Spot-Druck-Funktionen zaehlen sie dazu.
//   OKX:      rubik taker-volume, alle BTC-Spot-Paare, Kauf/Verkauf in BTC
//   Coinbase: BTC-USD Einzel-Trades; "side" ist die MAKER-Seite (Coinbase-
//             Doku), Taker-Kauf = side "sell".
// Faellt eine Zusatz-Boerse aus, bleibt Binance davon unberuehrt.
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

interface ExtraFlow {
  exchange: string;
  taker_buy_vol: number | null;
  taker_sell_vol: number | null;
  last_price: number | null;
  trade_count: number | null;
  status: "ok" | "error";
  error: string | null;
}

const WINDOW_MS = 5 * 60 * 1000;

function extraError(exchange: string, err: unknown): ExtraFlow {
  return {
    exchange,
    taker_buy_vol: null,
    taker_sell_vol: null,
    last_price: null,
    trade_count: null,
    status: "error",
    error: err instanceof Error ? err.message : String(err),
  };
}

// OKX: [[ts, sellVol, buyVol], ...], neueste zuerst; gesucht ist genau die Kerze ab startMs.
async function collectOkx(startMs: number): Promise<ExtraFlow> {
  try {
    const json = await fetchJson("https://www.okx.com/api/v5/rubik/stat/taker-volume?ccy=BTC&instType=SPOT&period=5m");
    const row = (json?.data ?? []).find((r: unknown[]) => Number(r?.[0]) === startMs);
    if (!row) throw new Error(`OKX: keine Kerze fuer ${new Date(startMs).toISOString()}`);
    const sell = parseFloat(row[1]);
    const buy = parseFloat(row[2]);
    if (!Number.isFinite(sell) || !Number.isFinite(buy)) throw new Error("OKX: ungueltige Werte");
    return { exchange: "okx", taker_buy_vol: buy, taker_sell_vol: sell, last_price: null, trade_count: null, status: "ok", error: null };
  } catch (err) {
    return extraError("okx", err);
  }
}

// Coinbase: Trades seitenweise (neueste zuerst) bis vor den Kerzenbeginn.
const COINBASE_MAX_PAGES = 8;
async function collectCoinbase(startMs: number): Promise<ExtraFlow> {
  try {
    const endMs = startMs + WINDOW_MS;
    let buy = 0;
    let sell = 0;
    let count = 0;
    let lastPrice: number | null = null;
    let lastPriceT = -Infinity;
    let after: string | null = null;
    let reachedStart = false;
    for (let page = 0; page < COINBASE_MAX_PAGES && !reachedStart; page++) {
      const url = `https://api.exchange.coinbase.com/products/BTC-USD/trades?limit=1000${after ? `&after=${after}` : ""}`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      let res: Response;
      try {
        res = await fetch(url, { signal: controller.signal, headers: { "User-Agent": "nexus-atlas", Accept: "application/json" } });
      } finally {
        clearTimeout(timeout);
      }
      if (!res.ok) throw new Error(`Coinbase HTTP ${res.status}`);
      const trades = (await res.json()) as { side: string; size: string; price: string; time: string }[];
      if (!Array.isArray(trades) || trades.length === 0) break;
      for (const t of trades) {
        const ms = Date.parse(t.time);
        if (ms < startMs) {
          reachedStart = true;
          continue;
        }
        if (ms >= endMs) continue;
        const size = parseFloat(t.size);
        if (!Number.isFinite(size)) continue;
        // Maker-Seite "sell" = ein Kaeufer hat aktiv gekauft.
        if (t.side === "sell") buy += size;
        else sell += size;
        count += 1;
        if (ms > lastPriceT) {
          lastPriceT = ms;
          lastPrice = parseFloat(t.price);
        }
      }
      after = res.headers.get("cb-after");
      if (!after) break;
    }
    if (!reachedStart) throw new Error(`Coinbase: Kerzenbeginn nach ${COINBASE_MAX_PAGES} Seiten nicht erreicht`);
    return { exchange: "coinbase", taker_buy_vol: buy, taker_sell_vol: sell, last_price: lastPrice, trade_count: count, status: "ok", error: null };
  } catch (err) {
    return extraError("coinbase", err);
  }
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const symbol = "BTCUSDT";
  const snapshot = await collectSpotPressure(symbol);
  // Zusatz-Boersen fuer dieselbe Kerze (nur wenn Binance eine Kerze hatte).
  const startMs = snapshot.status === "ok" ? Date.parse(snapshot.timestamp_utc) : null;
  const extras = startMs !== null ? await Promise.all([collectOkx(startMs), collectCoinbase(startMs)]) : [];

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

  let extraInsertError: string | null = null;
  if (extras.length > 0) {
    const { error } = await supabase.from("spot_flow_extra").upsert(
      extras.map((e) => ({ ...e, timestamp_utc: snapshot.timestamp_utc })),
      { onConflict: "exchange,timestamp_utc", ignoreDuplicates: true },
    );
    extraInsertError = error?.message ?? null;
  }

  return new Response(
    JSON.stringify({
      success: true,
      symbol,
      status: snapshot.status,
      error: snapshot.error,
      extras: extras.map((e) => ({ exchange: e.exchange, status: e.status, error: e.error })),
      extraInsertError,
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
