import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Phase 2 Market-Intelligence-Engine: Orderbook/Liquiditaets-Collector.
//
// Holt Orderbuch-Tiefe von Binance/Bybit/OKX Futures (alle drei bieten
// oeffentliche, kostenlose Depth-Endpoints ohne Auth) und leitet daraus
// Spread, Tiefe (USD) innerhalb eines Bandes um den Mid-Preis, Imbalance
// und "Walls" (auffaellig grosse Einzel-Level) ab. Es wird bewusst NICHT
// das komplette Orderbuch gespeichert -- nur die abgeleiteten Kennzahlen
// (Performance-Prinzip: kein unnoetiges Datenvolumen je Tick).
//
// Alle Schwellenwerte sind benannte Konstanten, spaeter per Backtesting
// justierbar (keine Magic Numbers).

const SYMBOL = "BTCUSDT";

// Band um den Mid-Preis, innerhalb dessen Bid-/Ask-Tiefe aufsummiert wird.
const DEPTH_RANGE_PCT = 0.5;

// Ein Level gilt als "Wall", wenn seine USD-Groesse mindestens das
// WALL_MULTIPLIER-fache des Median aller erfassten Level auf derselben
// Seite betraegt.
const WALL_MULTIPLIER = 5;

// Mindestanzahl erfasster Level auf einer Seite, um eine Median-Referenz
// fuer die Wall-Erkennung sinnvoll zu bilden.
const WALL_MIN_LEVELS = 3;

// OKX quotiert Orderbuch-Groessen in Kontrakten, nicht in BTC (anders als
// Binance/Bybit, die direkt BTC liefern). Verifiziert ueber
// GET /api/v5/public/instruments?instType=SWAP&instId=BTC-USDT-SWAP ->
// ctVal=0.01, ctValCcy=BTC, ctMult=1 -- 1 Kontrakt = 0.01 BTC. Ohne diese
// Umrechnung waere die OKX-Tiefe faelschlich ~100x zu hoch.
const OKX_CONTRACT_VALUE_BTC = 0.01;

type Level = [number, number]; // [price, qty]

interface Metrics {
  bestBid: number;
  bestAsk: number;
  mid: number;
  spreadAbs: number;
  spreadPct: number | null;
  bidDepthUsd: number;
  askDepthUsd: number;
  imbalance: number | null;
  bidWall: { price: number; usd: number } | null;
  askWall: { price: number; usd: number } | null;
}

interface OrderbookRow {
  exchange: string;
  status: "ok" | "error";
  error: string | null;
  metrics: Metrics | null;
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

function findWall(levels: Level[]): { price: number; usd: number } | null {
  if (levels.length < WALL_MIN_LEVELS) return null;
  const usdSizes = levels.map(([price, qty]) => price * qty);
  const sorted = [...usdSizes].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  if (median === 0) return null;

  let maxUsd = 0;
  let maxIdx = -1;
  for (let i = 0; i < usdSizes.length; i++) {
    if (usdSizes[i] > maxUsd) {
      maxUsd = usdSizes[i];
      maxIdx = i;
    }
  }
  if (maxIdx === -1 || maxUsd < median * WALL_MULTIPLIER) return null;
  return { price: levels[maxIdx][0], usd: maxUsd };
}

// bids: absteigend sortiert (bestBid zuerst), asks: aufsteigend sortiert
// (bestAsk zuerst) -- Standard-Konvention aller drei Boersen-APIs.
function computeMetrics(bids: Level[], asks: Level[]): Metrics | null {
  if (bids.length === 0 || asks.length === 0) return null;
  const bestBid = bids[0][0];
  const bestAsk = asks[0][0];
  if (!(bestBid > 0) || !(bestAsk > 0) || bestAsk <= bestBid) return null;

  const mid = (bestBid + bestAsk) / 2;
  const spreadAbs = bestAsk - bestBid;
  const spreadPct = mid !== 0 ? (spreadAbs / mid) * 100 : null;

  const lowerBound = mid * (1 - DEPTH_RANGE_PCT / 100);
  const upperBound = mid * (1 + DEPTH_RANGE_PCT / 100);

  const bidLevelsInRange: Level[] = [];
  let bidDepthUsd = 0;
  for (const level of bids) {
    if (level[0] < lowerBound) break;
    bidLevelsInRange.push(level);
    bidDepthUsd += level[0] * level[1];
  }

  const askLevelsInRange: Level[] = [];
  let askDepthUsd = 0;
  for (const level of asks) {
    if (level[0] > upperBound) break;
    askLevelsInRange.push(level);
    askDepthUsd += level[0] * level[1];
  }

  const totalDepth = bidDepthUsd + askDepthUsd;
  const imbalance = totalDepth > 0 ? (bidDepthUsd - askDepthUsd) / totalDepth : null;

  return {
    bestBid,
    bestAsk,
    mid,
    spreadAbs,
    spreadPct,
    bidDepthUsd,
    askDepthUsd,
    imbalance,
    bidWall: findWall(bidLevelsInRange),
    askWall: findWall(askLevelsInRange),
  };
}

async function collectBinance(): Promise<OrderbookRow> {
  const exchange = "binance";
  try {
    const json = await fetchJson(`https://fapi.binance.com/fapi/v1/depth?symbol=${SYMBOL}&limit=500`);
    const bids: Level[] = (json?.bids ?? []).map((l: string[]) => [parseFloat(l[0]), parseFloat(l[1])]);
    const asks: Level[] = (json?.asks ?? []).map((l: string[]) => [parseFloat(l[0]), parseFloat(l[1])]);
    const metrics = computeMetrics(bids, asks);
    if (!metrics) throw new Error("Unvollstaendiges Binance-Orderbuch");
    return { exchange, status: "ok", error: null, metrics };
  } catch (err) {
    return { exchange, status: "error", error: err instanceof Error ? err.message : String(err), metrics: null };
  }
}

async function collectBybit(): Promise<OrderbookRow> {
  const exchange = "bybit";
  try {
    const json = await fetchJson(
      `https://api.bybit.com/v5/market/orderbook?category=linear&symbol=${SYMBOL}&limit=200`,
    );
    const result = json?.result;
    if (!result) throw new Error("Keine Bybit-Orderbuch-Daten");
    const bids: Level[] = (result.b ?? []).map((l: string[]) => [parseFloat(l[0]), parseFloat(l[1])]);
    const asks: Level[] = (result.a ?? []).map((l: string[]) => [parseFloat(l[0]), parseFloat(l[1])]);
    const metrics = computeMetrics(bids, asks);
    if (!metrics) throw new Error("Unvollstaendiges Bybit-Orderbuch");
    return { exchange, status: "ok", error: null, metrics };
  } catch (err) {
    return { exchange, status: "error", error: err instanceof Error ? err.message : String(err), metrics: null };
  }
}

async function collectOkx(): Promise<OrderbookRow> {
  const exchange = "okx";
  try {
    const instId = SYMBOL.replace("USDT", "-USDT-SWAP");
    const json = await fetchJson(`https://www.okx.com/api/v5/market/books?instId=${instId}&sz=400`);
    if (json?.code !== "0") throw new Error(`OKX API-Fehler: ${json?.msg || json?.code}`);
    const entry = json?.data?.[0];
    if (!entry) throw new Error("Keine OKX-Orderbuch-Daten");
    // OKX-Level-Format: [price, size(Kontrakte), liqOrders, numOrders] --
    // Groesse wird sofort in BTC umgerechnet (siehe OKX_CONTRACT_VALUE_BTC),
    // damit computeMetrics() ueberall mit echten BTC-Mengen rechnet.
    const bids: Level[] = (entry.bids ?? []).map((l: string[]) => [
      parseFloat(l[0]),
      parseFloat(l[1]) * OKX_CONTRACT_VALUE_BTC,
    ]);
    const asks: Level[] = (entry.asks ?? []).map((l: string[]) => [
      parseFloat(l[0]),
      parseFloat(l[1]) * OKX_CONTRACT_VALUE_BTC,
    ]);
    const metrics = computeMetrics(bids, asks);
    if (!metrics) throw new Error("Unvollstaendiges OKX-Orderbuch");
    return { exchange, status: "ok", error: null, metrics };
  } catch (err) {
    return { exchange, status: "error", error: err instanceof Error ? err.message : String(err), metrics: null };
  }
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const now = new Date().toISOString();
  const results = await Promise.allSettled([collectBinance(), collectBybit(), collectOkx()]);

  const rows: OrderbookRow[] = results.map((r, idx) => {
    if (r.status === "fulfilled") return r.value;
    const exchange = ["binance", "bybit", "okx"][idx];
    return { exchange, status: "error", error: r.reason instanceof Error ? r.reason.message : String(r.reason), metrics: null };
  });

  const { error: insertError } = await supabase.from("orderbook_snapshots").insert(
    rows.map((r) => ({
      timestamp_utc: now,
      exchange: r.exchange,
      symbol: SYMBOL,
      best_bid: r.metrics?.bestBid ?? null,
      best_ask: r.metrics?.bestAsk ?? null,
      mid_price: r.metrics?.mid ?? null,
      spread_abs: r.metrics?.spreadAbs ?? null,
      spread_pct: r.metrics?.spreadPct ?? null,
      bid_depth_usd: r.metrics?.bidDepthUsd ?? null,
      ask_depth_usd: r.metrics?.askDepthUsd ?? null,
      depth_imbalance: r.metrics?.imbalance ?? null,
      bid_wall_price: r.metrics?.bidWall?.price ?? null,
      bid_wall_usd: r.metrics?.bidWall?.usd ?? null,
      ask_wall_price: r.metrics?.askWall?.price ?? null,
      ask_wall_usd: r.metrics?.askWall?.usd ?? null,
      status: r.status,
      error: r.error,
    })),
  );

  if (insertError) {
    return new Response(JSON.stringify({ success: false, error: insertError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ success: true, results: rows.map((r) => ({ exchange: r.exchange, status: r.status, error: r.error })) }),
    { headers: { "Content-Type": "application/json" } },
  );
});
