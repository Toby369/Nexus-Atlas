import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// NEXUS ETF-Flow Collector (Phase 7) -- SoSoValue-Version.
//
// Wechsel von Farside-HTML-Scraping (fragil, kein offizieller Support, kann
// bei jeder Layout-Aenderung brechen) auf SoSoValues offizielle, fuer den
// Demo-Plan kostenlose API. Header x-soso-api-key, Rate-Limit 20 Calls/Min
// auf dem Free-Tier -- fuer unseren 4h-Takt voellig ausreichend.
//
// Doku: https://sosovalue.gitbook.io/soso-value-api-doc/2.-etf/summary-history
// GET /etfs/summary-history?symbol=BTC&country_code=US&limit=N
// -> [{date, total_net_inflow (USD), total_value_traded, total_net_assets, cum_net_inflow}, ...]
const SOURCE = "sosovalue";
const API_URL =
  "https://openapi.sosovalue.com/openapi/v1/etfs/summary-history?symbol=BTC&country_code=US&limit=30";

interface FlowRow {
  flow_date: string;
  total_flow_usd_m: number | null;
  source: string;
}

// deno-lint-ignore no-explicit-any
type JsonRecord = Record<string, any>;

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apiKey = Deno.env.get("SOSOVALUE_API_KEY");
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (!apiKey) {
    return new Response(
      JSON.stringify({ success: false, error: "SOSOVALUE_API_KEY nicht gesetzt" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  let json: JsonRecord;
  try {
    const res = await fetch(API_URL, { headers: { "x-soso-api-key": apiKey } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    json = await res.json();
    if (json?.code !== 0) {
      throw new Error(`SoSoValue API-Fehler: ${json?.message ?? json?.code}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  const entries: JsonRecord[] = Array.isArray(json?.data) ? json.data : [];
  const rows: FlowRow[] = entries
    .filter((e) => typeof e.date === "string")
    .map((e) => ({
      flow_date: e.date,
      // total_net_inflow kommt in vollen USD, unsere Tabelle speichert in
      // Mio. USD (Konvention aus der bisherigen Farside-Version) -- konsistent halten.
      total_flow_usd_m:
        typeof e.total_net_inflow === "number" ? e.total_net_inflow / 1_000_000 : null,
      source: SOURCE,
    }));

  if (rows.length === 0) {
    return new Response(
      JSON.stringify({ success: false, error: "Keine Zeilen von SoSoValue erhalten" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const { error: insertError } = await supabase
    .from("etf_flows")
    .upsert(rows, { onConflict: "flow_date,source" });

  if (insertError) {
    return new Response(
      JSON.stringify({ success: false, error: insertError.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({ success: true, parsed: rows.length, latest: rows[0] }),
    { headers: { "Content-Type": "application/json" } },
  );
});
