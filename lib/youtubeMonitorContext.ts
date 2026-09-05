// Krypto-YouTube-Monitor (05.09.2026) -- findet neue BTC/Krypto-relevante
// YouTube-Videos ueber die YouTube Data API v3 (kostenloses Tageskontingent,
// 10'000 Einheiten/Tag, keine Kreditkarte noetig). Zwei Quellen, per
// youtube_monitor_config vom Nutzer konfigurierbar (Nutzer-Wunsch "kann ich
// hinterlegen was angesehen werden soll"):
//   1. Freitext-Suche (search.list, 100 Einheiten/Aufruf) -- breit, findet
//      auch unbekannte Quellen.
//   2. Konkrete Kanaele (playlistItems.list auf die Uploads-Playlist,
//      1 Einheit/Aufruf) -- praezise, nur die vom Nutzer genannten Kanaele.
// Reines Lesen, kein Schreiben (ausser der Config selbst), keine AI hier
// (siehe lib/ai/youtubeVideoAnalysis.ts fuer die eigentliche Video-Analyse).
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
const PLAYLIST_MAX_RESULTS = 5;
const DEFAULT_SEARCH_QUERY = "Bitcoin BTC";
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

export interface YoutubeMonitorChannel {
  /** Was der Nutzer eingegeben hat (Handle/URL/ID) -- fuer Anzeige/Fehlermeldungen. */
  input: string;
  channelId: string;
  uploadsPlaylistId: string;
  title: string;
}

export interface YoutubeMonitorConfig {
  searchQuery: string;
  channels: YoutubeMonitorChannel[];
}

async function getYoutubeApiKey(): Promise<string> {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) {
    throw new Error("youtubeMonitorContext: kein API-Key gesetzt (erwartet Env-Var YOUTUBE_API_KEY).");
  }
  return key;
}

/** Liest die (einzige) Konfigurationszeile -- Default, falls noch keine existiert. */
export async function getYoutubeMonitorConfig(): Promise<YoutubeMonitorConfig> {
  const { data, error } = await supabase
    .from("youtube_monitor_config")
    .select("search_query, channels")
    .eq("id", 1)
    .maybeSingle();

  if (error) {
    console.error("youtubeMonitorContext: Fehler beim Laden der Konfiguration:", error.message);
    return { searchQuery: DEFAULT_SEARCH_QUERY, channels: [] };
  }
  if (!data) return { searchQuery: DEFAULT_SEARCH_QUERY, channels: [] };

  return {
    // Nullish statt "||": eine bewusst geleerte Suche (nur konfigurierte
    // Kanaele, keine Freitext-Suche) ist ein gueltiger leerer String, kein
    // Grund auf den Default zurueckzufallen.
    searchQuery: data.search_query ?? DEFAULT_SEARCH_QUERY,
    channels: (data.channels ?? []) as YoutubeMonitorChannel[],
  };
}

/**
 * Loest eine Nutzer-Eingabe (Handle "@Name", volle Kanal-URL oder rohe
 * Kanal-ID "UC...") in Kanal-ID + Uploads-Playlist-ID + Titel auf. Wirft bei
 * unbekanntem/nicht gefundenem Kanal -- Aufrufer faengt das pro Eingabe ab,
 * damit ein Tippfehler nicht die ganze Konfiguration blockiert.
 */
export async function resolveYoutubeChannel(input: string): Promise<YoutubeMonitorChannel> {
  const key = await getYoutubeApiKey();
  const trimmed = input.trim();

  const channelUrlMatch = trimmed.match(/youtube\.com\/channel\/(UC[\w-]+)/i);
  const handleUrlMatch = trimmed.match(/youtube\.com\/@([\w.-]+)/i);
  const rawChannelId = /^UC[\w-]{10,}$/.test(trimmed) ? trimmed : null;

  const params = new URLSearchParams({ key, part: "snippet,contentDetails" });
  if (channelUrlMatch) {
    params.set("id", channelUrlMatch[1]);
  } else if (rawChannelId) {
    params.set("id", rawChannelId);
  } else if (handleUrlMatch) {
    params.set("forHandle", `@${handleUrlMatch[1]}`);
  } else {
    // Freitext oder "@Name" ohne URL -- als Handle versuchen (deckt den
    // haeufigsten Fall ab: Nutzer tippt "@KanalName" oder nur "KanalName").
    params.set("forHandle", trimmed.startsWith("@") ? trimmed : `@${trimmed}`);
  }

  const res = await fetch(`https://www.googleapis.com/youtube/v3/channels?${params.toString()}`);
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Kanal "${input}": YouTube API HTTP ${res.status} -- ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  const item = json.items?.[0];
  if (!item) {
    throw new Error(`Kanal "${input}": nicht gefunden.`);
  }

  const uploadsPlaylistId = item.contentDetails?.relatedPlaylists?.uploads;
  if (!uploadsPlaylistId) {
    throw new Error(`Kanal "${input}": keine Uploads-Playlist gefunden.`);
  }

  return {
    input,
    channelId: item.id,
    uploadsPlaylistId,
    title: item.snippet?.title ?? input,
  };
}

interface YoutubeSearchItem {
  id: { videoId: string };
  snippet: { title: string; channelTitle: string; publishedAt: string };
}

/** Sucht per YouTube Data API (Freitext) nach kuerzlich veroeffentlichten Videos. */
async function searchRecentVideos(searchQuery: string): Promise<YoutubeVideoCandidate[]> {
  const key = await getYoutubeApiKey();
  const publishedAfter = new Date(Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
  const params = new URLSearchParams({
    key,
    part: "snippet",
    q: searchQuery || DEFAULT_SEARCH_QUERY,
    type: "video",
    order: "date",
    publishedAfter,
    maxResults: String(SEARCH_MAX_RESULTS),
  });

  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`youtubeMonitorContext: YouTube-Suche HTTP ${res.status} -- ${errText.slice(0, 300)}`);
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

interface YoutubePlaylistItem {
  contentDetails: { videoId: string; videoPublishedAt?: string };
  snippet: { title: string; channelTitle: string; publishedAt: string };
}

/** Liest die juengsten Uploads eines konkreten, konfigurierten Kanals. */
async function fetchRecentChannelVideos(channel: YoutubeMonitorChannel): Promise<YoutubeVideoCandidate[]> {
  const key = await getYoutubeApiKey();
  const params = new URLSearchParams({
    key,
    part: "snippet,contentDetails",
    playlistId: channel.uploadsPlaylistId,
    maxResults: String(PLAYLIST_MAX_RESULTS),
  });

  const res = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params.toString()}`);
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(
      `youtubeMonitorContext: Kanal "${channel.title}" HTTP ${res.status} -- ${errText.slice(0, 300)}`
    );
  }

  const json = await res.json();
  const items = (json.items ?? []) as YoutubePlaylistItem[];
  const cutoffMs = Date.now() - LOOKBACK_HOURS * 60 * 60 * 1000;

  return items
    .filter((item) => item.contentDetails?.videoId)
    .filter((item) => new Date(item.snippet.publishedAt).getTime() >= cutoffMs)
    .map((item) => ({
      videoId: item.contentDetails.videoId,
      title: item.snippet.title,
      channelTitle: item.snippet.channelTitle || channel.title,
      publishedAt: item.snippet.publishedAt,
      url: `https://www.youtube.com/watch?v=${item.contentDetails.videoId}`,
    }));
}

/**
 * Kombiniert Freitext-Suche + konfigurierte Kanaele zu einer deduplizierten
 * Kandidatenliste. Ein einzelner fehlschlagender Kanal (z.B. geloescht)
 * bricht nicht den gesamten Lauf ab -- die Suche und die anderen Kanaele
 * liefern trotzdem Ergebnisse.
 */
export async function findRecentVideoCandidates(
  config: YoutubeMonitorConfig
): Promise<{ candidates: YoutubeVideoCandidate[]; channelErrors: string[] }> {
  const channelErrors: string[] = [];

  const [searchResults, ...channelResults] = await Promise.all([
    config.searchQuery.trim().length === 0
      ? Promise.resolve([] as YoutubeVideoCandidate[])
      : searchRecentVideos(config.searchQuery).catch((err) => {
          channelErrors.push(err instanceof Error ? err.message : String(err));
          return [] as YoutubeVideoCandidate[];
        }),
    ...config.channels.map((channel) =>
      fetchRecentChannelVideos(channel).catch((err) => {
        channelErrors.push(err instanceof Error ? err.message : String(err));
        return [] as YoutubeVideoCandidate[];
      })
    ),
  ]);

  const byVideoId = new Map<string, YoutubeVideoCandidate>();
  for (const candidate of [searchResults, ...channelResults].flat()) {
    byVideoId.set(candidate.videoId, candidate);
  }

  return { candidates: Array.from(byVideoId.values()), channelErrors };
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
