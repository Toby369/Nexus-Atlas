import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Multi-Source BTC/USDT Perpetual Collector.
// Holt Marktdaten parallel von mehreren Boersen (Bybit, Binance, Bitunix, Pionex,
// OKX, Bitget), normalisiert sie auf ein gemeinsames Schema und schreibt je
// Boerse eine eigene Zeile in market_snapshots. Der Ausfall einer einzelnen
// Boerse blockiert die anderen nicht (Promise.allSettled + pro-Boerse
// try/catch). Nicht jede Boerse liefert alle Kennzahlen -> fehlende Werte
// werden als null gespeichert statt erfunden zu werden (z.B. Bitunix hat
// keine oeffentliche Open-Interest-Route, Bitget liefert im Ticker keinen
// naechsten Funding-Zeitpunkt, OKX-Index-Preis wuerde ein zusaetzliches
// instId-Format erfordern und wird bewusst ausgelassen).
//
// ENTFERNT (Single-Source-of-Truth-Merge, siehe lib/marketStateSummary.ts
// im Next.js-Repo): frueher generierte diese Funktion zusaetzlich eine
// eigenstaendige, nur auf Bybit-Preis/OI/Funding gestuetzte "Kurznotiz"
// (market_commentary-Tabelle, eigene feste Schwellenwerte). Das konnte der
// 14-Faktoren-Engine (compute-market-state, market_states) widersprechen --
// zwei unabhaengige Rechenwege fuer "wie steht der Markt gerade da". Die
// Kurznotiz-UI fasst jetzt stattdessen direkt market_states zusammen, es
// gibt nur noch einen Rechenweg. Diese Funktion sammelt ausschliesslich
// noch die rohen market_snapshots-Zeilen.

interface NormalizedSnapshot {
  exchange: string;
  last_price: number | null;
  mark_price: number | null;
  index_price: number | null;
  open_interest: number | null;
  open_interest_usd: number | null;
  funding_rate: number | null;
  next_funding_time_utc: string | null;
  status: "ok" | "error";
  error: string | null;
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} bei ${url}`);
    }
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

function toIsoOrNull(ms: number | string | null | undefined): string | null {
  if (ms === null || ms === undefined) return null;
  const n = typeof ms === "string" ? parseInt(ms) : ms;
  if (!n || Number.isNaN(n)) return null;
  return new Date(n).toISOString();
}

// --- BybitCollector ---------------------------------------------------
async function collectBybit(symbol: string): Promise<NormalizedSnapshot> {
  const exchange = "bybit";
  try {
    const json = await fetchJson(
      `https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`,
    );
    const ticker = json?.result?.list?.[0];
    if (!ticker) throw new Error("Keine Ticker-Daten in der Bybit-Antwort");

    const lastPrice = parseFloat(ticker.lastPrice);
    const openInterest = parseFloat(ticker.openInterest);

    return {
      exchange,
      last_price: lastPrice,
      mark_price: parseFloat(ticker.markPrice),
      index_price: parseFloat(ticker.indexPrice),
      open_interest: openInterest,
      open_interest_usd: openInterest * lastPrice,
      funding_rate: parseFloat(ticker.fundingRate),
      next_funding_time_utc: toIsoOrNull(ticker.nextFundingTime),
      status: "ok",
      error: null,
    };
  } catch (err) {
    return errorSnapshot(exchange, err);
  }
}

// --- BinanceCollector ---------------------------------------------------
// USDT-M Futures: premiumIndex (Mark/Index/Funding) + openInterest + ticker/price (Last)
async function collectBinance(symbol: string): Promise<NormalizedSnapshot> {
  const exchange = "binance";
  try {
    const [premium, oi, priceTicker] = await Promise.all([
      fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`),
      fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),
      fetchJson(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);

    const lastPrice = parseFloat(priceTicker.price);
    const openInterest = parseFloat(oi.openInterest);

    return {
      exchange,
      last_price: lastPrice,
      mark_price: parseFloat(premium.markPrice),
      index_price: parseFloat(premium.indexPrice),
      open_interest: openInterest,
      open_interest_usd: openInterest * lastPrice,
      funding_rate: parseFloat(premium.lastFundingRate),
      next_funding_time_utc: toIsoOrNull(premium.nextFundingTime),
      status: "ok",
      error: null,
    };
  } catch (err) {
    return errorSnapshot(exchange, err);
  }
}

// --- BitunixCollector ---------------------------------------------------
// Oeffentliche API liefert Preis/Mark-Preis/Funding. Keine oeffentliche
// Open-Interest-Route vorhanden -> open_interest bleibt null ("nicht verfuegbar"),
// keine erfundenen Werte.
//
// WICHTIG (per Live-Vergleich verifiziert, siehe get_funding_intelligence-
// Audit): Bitunix liefert fundingRate NICHT als Dezimalbruch wie alle
// anderen Boersen (z.B. 0.0001 = 0.01%), sondern bereits als Prozentzahl
// (0.008687 = 0.008687%). Beleg: Bitunix' eigene maxFundingRate/
// minFundingRate-Grenzen liegen bei +/-0.3 -- als Dezimalbruch waere das
// ein absurdes +/-30%-Funding-Limit, als Prozentzahl ein plausibles
// +/-0.3%-Limit (Standard bei anderen Boersen). Ohne die Division durch
// 100 war der gespeicherte Wert durchgehend ~100x zu hoch (24h-Audit:
// Bitunix-Durchschnitt 0.0082 vs. 0.00002-0.00008 bei allen anderen
// Boersen). Die Division normalisiert auf dieselbe Dezimalbruch-Skala.
async function collectBitunix(symbol: string): Promise<NormalizedSnapshot> {
  const exchange = "bitunix";
  try {
    const json = await fetchJson(
      `https://fapi.bitunix.com/api/v1/futures/market/funding_rate/batch`,
    );
    const entry = (json?.data ?? []).find((d: any) => d.symbol === symbol);
    if (!entry) throw new Error(`Kein Bitunix-Eintrag fuer ${symbol}`);

    const rawFundingRate = parseFloat(entry.fundingRate);

    return {
      exchange,
      last_price: parseFloat(entry.lastPrice),
      mark_price: parseFloat(entry.markPrice),
      index_price: null, // von Bitunix oeffentlich nicht bereitgestellt
      open_interest: null, // keine oeffentliche OI-Route bei Bitunix
      open_interest_usd: null,
      funding_rate: Number.isNaN(rawFundingRate) ? null : rawFundingRate / 100,
      next_funding_time_utc: toIsoOrNull(entry.nextFundingTime),
      status: "ok",
      error: null,
    };
  } catch (err) {
    return errorSnapshot(exchange, err);
  }
}

// --- PionexCollector ---------------------------------------------------
async function collectPionex(symbol: string): Promise<NormalizedSnapshot> {
  const exchange = "pionex";
  try {
    const [indexRes, oiRes, tickerRes] = await Promise.all([
      fetchJson(`https://api.pionex.com/api/v1/market/indexes?symbol=${symbol}`),
      fetchJson(`https://api.pionex.com/api/v1/market/openInterests`),
      fetchJson(`https://api.pionex.com/api/v1/market/tickers?symbol=${symbol}&type=PERP`),
    ]);

    const indexData = indexRes?.data?.indexes?.[0];
    if (!indexData) throw new Error(`Keine Pionex-Indexdaten fuer ${symbol}`);

    const oiEntry = (oiRes?.data?.openInterests ?? []).find(
      (d: any) => d.symbol === symbol,
    );
    const tickerEntry = tickerRes?.data?.tickers?.[0];
    const lastPrice = tickerEntry ? parseFloat(tickerEntry.close) : parseFloat(indexData.markPrice);
    const openInterest = oiEntry ? parseFloat(oiEntry.openInterest) : null;

    return {
      exchange,
      last_price: lastPrice,
      mark_price: parseFloat(indexData.markPrice),
      index_price: parseFloat(indexData.indexPrice),
      open_interest: openInterest,
      open_interest_usd: openInterest !== null ? openInterest * lastPrice : null,
      funding_rate: parseFloat(indexData.nextFundingRate),
      next_funding_time_utc: toIsoOrNull(indexData.nextFundingTime),
      status: "ok",
      error: null,
    };
  } catch (err) {
    return errorSnapshot(exchange, err);
  }
}

// --- OkxCollector ---------------------------------------------------
// Vier oeffentliche Routen (Ticker/Open-Interest/Funding-Rate/Mark-Price),
// parallel geladen. OI kommt direkt in BTC (oiCcy) und USD (oiUsd) von OKX,
// keine eigene Umrechnung noetig. Index-Preis wuerde eine eigene Route mit
// anderem instId-Format (BTC-USDT statt BTC-USDT-SWAP) erfordern -> bewusst
// ausgelassen statt eine weitere Sonderfall-Route einzubauen, bleibt null.
async function collectOkx(instId: string): Promise<NormalizedSnapshot> {
  const exchange = "okx";
  try {
    const [tickerRes, oiRes, fundingRes, markRes] = await Promise.all([
      fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`),
      fetchJson(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${instId}`),
      fetchJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`),
      fetchJson(`https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId=${instId}`),
    ]);

    const ticker = tickerRes?.data?.[0];
    const oi = oiRes?.data?.[0];
    const funding = fundingRes?.data?.[0];
    const mark = markRes?.data?.[0];
    if (!ticker || !oi || !funding) throw new Error("Unvollstaendige OKX-Antwort");

    return {
      exchange,
      last_price: parseFloat(ticker.last),
      mark_price: mark ? parseFloat(mark.markPx) : null,
      index_price: null,
      open_interest: parseFloat(oi.oiCcy),
      open_interest_usd: parseFloat(oi.oiUsd),
      funding_rate: parseFloat(funding.fundingRate),
      next_funding_time_utc: toIsoOrNull(funding.nextFundingTime),
      status: "ok",
      error: null,
    };
  } catch (err) {
    return errorSnapshot(exchange, err);
  }
}

// --- BitgetCollector ---------------------------------------------------
// Ein einziger Ticker-Call liefert bereits Preis/Mark/Index/Funding/OI
// (holdingAmount, in BTC). Kein naechster Funding-Zeitpunkt im Ticker
// enthalten -> next_funding_time_utc bleibt null statt erfunden zu werden.
async function collectBitget(symbol: string): Promise<NormalizedSnapshot> {
  const exchange = "bitget";
  try {
    const json = await fetchJson(
      `https://api.bitget.com/api/v2/mix/market/ticker?symbol=${symbol}&productType=USDT-FUTURES`,
    );
    const entry = json?.data?.[0];
    if (!entry) throw new Error(`Kein Bitget-Eintrag fuer ${symbol}`);

    const lastPrice = parseFloat(entry.lastPr);
    const openInterest = parseFloat(entry.holdingAmount);

    return {
      exchange,
      last_price: lastPrice,
      mark_price: parseFloat(entry.markPrice),
      index_price: parseFloat(entry.indexPrice),
      open_interest: openInterest,
      open_interest_usd: openInterest * lastPrice,
      funding_rate: parseFloat(entry.fundingRate),
      next_funding_time_utc: null,
      status: "ok",
      error: null,
    };
  } catch (err) {
    return errorSnapshot(exchange, err);
  }
}

function errorSnapshot(exchange: string, err: unknown): NormalizedSnapshot {
  const message = err instanceof Error ? err.message : String(err);
  return {
    exchange,
    last_price: null,
    mark_price: null,
    index_price: null,
    open_interest: null,
    open_interest_usd: null,
    funding_rate: null,
    next_funding_time_utc: null,
    status: "error",
    error: message,
  };
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const symbol = "BTCUSDT";
  const now = new Date().toISOString();

  const results = await Promise.allSettled([
    collectBybit(symbol),
    collectBinance(symbol),
    collectBitunix(symbol),
    collectPionex("BTC_USDT_PERP"),
    collectOkx("BTC-USDT-SWAP"),
    collectBitget(symbol),
  ]);

  const snapshots: NormalizedSnapshot[] = results.map((r) =>
    r.status === "fulfilled"
      ? r.value
      : errorSnapshot("unknown", r.reason),
  );

  const rows = snapshots.map((s) => ({
    timestamp_utc: now,
    symbol,
    exchange: s.exchange,
    last_price: s.last_price,
    mark_price: s.mark_price,
    index_price: s.index_price,
    open_interest: s.open_interest,
    open_interest_usd: s.open_interest_usd,
    funding_rate: s.funding_rate,
    next_funding_time_utc: s.next_funding_time_utc,
    status: s.status,
    error: s.error,
  }));

  const { error: insertError } = await supabase.from("market_snapshots").insert(rows);
  if (insertError) {
    return new Response(JSON.stringify({ success: false, error: insertError.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      success: true,
      symbol,
      results: snapshots.map((s) => ({ exchange: s.exchange, status: s.status })),
    }),
    { headers: { "Content-Type": "application/json" } },
  );
});
