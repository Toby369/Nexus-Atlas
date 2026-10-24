import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// NEXUS Spot Volume Profile Collector (Nutzer-Idee 30.09.2026, "sieht nexus
// wo/bei welchem preis spot gekauft wurde?").
//
// Anders als Spot-Pressure (collect-spot-pressure: EINE Zahl Taker-Buy vs.
// -Sell je Zeitfenster, keine Preis-Information) hier je PREIS-STUFE, wo
// sich Kauf-/Verkaufsvolumen konzentriert -- klassisches "Volume Profile".
// Binance Spot bietet dafuer keine Kline-Route (die hat nur einen
// Buy/Sell-Split je Zeit-Kerze, keinen je Preis) -- noetig ist
// GET /api/v3/aggTrades (kostenlos, kein API-Key, Gewicht 2 je Aufruf).
//
// Cursor-basiertes Polling (spot_volume_profile_cursor: letzte verarbeitete
// aggTradeId) statt ueberlappender Zeitfenster -- garantiert luecken-/
// dublettenfrei, im Unterschied zum WebSocket-Sampling-Ansatz von
// collect-liquidations (dort bewusst akzeptierte Stichprobe, weil
// Liquidationen selten sind; Spot-Trades sind zu haeufig fuer eine 25s-
// Stichprobe -- hier wird stattdessen VOLLSTAENDIG paginiert).
//
// WICHTIG: Binance fuehrt fuer einen Markt ZWEI getrennte ID-Raeume --
// rohe Trade-Ids (GET /api/v3/trades, Feld "id") und aggregierte Trade-Ids
// (GET /api/v3/aggTrades, Feld "a", jeweils mehrere preis-/zeit-/richtungs-
// gleiche Trades zu einem Eintrag zusammengefasst -- daher eine niedrigere,
// LANGSAMER wachsende Zahl als die rohe Trade-Id). Fuer den Cursor zaehlt
// AUSSCHLIESSLICH der aggTrade-Id-Raum, der Bootstrap muss also ebenfalls
// ueber /api/v3/aggTrades laufen, nicht ueber /api/v3/trades (sonst zeigt
// fromId auf einen Bereich, der nie erreicht wird -- so beim ersten Bau
// dieser Funktion tatsaechlich per manuellem Testlauf aufgefallen).
//
// Aggregiert VOR dem Insert in $100-Preis-Buckets (COLLECTION_BUCKET_USD) --
// keine Einzel-Trade-Zeilen, sonst unbegrenztes Tabellenwachstum. Die RPC
// get_spot_volume_profile() fasst diese Buckets bei Bedarf zu groeberen
// Preis-Stufen zusammen (Default 200, wie bei Liquidations-Clustern).

const SYMBOL = "BTCUSDT";
const EXCHANGE = "binance";
const BINANCE_BASE_URL = "https://api.binance.com";
const COLLECTION_BUCKET_USD = 100;
// Harte Obergrenze je Lauf (Cron alle 5 Min) -- begrenzt die Laufzeit/den
// net.http_post-Timeout (40s, siehe Cron-Definition). 10 Seiten a 1000
// Trades sind in ueblichen 5-Min-Fenstern weit mehr als genug; wird das
// Cap regelmaessig erreicht (z.B. nach einem Ausfall mit Rueckstand), holt
// der naechste Lauf den Rest -- der Cursor rueckt nur soweit vor wie
// tatsaechlich verarbeitet wurde, nichts geht verloren oder wird doppelt
// gezaehlt.
const MAX_PAGES_PER_RUN = 10;
const PAGE_LIMIT = 1000;

interface AggTrade {
  a: number; // aggTradeId
  p: string; // price
  q: string; // quantity
  m: boolean; // was the buyer the maker? true = aggressiver Verkauf (Taker=Seller), false = aggressiver Kauf (Taker=Buyer)
}

async function fetchJson(url: string, timeoutMs = 8000): Promise<unknown> {
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

// Bootstrap ohne Historie: beim allerersten Lauf (kein Cursor vorhanden)
// wird NICHT die komplette Handelshistorie aufgerollt, sondern beim
// aktuellsten AGG-Trade begonnen -- ab dann laeuft der Cursor lueckenlos
// vorwaerts. Bewusst ueber /api/v3/aggTrades (nicht /api/v3/trades, siehe
// Kopfkommentar), sonst zeigt der Cursor auf den falschen Id-Raum.
async function fetchLatestAggTradeId(): Promise<number | null> {
  const data = (await fetchJson(
    `${BINANCE_BASE_URL}/api/v3/aggTrades?symbol=${SYMBOL}&limit=1`,
  )) as { a: number }[];
  const latest = data?.[0]?.a;
  return typeof latest === "number" ? latest : null;
}

async function fetchAggTradesFromId(fromId: number): Promise<AggTrade[]> {
  const data = (await fetchJson(
    `${BINANCE_BASE_URL}/api/v3/aggTrades?symbol=${SYMBOL}&fromId=${fromId}&limit=${PAGE_LIMIT}`,
  )) as AggTrade[];
  return Array.isArray(data) ? data : [];
}

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: cursorRow, error: cursorError } = await supabase
    .from("spot_volume_profile_cursor")
    .select("last_agg_trade_id")
    .eq("exchange", EXCHANGE)
    .eq("symbol", SYMBOL)
    .maybeSingle();

  if (cursorError) {
    return new Response(
      JSON.stringify({ success: false, error: cursorError.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let fromId = cursorRow?.last_agg_trade_id ?? null;
  const isBootstrap = fromId === null;

  if (fromId === null) {
    try {
      const latestId = await fetchLatestAggTradeId();
      if (latestId === null) {
        return new Response(
          JSON.stringify({ success: false, error: "Konnte aktuelle aggTrade-Id nicht ermitteln (Bootstrap)." }),
          { status: 502, headers: { "Content-Type": "application/json" } },
        );
      }
      // Ab dem naechsten, noch nicht gesehenen aggTrade beginnen.
      fromId = latestId + 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return new Response(JSON.stringify({ success: false, error: message }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  const buckets = new Map<number, { buy: number; sell: number; count: number }>();
  let processedCount = 0;
  let lastSeenId: number | null = null;
  let pages = 0;

  try {
    while (pages < MAX_PAGES_PER_RUN) {
      const trades = await fetchAggTradesFromId(fromId);
      pages++;
      if (trades.length === 0) break;

      for (const t of trades) {
        const price = parseFloat(t.p);
        const qty = parseFloat(t.q);
        if (!Number.isFinite(price) || !Number.isFinite(qty)) continue;

        const bucket = Math.floor(price / COLLECTION_BUCKET_USD) * COLLECTION_BUCKET_USD;
        const entry = buckets.get(bucket) ?? { buy: 0, sell: 0, count: 0 };
        // m=true: Kaeufer war Maker -> Verkaeufer war Taker -> aggressiver Verkauf.
        // m=false: Kaeufer war Taker -> aggressiver Kauf.
        if (t.m) entry.sell += qty;
        else entry.buy += qty;
        entry.count += 1;
        buckets.set(bucket, entry);

        lastSeenId = t.a;
        processedCount++;
      }

      if (trades.length < PAGE_LIMIT) break;
      fromId = trades[trades.length - 1].a + 1;
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Bereits gesammelte Buckets/den bis hierhin erreichten Cursor-Stand
    // trotzdem sichern statt den ganzen Lauf zu verwerfen -- der naechste
    // Lauf macht beim echten Fehlerpunkt weiter.
    if (buckets.size === 0) {
      return new Response(JSON.stringify({ success: false, error: message }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  if (buckets.size > 0) {
    const bucketTimeUtc = new Date().toISOString();
    const rows = Array.from(buckets.entries()).map(([price_bucket, v]) => ({
      bucket_time_utc: bucketTimeUtc,
      exchange: EXCHANGE,
      symbol: SYMBOL,
      price_bucket,
      buy_volume: v.buy,
      sell_volume: v.sell,
      trade_count: v.count,
    }));

    const { error: insertError } = await supabase.from("spot_volume_buckets").insert(rows);
    if (insertError) {
      return new Response(
        JSON.stringify({ success: false, error: insertError.message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  }

  if (lastSeenId !== null) {
    const { error: upsertError } = await supabase.from("spot_volume_profile_cursor").upsert(
      {
        exchange: EXCHANGE,
        symbol: SYMBOL,
        last_agg_trade_id: lastSeenId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "exchange,symbol" },
    );
    if (upsertError) {
      return new Response(
        JSON.stringify({ success: false, error: upsertError.message }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }
  } else if (isBootstrap && fromId !== null) {
    // Bootstrap-Lauf ohne neue Trades im ersten Poll (selten) -- Cursor
    // trotzdem anlegen, damit der naechste Lauf nicht erneut bootstrapped.
    await supabase.from("spot_volume_profile_cursor").upsert(
      { exchange: EXCHANGE, symbol: SYMBOL, last_agg_trade_id: fromId - 1, updated_at: new Date().toISOString() },
      { onConflict: "exchange,symbol" },
    );
  }

  return new Response(
    JSON.stringify({ success: true, processed: processedCount, buckets: buckets.size, pages }),
    { headers: { "Content-Type": "application/json" } },
  );
});
