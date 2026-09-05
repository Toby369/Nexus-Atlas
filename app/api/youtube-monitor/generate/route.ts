import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  searchRecentBtcVideos,
  filterUnseenVideos,
  MAX_NEW_VIDEOS_PER_RUN,
} from "@/lib/youtubeMonitorContext";
import { analyzeYoutubeVideo } from "@/lib/ai/youtubeVideoAnalysis";
import { checkAndRecordRateLimit } from "@/lib/rateLimit";
import type { YoutubeVideoAnalysis } from "@/lib/types";

// POST /api/youtube-monitor/generate
//
// Krypto-YouTube-Monitor (Thema KI, 05.09.2026) -- sucht neue BTC/Krypto-
// relevante YouTube-Videos (YouTube Data API v3, kostenloses Tages-
// kontingent) und analysiert die noch nicht gesehenen per Gemini direkt per
// Video-URL (Google-Free-Tier). Bewusst nur ueber POST -- das Lesen der
// Kachel liest ausschliesslich die zwischengespeicherten letzten Analysen,
// ein neuer Suchlauf passiert nur auf Klick. Analysiert pro Lauf maximal
// MAX_NEW_VIDEOS_PER_RUN neue Videos (Kostenkontrolle: Gemini-Free-Tier hat
// ein Anfragen-pro-Minute/Tag-Limit).
//
// Auth: proxy.ts sperrt diese Route wie jede andere /api/*-Route hinter
// eine Login-Session -- keine eigene Pruefung noetig.

const RATE_LIMIT_WINDOW_MINUTES = 30;
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_ENDPOINT = "youtube_monitor_generate";

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

  let candidates;
  try {
    candidates = await filterUnseenVideos(await searchRecentBtcVideos());
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }

  if (candidates.length === 0) {
    return NextResponse.json(
      { success: false, error: "Keine neuen BTC/Krypto-Videos in den letzten 24h gefunden." },
      { status: 422 }
    );
  }

  const toAnalyze = candidates.slice(0, MAX_NEW_VIDEOS_PER_RUN);
  const inserted: YoutubeVideoAnalysis[] = [];

  for (const candidate of toAnalyze) {
    const contextText = `Titel: ${candidate.title}\nKanal: ${candidate.channelTitle}\nVeroeffentlicht: ${candidate.publishedAt}`;

    try {
      const { result, model } = await analyzeYoutubeVideo(candidate.url, contextText);

      const { data, error: insertError } = await supabaseAdmin
        .from("youtube_video_analyses")
        .insert({
          video_id: candidate.videoId,
          channel_title: candidate.channelTitle,
          title: candidate.title,
          published_at: candidate.publishedAt,
          url: candidate.url,
          model,
          result,
          status: "ok",
        })
        .select()
        .single();

      if (!insertError && data) inserted.push(data);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabaseAdmin.from("youtube_video_analyses").insert({
        video_id: candidate.videoId,
        channel_title: candidate.channelTitle,
        title: candidate.title,
        published_at: candidate.publishedAt,
        url: candidate.url,
        status: "error",
        error: message,
      });
    }
  }

  return NextResponse.json({
    success: true,
    analyzed: inserted.length,
    checked: candidates.length,
    newAnalyses: inserted,
  });
}
