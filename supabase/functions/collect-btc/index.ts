import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  type MarktWerte,
  parseBinanceMarkt,
  parseBitgetTicker,
  parseBitunixFunding,
  parseBybitTicker,
  parseOkxMarkt,
  parsePionexMarkt,
} from "../_shared/boersenParser.ts";

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

// Auslesen der Antworten: supabase/functions/_shared/boersenParser.ts
// (gegen gespeicherte echte Antworten getestet, wirft bei fehlendem Feld).
async function collect(exchange: string, lesen: () => Promise<MarktWerte>): Promise<NormalizedSnapshot> {
  try {
    return { exchange, ...(await lesen()), status: "ok", error: null };
  } catch (err) {
    return errorSnapshot(exchange, err);
  }
}

const collectBybit = (symbol: string) =>
  collect("bybit", async () =>
    parseBybitTicker(await fetchJson(`https://api.bybit.com/v5/market/tickers?category=linear&symbol=${symbol}`))
  );

// USDT-M Futures: premiumIndex (Mark/Index/Funding) + openInterest + ticker/price (Last)
const collectBinance = (symbol: string) =>
  collect("binance", async () => {
    const [premium, oi, price] = await Promise.all([
      fetchJson(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${symbol}`),
      fetchJson(`https://fapi.binance.com/fapi/v1/openInterest?symbol=${symbol}`),
      fetchJson(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${symbol}`),
    ]);
    return parseBinanceMarkt(premium, oi, price);
  });

// Funding als Prozentzahl -> /100, siehe parseBitunixFunding.
const collectBitunix = (symbol: string) =>
  collect("bitunix", async () =>
    parseBitunixFunding(await fetchJson(`https://fapi.bitunix.com/api/v1/futures/market/funding_rate/batch`), symbol)
  );

const collectPionex = (symbol: string) =>
  collect("pionex", async () => {
    const [index, oi, ticker] = await Promise.all([
      fetchJson(`https://api.pionex.com/api/v1/market/indexes?symbol=${symbol}`),
      fetchJson(`https://api.pionex.com/api/v1/market/openInterests`),
      fetchJson(`https://api.pionex.com/api/v1/market/tickers?symbol=${symbol}&type=PERP`),
    ]);
    return parsePionexMarkt(index, oi, ticker, symbol);
  });

const collectOkx = (instId: string) =>
  collect("okx", async () => {
    const [ticker, oi, funding, mark] = await Promise.all([
      fetchJson(`https://www.okx.com/api/v5/market/ticker?instId=${instId}`),
      fetchJson(`https://www.okx.com/api/v5/public/open-interest?instType=SWAP&instId=${instId}`),
      fetchJson(`https://www.okx.com/api/v5/public/funding-rate?instId=${instId}`),
      fetchJson(`https://www.okx.com/api/v5/public/mark-price?instType=SWAP&instId=${instId}`),
    ]);
    return parseOkxMarkt(ticker, oi, funding, mark);
  });

const collectBitget = (symbol: string) =>
  collect("bitget", async () =>
    parseBitgetTicker(
      await fetchJson(`https://api.bitget.com/api/v2/mix/market/ticker?symbol=${symbol}&productType=USDT-FUTURES`),
      symbol,
    )
  );

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
