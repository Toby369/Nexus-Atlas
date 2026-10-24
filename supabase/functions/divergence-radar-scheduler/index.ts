import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Periodischer KI-Rueckblick, Phase 5 (10.09.2026): alle 15 Minuten ein
// Trigger fuer die bereits bestehende, auf Vercel gehostete Route
// POST /api/divergence-radar/snapshot (persistiert den bisher nur live
// berechneten Divergenz-Radar nach divergence_radar_snapshots). Kein AI-
// Aufruf, reiner Datenerfassungs-Trigger -- gleiches Muster wie
// signal-review-scheduler/youtube-monitor-scheduler.
//
// CRON_SECRET aus dem Supabase Vault (get_secret-RPC), gleiche Begruendung
// wie bei den anderen Schedulern.

const APP_URL = Deno.env.get("NEXUS_APP_URL") ?? "https://nexus-atlas-zeta.vercel.app";

Deno.serve(async (_req: Request) => {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: cronSecret, error: secretError } = await supabase.rpc("get_secret", {
    secret_name: "CRON_SECRET",
  });
  if (secretError || !cronSecret) {
    return new Response(
      JSON.stringify({
        success: false,
        error: secretError ? secretError.message : "CRON_SECRET nicht in Vault hinterlegt",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  let res: Response;
  try {
    res = await fetch(`${APP_URL}/api/divergence-radar/snapshot`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cronSecret}`,
      },
    });
  } catch (err) {
    return new Response(
      JSON.stringify({
        success: false,
        error: `Aufruf von /api/divergence-radar/snapshot fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const json = (await res.json().catch(() => ({}))) as { success?: boolean; error?: string };

  if (!res.ok || json.success !== true) {
    return new Response(JSON.stringify({ success: false, error: json.error ?? `HTTP ${res.status}` }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(JSON.stringify({ success: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
