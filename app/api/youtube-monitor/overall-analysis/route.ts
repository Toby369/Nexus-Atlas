import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { runTileAnalysis } from "@/lib/ai/router";
import { checkAndRecordRateLimit } from "@/lib/rateLimit";
import type { YoutubeVideoAnalysis, YoutubeOverallAnalysisResult } from "@/lib/types";

// POST /api/youtube-monitor/overall-analysis
//
// Gesamtanalyse-Kachel des YouTube-Monitors (Nutzer-Wunsch 14.09.2026:
// "ich moechte eine gesamt anayse der einzelnen analysierten youtube
// beitraege"). Nutzt KEINE neuen YouTube-/Video-API-Aufrufe -- liest
// ausschliesslich die bereits gespeicherten Einzelanalysen aus
// youtube_video_analyses und laesst sie per Text-Prompt (nicht
// multimodal, siehe lib/ai/youtubeVideoAnalysis.ts fuer den Unterschied)
// zu EINER Gesamteinschaetzung synthetisieren -- Widersprueche zwischen
// Kanaelen werden explizit benannt statt zu einem Bias gemittelt (gleiche
// Philosophie wie der Master-Report der AI Report Engine).
//
// Provider-Kette (tileConfig.ts "youtube-overall-analysis"): Google
// primaer, OpenRouter/Groq als Fallback -- komplett kostenlose Kette wie
// bei custom-query/trade-debate-referee.
//
// Auth: proxy.ts sperrt diese Route wie jede andere /api/*-Route hinter
// eine Login-Session -- keine eigene Pruefung noetig.

const ANALYSIS_LOOKBACK = 30;
const MIN_VIDEOS_REQUIRED = 2;

const RATE_LIMIT_WINDOW_MINUTES = 30;
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_ENDPOINT = "youtube_overall_analysis";

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

  const { data: recent, error: readError } = await supabase
    .from("youtube_video_analyses")
    .select("*")
    .eq("status", "ok")
    .order("published_at", { ascending: false })
    .limit(ANALYSIS_LOOKBACK);

  if (readError) {
    return NextResponse.json(
      { success: false, error: `Einzelanalysen konnten nicht geladen werden: ${readError.message}` },
      { status: 500 }
    );
  }

  const analyses = (recent ?? []) as YoutubeVideoAnalysis[];
  if (analyses.length < MIN_VIDEOS_REQUIRED) {
    return NextResponse.json(
      {
        success: false,
        error: `Mindestens ${MIN_VIDEOS_REQUIRED} analysierte Videos noetig, aktuell ${analyses.length}.`,
      },
      { status: 422 }
    );
  }

  const contextVideos = analyses
    .filter((a) => a.result)
    .map((a) => ({
      channel: a.channel_title,
      title: a.title,
      published_at: a.published_at,
      bias: a.result!.bias,
      confidence: a.result!.confidence,
      relevance: a.result!.relevance,
      summary: a.result!.summary,
    }));

  try {
    const outcome = await runTileAnalysis<YoutubeOverallAnalysisResult>("youtube-overall-analysis", {
      context: JSON.stringify({ videos: contextVideos }),
    });

    const { data, error: insertError } = await supabaseAdmin
      .from("youtube_overall_analyses")
      .insert({
        video_count: contextVideos.length,
        provider: outcome.provider,
        model: outcome.model,
        result: outcome.data,
        status: "ok",
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { success: false, error: `Gesamtanalyse erstellt, aber Speichern fehlgeschlagen: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, run: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await supabaseAdmin.from("youtube_overall_analyses").insert({
      video_count: contextVideos.length,
      status: "error",
      error: message,
    });

    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
