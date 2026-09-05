// Krypto-YouTube-Monitor (05.09.2026) -- findet neue BTC/Krypto-relevante
// YouTube-Videos ueber die YouTube Data API v3 (kostenloses Tageskontingent,
// 10'000 Einheiten/Tag, keine Kreditkarte noetig -- eine search.list-Anfrage
// kostet 100 Einheiten). Reines Lesen, kein Schreiben, keine AI hier (siehe
// lib/ai/youtubeVideoAnalysis.ts fuer die eigentliche Video-Analyse).
//
// Server-only (nutzt fetch gegen die YouTube API + Supabase) -- niemals aus
// einer "use client" Komponente importieren.

import { supabase } from "./supabase";

// 24h-Fenster reicht fuer "neue Videos seit dem letzten Check" bei
// mehrmals-taeglicher Nutzung -- ein laengeres Fenster wuerde bei seltener
// Nutzung mehr Kandidaten liefern, aber MAX_NEW_VIDEOS_PER_RUN begrenzt
// ohnehin, wie viele davon tatsaechlich analysiert werden.
const LOOKBACK_HOURS = 24;
const SEARCH_MAX_RESULTS = 10;
// Kostenkontrolle: jede Analyse ist ein Gemini-Aufruf (Free-Tier-Limit ca.
// 10-15 Anfragen/Minute, 1500/Tag) -- pro Lauf werden bewusst nur wenige
// neue Videos analysiert statt alle Treffer auf einmal.
export const MAX_NEW_VIDEOS_PER_RUN = 3;

export interface YoutubeVideoCandidate {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  url: string;
}

interface YoutubeSearchItem {
  id: { videoId: string };
  snippet: { title: string; channelTitle: string; publishedAt: string };
}

/** Sucht per YouTube Data API nach kuerzlich veroeffentlichten BTC/Krypto-Videos. */
export async function searchRecentBtcVideos(): Promise<YoutubeVideoCandidate[]> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new Error("youtubeMonitorContext: kein API-Key gesetzt (erwartet Env-Var YOUTUBE_API_KEY).");
  }

  const publishedAfter = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    key,
    part: "snippet",
    q: "Bitcoin BTC",
    type: "video",
    order: "date",
    publishedAfter,
    maxResults: String(SEARCH_MAX_RESULTS),
  });

  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`youtubeMonitorContext: YouTube API HTTP ${res.status} -- ${errText.slice(0, 300)}`);
  }

  const json = await res.json();
  const items = (json.items ?? []) as YoutubeSearchItem[];

  return items
    .filter((item) => item.id?.videoId)
    .map((item) => ({
      videoId: item.id.videoId,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle,
      publishedAt: item.snippet.publishedAt,
      url: `https://www.youtube.com/watch?v=${item.id.videoId}`,
    }));
}

/** Filtert Kandidaten heraus, die bereits in youtube_video_analyses existieren. */
export async function filterUnseenVideos(
  candidates: YoutubeVideoCandidate[]
): Promise<YoutubeVideoCandidate[]> {
  if (candidates.length === 0) return [];

  const { data, error } = await supabase
    .from("youtube_video_analyses")
    .select("video_id")
    .in(
      "video_id",
      candidates.map((c) => c.videoId)
    );

  if (error) {
    console.error("youtubeMonitorContext: Fehler beim Pruefen bereits gesehener Videos:", error.message);
    return candidates;
  }

  const seen = new Set((data ?? []).map((row) => row.video_id));
  return candidates.filter((c) => !seen.has(c.videoId));
}
