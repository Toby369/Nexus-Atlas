import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildHandelslageContext } from "@/lib/handelslageContext";
import { runTileAnalysis } from "@/lib/ai/router";
import { checkAndRecordRateLimit } from "@/lib/rateLimit";
import type { HandelslageResult } from "@/lib/types";

// POST /api/handelslage/generate
//
// Umsetzungsplan Phase 3 (05.09.2026): erzeugt einen neuen Handelslage-
// Snapshot (lib/handelslageContext.ts -> runTileAnalysis() -> Speichern in
// handelslage_snapshots). Bewusst nur ueber POST -- das Lesen der Kachel
// (GET, ueber getLatestHandelslage() in app/page.tsx) liest ausschliesslich
// den zwischengespeicherten letzten Stand und kostet nichts; nur ein
// expliziter Klick ("Neu generieren"-Button) loest einen bezahlten
// AI-Aufruf aus. Gleiches Prinzip wie /api/reports/run.
//
// Auth: proxy.ts sperrt diese Route wie jede andere /api/*-Route hinter
// eine Login-Session -- keine eigene Pruefung noetig.

const RATE_LIMIT_WINDOW_MINUTES = 20;
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_ENDPOINT = "handelslage_generate";

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

  const context = await buildHandelslageContext();

  try {
    const result = await runTileAnalysis<HandelslageResult>("handelslage", {
      context: JSON.stringify(context),
    });

    const { data: snapshot, error: insertError } = await supabaseAdmin
      .from("handelslage_snapshots")
      .insert({
        provider: result.provider,
        model: result.model,
        bewegungsvorrat_pct: context.bewegungsvorrat.ratio_pct,
        result: result.data,
        status: "ok",
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { success: false, error: `Handelslage erzeugt, aber Speichern fehlgeschlagen: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await supabaseAdmin.from("handelslage_snapshots").insert({
      bewegungsvorrat_pct: context.bewegungsvorrat.ratio_pct,
      status: "error",
      error: message,
    });

    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
