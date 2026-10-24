import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Einmaliger Backfill (kein Cron) -- Option A: Binance liefert Funding-Rate-
// Historie kostenlos ueber /fapi/v1/fundingRate (anders als die Long/Short-
// Ratio-Endpoints NICHT auf 30 Tage gedeckelt). Schreibt in dieselbe
// market_snapshots-Tabelle wie der Live-Collector, nur mit den historischen
// Funding-Zeitpunkten statt "jetzt" -- alle anderen Spalten (last_price,
// open_interest etc.) bleiben NULL, da fuer diesen Zeitraum keine
// kostenlose historische Quelle existiert (siehe Backfill-Recherche).
// Nur Binance (eine Boerse) -- der funding_asof-Join in
// backtest_reconstruct_states_v2 mittelt ueber alle Boersen MIT Daten,
// funktioniert also auch mit nur einer Quelle fuer den historischen
// Zeitraum.

const SYMBOL = "BTCUSDT";
const FETCH_LIMIT = 1000;
const STAGGER_MS = 250;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface BackfillBody {
  startTime: number;
  endTime?: number;
}

Deno.serve(async (req: Request) => {
  let body: BackfillBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ success: false, error: "Ungueltiges JSON." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const nowMs = Date.now();
  const endTime = body.endTime ?? nowMs;
  let cursor = body.startTime;
  const rows: any[] = [];
  let requests = 0;
  const MAX_REQUESTS = 30;

  while (cursor < endTime && requests < MAX_REQUESTS) {
    requests++;
    const res = await fetch(
      `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${SYMBOL}&startTime=${cursor}&endTime=${endTime}&limit=${FETCH_LIMIT}`,
    );
    if (!res.ok) {
      return new Response(JSON.stringify({ success: false, error: `HTTP ${res.status}`, inserted: 0 }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    const raw = await res.json();
    if (!Array.isArray(raw) || raw.length === 0) break;

    for (const entry of raw) {
      rows.push({
        timestamp_utc: new Date(Number(entry.fundingTime)).toISOString(),
        symbol: SYMBOL,
        exchange: "binance",
        funding_rate: Number.parseFloat(entry.fundingRate),
        status: "ok",
      });
    }

    const lastTime = Number(raw[raw.length - 1].fundingTime);
    if (raw.length < FETCH_LIMIT || lastTime + 1 <= cursor) break;
    cursor = lastTime + 1;
    await sleep(STAGGER_MS);
  }

  const CHUNK = 1000;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("market_snapshots").insert(chunk);
    if (error) {
      return new Response(JSON.stringify({ success: false, error: error.message, inserted }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    inserted += chunk.length;
  }

  return new Response(
    JSON.stringify({ success: true, requests, totalFetched: rows.length, inserted, reachedEnd: cursor >= endTime, nextCursor: cursor }),
    { headers: { "Content-Type": "application/json" } },
  );
});
