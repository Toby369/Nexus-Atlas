import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

// Periodischer KI-Rueckblick, Phase 3 (10.09.2026): woechentlicher Trigger
// fuer die bereits bestehende, auf Vercel gehostete Route
// POST /api/signal-review/generate (liest signal_stats_results aus Phase 2
// und schreibt eine KI-Einordnung nach signal_review_snapshots). Ruft
// KEINE AI-Provider selbst auf und dupliziert keine Logik -- reiner
// Trigger, gleiches Muster wie youtube-monitor-scheduler/report-scheduler.
//
// CRON_SECRET aus dem Supabase Vault (get_secret-RPC) statt eines
// wiederverwendeten Service-Role-Keys -- gleiche Begruendung wie bei
// youtube-monitor-scheduler (eng geschnittenes, unabhaengig rotierbares
// Secret statt vollem DB-Bypass als Bearer-Token). proxy.ts/lib/authGate.ts
// vergleicht dagegen die identische Vercel-Umgebungsvariable CRON_SECRET.
//
// Zeitplan (siehe Migration): Montag 05:15 UTC, 15 Minuten nach dem
// woechentlichen compute_signal_stats()-Cron (Montag 05:00 UTC) -- damit
// signal_stats_results garantiert frisch ist, bevor die KI sie liest.

const APP_URL = Deno.env.get("NEXUS_APP_URL") ?? "https://nexus-atlas-zeta.vercel.app";

interface GenerateResponse {
  success: boolean;
  error?: string;
}

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
    res = await fetch(`${APP_URL}/api/signal-review/generate`, {
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
        error: `Aufruf von /api/signal-review/generate fehlgeschlagen: ${err instanceof Error ? err.message : String(err)}`,
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const json = (await res.json().catch(() => ({}))) as GenerateResponse;

  // 422 = "noch keine signal_stats_results-Zeile vorhanden" -- kein Fehler,
  // nur nichts einzuordnen (siehe app/api/signal-review/generate/route.ts).
  if (res.status === 422) {
    return new Response(JSON.stringify({ success: true, skipped: "no_stats_yet" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

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
