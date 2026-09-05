import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildNewsAnalysisContext } from "@/lib/newsAnalysisContext";
import { runTileAnalysis } from "@/lib/ai/router";
import { checkAndRecordRateLimit } from "@/lib/rateLimit";
import type { NewsAnalysisResult } from "@/lib/types";

// POST /api/news-analysis/generate
//
// KI-Ergaenzung zum bestehenden regelbasierten News-Risk-Panel (05.09.2026)
// -- erste produktiv ueber runTileAnalysis()/"auto" aufgerufene Kachel mit
// Perplexity als primaerem Provider (Fallback: Google, siehe tileConfig.ts).
// Bewusst nur ueber POST -- das Lesen der Kachel liest ausschliesslich den
// zwischengespeicherten letzten Stand, nur ein expliziter Klick loest einen
// bezahlten AI-Aufruf aus. Gleiches Prinzip wie /api/handelslage/generate.
//
// Auth: proxy.ts sperrt diese Route wie jede andere /api/*-Route hinter
// eine Login-Session -- keine eigene Pruefung noetig.

const RATE_LIMIT_WINDOW_MINUTES = 20;
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_ENDPOINT = "news_analysis_generate";

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

  const context = await buildNewsAnalysisContext();

  // Keine markbewegende News in den letzten 72h -- kein bezahlter AI-Aufruf
  // fuer "nichts zu analysieren" noetig (dieselbe Kosten-Zurueckhaltung wie
  // bei den anderen KI-Kacheln).
  if (context === null) {
    return NextResponse.json(
      { success: false, error: "Keine markbewegende News in den letzten 72h -- nichts zu analysieren." },
      { status: 422 }
    );
  }

  try {
    const result = await runTileAnalysis<NewsAnalysisResult>("news", { context });

    const { data: snapshot, error: insertError } = await supabaseAdmin
      .from("news_analysis_snapshots")
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
        { success: false, error: `News-Einordnung erzeugt, aber Speichern fehlgeschlagen: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await supabaseAdmin.from("news_analysis_snapshots").insert({
      status: "error",
      error: message,
    });

    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
