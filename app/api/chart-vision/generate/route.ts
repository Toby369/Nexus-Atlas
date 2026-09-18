import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { analyzeChartVision, ChartVisionAnalysisError } from "@/lib/ai/chartVisionAnalysis";
import { checkAndRecordRateLimit } from "@/lib/rateLimit";

// POST /api/chart-vision/generate
//
// Chart-Vision (Umsetzungsplan "Chart-Vision: LSOB & Trendlinien lesen",
// Phase 3) -- Toby laedt einen TradingView-Screenshot hoch (LSOB-Zonen +
// eigene Trendlinien, beides nur als Pixel vorhanden, nicht strukturiert
// zugaenglich), Gemini liefert eine qualitative Lesung zurueck. Bewusst nur
// EIN Bild pro Aufruf, kein Loop wie beim YouTube-Monitor -- daher kein
// maxDuration-Override noetig (gleiche Einschaetzung wie custom-query).
//
// Auth: proxy.ts sperrt diese Route wie jede andere /api/*-Route hinter
// eine Login-Session -- keine eigene Pruefung noetig.

const RATE_LIMIT_WINDOW_MINUTES = 30;
// Etwas grosszuegiger als custom-query (5/30min): der Upload ist durch den
// manuellen Screenshot-Schritt bereits selbstlimitierend, und die Ausgabe
// ist strukturiert/begrenzt statt offener Freitext. Bleibt trotzdem deutlich
// unter Gemini 2.5 Flashs geteiltem Free-Tier-Tageskontingent (~500 RPD
// ueber alle Google-Kacheln dieser App hinweg).
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_ENDPOINT = "chart_vision_generate";

const STORAGE_BUCKET = "chart-vision-screenshots";
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;
const MAX_NOTE_LENGTH = 500;
const ALLOWED_MIME_TYPES = ["image/jpeg"];

export async function POST(request: Request) {
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

  let imageBase64: string;
  let mimeType: string;
  let note: string | null;
  try {
    const body = await request.json();
    imageBase64 = body?.imageBase64;
    mimeType = body?.mimeType;
    note = typeof body?.note === "string" && body.note.trim().length > 0 ? body.note.trim() : null;
  } catch {
    return NextResponse.json({ success: false, error: "Ungueltiger Request-Body." }, { status: 400 });
  }

  if (typeof imageBase64 !== "string" || imageBase64.length === 0) {
    return NextResponse.json({ success: false, error: "Kein Bild uebergeben." }, { status: 400 });
  }
  if (!ALLOWED_MIME_TYPES.includes(mimeType)) {
    return NextResponse.json(
      { success: false, error: `Nicht unterstuetzter Bildtyp. Erwartet: ${ALLOWED_MIME_TYPES.join(", ")}.` },
      { status: 400 }
    );
  }
  if (note !== null && note.length > MAX_NOTE_LENGTH) {
    return NextResponse.json(
      { success: false, error: `Notiz zu lang (max. ${MAX_NOTE_LENGTH} Zeichen).` },
      { status: 400 }
    );
  }

  let imageBuffer: Buffer;
  try {
    imageBuffer = Buffer.from(imageBase64, "base64");
  } catch {
    return NextResponse.json({ success: false, error: "Bild konnte nicht dekodiert werden." }, { status: 400 });
  }
  if (imageBuffer.length === 0 || imageBuffer.length > MAX_IMAGE_BYTES) {
    return NextResponse.json(
      { success: false, error: `Bild ist zu gross (max. ${Math.round(MAX_IMAGE_BYTES / 1024 / 1024)} MB).` },
      { status: 400 }
    );
  }

  // Upload ZUERST: schlaegt der anschliessende Gemini-Aufruf fehl, bleibt
  // der Screenshot trotzdem erhalten (fuer Retry/History), statt verloren
  // zu gehen.
  const storagePath = `${new Date().toISOString().slice(0, 7)}/${Date.now()}-${crypto.randomUUID()}.jpg`;
  const { error: uploadError } = await supabaseAdmin.storage
    .from(STORAGE_BUCKET)
    .upload(storagePath, imageBuffer, { contentType: mimeType });

  if (uploadError) {
    return NextResponse.json(
      { success: false, error: `Screenshot-Upload fehlgeschlagen: ${uploadError.message}` },
      { status: 502 }
    );
  }

  try {
    const { result, model } = await analyzeChartVision(imageBase64, mimeType, note);

    const { data, error: insertError } = await supabaseAdmin
      .from("chart_vision_analyses")
      .insert({
        storage_path: storagePath,
        image_mime_type: mimeType,
        note,
        provider: "google",
        model,
        result,
        status: "ok",
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { success: false, error: `Analyse erhalten, aber Speichern fehlgeschlagen: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, run: data });
  } catch (err) {
    const isQuotaError = err instanceof ChartVisionAnalysisError && err.status === 429;
    const message = isQuotaError
      ? "Gemini-Tageskontingent erreicht -- bitte spaeter erneut versuchen."
      : err instanceof Error
        ? err.message
        : String(err);

    await supabaseAdmin.from("chart_vision_analyses").insert({
      storage_path: storagePath,
      image_mime_type: mimeType,
      note,
      status: "error",
      error: message,
    });

    return NextResponse.json({ success: false, error: message, quotaExceeded: isQuotaError }, { status: 502 });
  }
}
