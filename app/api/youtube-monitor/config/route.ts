import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { resolveYoutubeChannel, type YoutubeMonitorChannel } from "@/lib/youtubeMonitorContext";

// POST /api/youtube-monitor/config
//
// Speichert die Nutzer-Konfiguration des Krypto-YouTube-Monitors (Nutzer-
// Wunsch 05.09.2026: "kann ich hinterlegen was angesehen werden soll") --
// Freitext-Suchbegriff (leer = keine Freitext-Suche, nur Kanaele) und eine
// Liste von Kanal-Eingaben (Handle "@Name", volle Kanal-URL oder rohe
// Kanal-ID), die serverseitig gegen die YouTube API aufgeloest werden. Ein
// einzelner nicht aufloesbarer Kanal blockiert nicht das Speichern der
// uebrigen -- er erscheint in channelErrors, damit die UI den Tippfehler
// zeigen kann.
//
// Auth: proxy.ts sperrt diese Route wie jede andere /api/*-Route hinter
// eine Login-Session -- keine eigene Pruefung noetig. Kein Rate-Limit noetig
// (kein bezahlter AI-Aufruf, nur guenstige YouTube-API-Calls beim Speichern).

interface ConfigRequestBody {
  searchQuery?: unknown;
  channelInputs?: unknown;
}

export async function POST(request: Request) {
  let supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }

  let body: ConfigRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Ungueltiger Request-Body (kein JSON)." }, { status: 400 });
  }

  const searchQuery = typeof body.searchQuery === "string" ? body.searchQuery.trim() : "";
  const channelInputs = Array.isArray(body.channelInputs)
    ? body.channelInputs.filter((c): c is string => typeof c === "string" && c.trim().length > 0)
    : [];

  const channels: YoutubeMonitorChannel[] = [];
  const channelErrors: string[] = [];

  for (const input of channelInputs) {
    try {
      channels.push(await resolveYoutubeChannel(input));
    } catch (err) {
      channelErrors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const { data, error: upsertError } = await supabaseAdmin
    .from("youtube_monitor_config")
    .upsert({ id: 1, search_query: searchQuery, channels, updated_at: new Date().toISOString() })
    .select()
    .single();

  if (upsertError) {
    return NextResponse.json(
      { success: false, error: `Speichern fehlgeschlagen: ${upsertError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, config: data, channelErrors });
}
