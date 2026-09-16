import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  getYoutubeMonitorConfig,
  findRecentVideoCandidates,
  filterUnseenVideos,
  MAX_NEW_VIDEOS_PER_RUN,
} from "@/lib/youtubeMonitorContext";
import { analyzeYoutubeVideo, YoutubeVideoAnalysisError } from "@/lib/ai/youtubeVideoAnalysis";
import { checkAndRecordRateLimit } from "@/lib/rateLimit";
import { computeYoutubeConsensus } from "@/lib/youtubeConsensus";
import type { YoutubeVideoAnalysis } from "@/lib/types";

// Wie viele juengste Analysen (ueber alle Kanaele) fuer den Kanal-Vergleich
// geladen werden -- dieselbe Grosszuegigkeit wie in app/page.tsx (dort
// begruendet: bei nur 8 wuerde ein besonders aktiver Kanal die anderen aus
// der Liste verdraengen und der Vergleich waere unvollstaendig).
const CONSENSUS_LOOKBACK = 40;

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

// Bis zu MAX_NEW_VIDEOS_PER_RUN sequentielle Gemini-Video-Analysen (siehe
// lib/youtubeMonitorContext.ts, keine Parallelisierung wegen Free-Tier-
// Minutenlimit) koennen laenger als Vercels unkonfigurierten Default
// dauern -- 60s ist das Maximum, das der Hobby-Plan erlaubt (08.09.2026,
// im Rahmen des taeglichen youtube-monitor-scheduler-Crons ergaenzt).
export const maxDuration = 60;

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
  let channelErrors: string[] = [];
  try {
    const config = await getYoutubeMonitorConfig();
    const found = await findRecentVideoCandidates(config);
    channelErrors = found.channelErrors;
    candidates = await filterUnseenVideos(found.candidates);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }

  if (candidates.length === 0) {
    return NextResponse.json(
      {
        success: false,
        error: "Keine neuen Videos in den letzten 24h gefunden.",
        channelErrors,
      },
      { status: 422 }
    );
  }

  const toAnalyze = candidates.slice(0, MAX_NEW_VIDEOS_PER_RUN);
  const inserted: YoutubeVideoAnalysis[] = [];
  // Upsert statt Insert (Konflikt auf video_id, siehe UNIQUE-Constraint):
  // filterUnseenVideos laesst fehlgeschlagene Videos jetzt bewusst erneut
  // zu (Bugfix 16.09.2026) -- ein reines insert() wuerde bei so einem Retry
  // an der UNIQUE-Constraint scheitern und die alte Fehler-Zeile stehen
  // lassen, statt sie durch den neuen Versuch zu ersetzen.
  let quotaExhausted = false;

  for (const candidate of toAnalyze) {
    // Ein 429 (Kontingent ausgeschoepft) betrifft ALLE folgenden Videos in
    // diesem Lauf identisch -- weitere Versuche wuerden nur denselben
    // Fehler x-fach speichern und das ohnehin erschoepfte Kontingent weiter
    // strapazieren. Abbrechen, die uebrigen Kandidaten bleiben unangetastet
    // (kein Fehler-Eintrag) und werden beim naechsten Lauf ganz normal
    // erneut versucht.
    if (quotaExhausted) break;

    const contextText = `Titel: ${candidate.title}\nKanal: ${candidate.channelTitle}\nVeroeffentlicht: ${candidate.publishedAt}`;

    try {
      const { result, model } = await analyzeYoutubeVideo(candidate.url, contextText);

      const { data, error: upsertError } = await supabaseAdmin
        .from("youtube_video_analyses")
        .upsert(
          {
            video_id: candidate.videoId,
            channel_title: candidate.channelTitle,
            title: candidate.title,
            published_at: candidate.publishedAt,
            url: candidate.url,
            generated_at: new Date().toISOString(),
            model,
            result,
            status: "ok",
            error: null,
          },
          { onConflict: "video_id" }
        )
        .select()
        .single();

      if (!upsertError && data) inserted.push(data);
    } catch (err) {
      const isQuotaError = err instanceof YoutubeVideoAnalysisError && err.status === 429;
      if (isQuotaError) quotaExhausted = true;
      // Kontingent-Fehler bekommen eine kurze, verstaendliche Meldung statt
      // des vollen technischen Fehlertexts (Google-Fehler-JSON inkl. Doku-
      // Links) -- der wird sonst 1:1 im Dashboard angezeigt (Nutzer-Meldung
      // 16.09.2026, Screenshot zeigte den Rohtext).
      const message = isQuotaError
        ? "Gemini-Tageskontingent erreicht -- wird beim naechsten Lauf automatisch erneut versucht."
        : err instanceof Error
          ? err.message
          : String(err);
      await supabaseAdmin.from("youtube_video_analyses").upsert(
        {
          video_id: candidate.videoId,
          channel_title: candidate.channelTitle,
          title: candidate.title,
          published_at: candidate.publishedAt,
          url: candidate.url,
          generated_at: new Date().toISOString(),
          model: null,
          result: null,
          status: "error",
          error: message,
        },
        { onConflict: "video_id" }
      );
    }
  }

  // Kanal-Vergleich ueber die juengsten Analysen (nicht nur den aktuellen
  // Batch) -- derselbe Grund wie in app/page.tsx: nur so ist jeder
  // konfigurierte Kanal vertreten, auch wenn er in diesem Lauf keine neue
  // Analyse geliefert hat. 08.09.2026, Nutzer-Wunsch: taeglicher
  // automatischer Check soll eine Push-Nachricht mit dieser Einschaetzung
  // ausloesen koennen (siehe youtube-monitor-scheduler Edge Function).
  const { data: recentAnalyses } = await supabaseAdmin
    .from("youtube_video_analyses")
    .select("*")
    .order("published_at", { ascending: false })
    .limit(CONSENSUS_LOOKBACK);
  const consensus = computeYoutubeConsensus(recentAnalyses ?? []);

  return NextResponse.json({
    success: true,
    analyzed: inserted.length,
    checked: candidates.length,
    newAnalyses: inserted,
    channelErrors,
    consensus,
    quotaExhausted,
  });
}
