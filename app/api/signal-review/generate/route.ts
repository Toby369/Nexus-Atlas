import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildSignalReviewContext } from "@/lib/signalReviewContext";
import { runTileAnalysis } from "@/lib/ai/router";
import { checkAndRecordRateLimit } from "@/lib/rateLimit";
import type { SignalReviewResult } from "@/lib/types";

// POST /api/signal-review/generate
//
// Periodischer KI-Rueckblick, Phase 3 (10.09.2026) -- liest ausschliesslich
// die in Phase 2 (compute_signal_stats(), signal_stats_results) fertig
// berechneten Zahlen und schreibt eine verstaendliche deutsche Einordnung
// (lib/signalReviewContext.ts + lib/ai/promptProfiles.ts "signal-review").
// Kein eigener Bias, kein Handelssignal. Anders als die meisten anderen
// KI-Kacheln wird diese primaer woechentlich vom signal-review-scheduler-
// Cron ausgeloest (siehe lib/authGate.ts SERVICE_ROLE_BEARER_PATHS), ein
// manueller Klick auf "Neu generieren" bleibt zusaetzlich moeglich.
//
// Auth: proxy.ts erlaubt diese Route entweder per Nutzer-Session ODER per
// CRON_SECRET-Bearer-Token (Server-zu-Server, siehe lib/authGate.ts) --
// keine eigene Pruefung noetig.

const RATE_LIMIT_WINDOW_MINUTES = 60;
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_ENDPOINT = "signal_review_generate";

export async function POST() {
  let supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }

  const rateLimit = await checkAndRecordRateLimit(
    supabaseAdmin,
    RATE_LIMIT_ENDPOINT,
    RATE_LIMIT_WINDOW_MINUTES,
    RATE_LIMIT_MAX_REQUESTS
  );
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: `Rate-Limit erreicht (${RATE_LIMIT_MAX_REQUESTS} Anfragen pro ${RATE_LIMIT_WINDOW_MINUTES} Minuten). Bitte kurz warten.`,
      },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? RATE_LIMIT_WINDOW_MINUTES * 60) } }
    );
  }

  const context = await buildSignalReviewContext();

  // Noch keine signal_stats_results-Zeile vorhanden (Phase 2 hat noch nie
  // gelaufen) -- kein bezahlter AI-Aufruf fuer "nichts zu bewerten" noetig.
  if (context === null) {
    return NextResponse.json(
      { success: false, error: "Noch keine Statistik-Auswertung vorhanden -- nichts einzuordnen." },
      { status: 422 }
    );
  }

  try {
    const result = await runTileAnalysis<SignalReviewResult>("signal-review", {
      context: JSON.stringify(context),
    });

    const { data: snapshot, error: insertError } = await supabaseAdmin
      .from("signal_review_snapshots")
      .insert({
        provider: result.provider,
        model: result.model,
        result: result.data,
        status: "ok",
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { success: false, error: `Rueckblick erzeugt, aber Speichern fehlgeschlagen: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await supabaseAdmin.from("signal_review_snapshots").insert({
      status: "error",
      error: message,
    });

    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
