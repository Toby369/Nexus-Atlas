import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Einmaliger Backfill (kein Cron) -- Option A der "weiter in die
// Vergangenheit testen"-Recherche: alternative.me liefert die komplette
// Fear-&-Greed-Historie seit 2018-02-01 kostenlos ueber limit=0. Gleiche
// Tabelle/Spalten wie der Live-Collector (collect-sentiment), nur mit dem
// tatsaechlichen Tagesdatum statt "jetzt" als timestamp_utc.
Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const res = await fetch("https://api.alternative.me/fng/?limit=0", {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; NexusAtlas/1.0)" },
  });
  if (!res.ok) {
    return new Response(JSON.stringify({ success: false, error: `HTTP ${res.status}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const json = await res.json();
  const entries: any[] = json?.data ?? [];

  const rows = entries.map((e) => {
    const value = Number.parseInt(e.value, 10);
    return {
      timestamp_utc: new Date(Number(e.timestamp) * 1000).toISOString(),
      source: "alternative.me",
      value: Number.isNaN(value) ? null : value,
      classification: e.value_classification ?? null,
      status: "ok",
      error: null,
    };
  });

  const CHUNK = 500;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { error } = await supabase.from("sentiment_snapshots").insert(chunk);
    if (error) {
      return new Response(JSON.stringify({ success: false, error: error.message, inserted }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
    inserted += chunk.length;
  }

  return new Response(JSON.stringify({ success: true, totalFetched: rows.length, inserted }), {
    headers: { "Content-Type": "application/json" },
  });
});
