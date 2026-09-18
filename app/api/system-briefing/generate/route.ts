import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildSystemBriefingContext } from "@/lib/systemBriefingContext";
import { runTileAnalysis } from "@/lib/ai/router";
import { checkAndRecordRateLimit } from "@/lib/rateLimit";
import type { SystemBriefingResult } from "@/lib/types";

// POST /api/system-briefing/generate
//
// Umsetzungsplan Phase 4 (18.09.2026): erzeugt einen neuen System-Briefing-
// Snapshot (lib/systemBriefingContext.ts -> runTileAnalysis() -> Speichern in
// system_briefings). 1:1 dasselbe Prinzip wie /api/market-state-narrative/
// generate -- nur ein expliziter Klick loest einen bezahlten AI-Aufruf aus,
// das Lesen der Kachel liest ausschliesslich den zwischengespeicherten
// letzten Stand.
//
// Auth: proxy.ts sperrt diese Route wie jede andere /api/*-Route hinter eine
// Login-Session -- keine eigene Pruefung noetig.

const RATE_LIMIT_WINDOW_MINUTES = 20;
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_ENDPOINT = "system_briefing_generate";

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

  const context = await buildSystemBriefingContext();

  try {
    const result = await runTileAnalysis<SystemBriefingResult>("system-briefing", {
      context: JSON.stringify(context),
    });

    const { data: snapshot, error: insertError } = await supabaseAdmin
      .from("system_briefings")
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
        { success: false, error: `Briefing erzeugt, aber Speichern fehlgeschlagen: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await supabaseAdmin.from("system_briefings").insert({
      status: "error",
      error: message,
    });

    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
