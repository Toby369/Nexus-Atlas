import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Backfill fuer onchain_snapshots. Gleiche Datenquelle wie collect-onchain
// (BGeometrics/bitcoin-data.com, kostenloser Tier), aber nutzt das volle
// zurueckgegebene Array pro Metrik (die API liefert ohnehin die komplette
// Historie in EINEM Call, collect-onchain nimmt bisher nur den letzten
// Eintrag) -- deshalb genuegt genau 1 Request pro Metrik, 7 insgesamt,
// weit innerhalb des 15/Tag-Limits. Einmaliger, manuell aufgerufener
// Backfill, kein Cron.
const API_BASE = "https://api.bitcoin-data.com";

interface Metric {
  endpoint: string;
  label: string;
}

const METRICS: Metric[] = [
  { endpoint: "sopr", label: "SOPR" },
  { endpoint: "mvrv", label: "MVRV" },
  { endpoint: "realized-price", label: "Realized Price" },
  { endpoint: "lth-net-position-change-btc", label: "LTH Net-Position-Change (BTC)" },
  { endpoint: "sth-net-position-change-btc", label: "STH Net-Position-Change (BTC)" },
  { endpoint: "stablecoin-supply", label: "Stablecoin-Supply (gesamt, USD)" },
  { endpoint: "balance-addr-10K-BTC", label: "Whale-Adressen (>10K BTC, Anzahl)" },
];

function extractGenericValue(entry: Record<string, unknown>): number | null {
  for (const [key, val] of Object.entries(entry)) {
    if (key === "d" || key === "unixTs") continue;
    const num = typeof val === "number" ? val : parseFloat(String(val));
    if (!Number.isNaN(num)) return num;
  }
  return null;
}

function extractStablecoinTotal(entry: Record<string, unknown>): number | null {
  let sum = 0;
  let found = false;
  for (const [key, val] of Object.entries(entry)) {
    if (key === "d" || key === "unixTs") continue;
    const num = typeof val === "number" ? val : parseFloat(String(val));
    if (!Number.isNaN(num)) {
      sum += num;
      found = true;
    }
  }
  return found ? sum : null;
}

async function fetchJson(url: string, timeoutMs = 30000): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} bei ${url.split("?")[0]}`);
    return await res.json();
  } finally {
    clearTimeout(timeout);
  }
}

Deno.serve(async (req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  let body: { fromDate?: string } = {};
  try {
    body = await req.json();
  } catch {
    // kein Body -> Default (komplette Historie)
  }
  const fromDate = body.fromDate ?? "2024-09-01";

  const { data: apiKey, error: keyError } = await supabase.rpc("get_secret", {
    secret_name: "BGEOMETRICS_API_KEY",
  });
  if (keyError || !apiKey) {
    return new Response(
      JSON.stringify({ success: false, error: keyError ? keyError.message : "BGEOMETRICS_API_KEY nicht in Vault hinterlegt" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const results: { metric: string; status: string; rowsFetched?: number; rowsInserted?: number; error?: string }[] = [];

  for (const metric of METRICS) {
    try {
      const json = await fetchJson(`${API_BASE}/v1/${metric.endpoint}?token=${apiKey}`);
      if (!Array.isArray(json)) throw new Error(`Unerwartete Antwort fuer ${metric.endpoint} (kein Array)`);

      const extract = metric.endpoint === "stablecoin-supply" ? extractStablecoinTotal : extractGenericValue;

      // Bereits vorhandene (metric, observation_date)-Paare NICHT erneut einfuegen.
      const { data: existing } = await supabase
        .from("onchain_snapshots")
        .select("observation_date")
        .eq("metric", metric.endpoint)
        .not("observation_date", "is", null);
      const existingDates = new Set((existing ?? []).map((r: { observation_date: string }) => r.observation_date));

      const rowsToInsert: Record<string, unknown>[] = [];
      let prevValue: number | null = null;
      for (const entry of json) {
        const observationDate = typeof entry?.d === "string" ? entry.d : null;
        if (!observationDate || observationDate < fromDate) {
          const v = extract(entry);
          if (v !== null) prevValue = v;
          continue;
        }
        const value = extract(entry);
        if (!existingDates.has(observationDate)) {
          const changePct =
            value !== null && prevValue !== null && prevValue !== 0
              ? ((value - prevValue) / Math.abs(prevValue)) * 100
              : null;
          rowsToInsert.push({
            timestamp_utc: `${observationDate}T12:00:00Z`,
            metric: metric.endpoint,
            label: metric.label,
            value,
            prev_value: prevValue,
            change_pct: changePct,
            observation_date: observationDate,
            status: "ok",
            error: null,
          });
        }
        if (value !== null) prevValue = value;
      }

      let inserted = 0;
      const CHUNK = 500;
      for (let i = 0; i < rowsToInsert.length; i += CHUNK) {
        const { error: insertError } = await supabase.from("onchain_snapshots").insert(rowsToInsert.slice(i, i + CHUNK));
        if (insertError) throw new Error(`Insert-Fehler bei ${metric.endpoint}: ${insertError.message}`);
        inserted += Math.min(CHUNK, rowsToInsert.length - i);
      }

      results.push({ metric: metric.endpoint, status: "ok", rowsFetched: json.length, rowsInserted: inserted });
    } catch (err) {
      results.push({ metric: metric.endpoint, status: "error", error: err instanceof Error ? err.message : String(err) });
    }
  }

  return new Response(JSON.stringify({ success: true, results }), { headers: { "Content-Type": "application/json" } });
});
