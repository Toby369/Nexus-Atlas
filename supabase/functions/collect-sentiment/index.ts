import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Crypto Fear & Greed Index (alternative.me) -- freie, oeffentliche API ohne
// API-Key. Der Index wird i.d.R. einmal taeglich (UTC-Mitternacht) neu
// berechnet; wir fragen ihn stuendlich ab, um keinen Tageswechsel zu
// verpassen, ohne den kostenlosen Dienst unnoetig zu belasten.
const FNG_URL = "https://api.alternative.me/fng/?limit=1";

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const now = new Date().toISOString();

  try {
    const res = await fetch(FNG_URL, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; NexusAtlas/1.0)" },
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const json = await res.json();
    const entry = json?.data?.[0];
    if (!entry) {
      throw new Error("Keine Daten in der Antwort");
    }

    const value = Number.parseInt(entry.value, 10);
    const classification: string = entry.value_classification ?? null;

    const { error: insertError } = await supabase.from("sentiment_snapshots").insert({
      timestamp_utc: now,
      source: "alternative.me",
      value: Number.isNaN(value) ? null : value,
      classification,
      status: "ok",
      error: null,
    });
    if (insertError) throw insertError;

    return new Response(JSON.stringify({ success: true, value, classification }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("sentiment_snapshots").insert({
      timestamp_utc: now,
      source: "alternative.me",
      value: null,
      classification: null,
      status: "error",
      error: message,
    });
    return new Response(JSON.stringify({ success: false, error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
