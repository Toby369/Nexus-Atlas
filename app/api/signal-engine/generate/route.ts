import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildSignalEngineContext } from "@/lib/signalEngineContext";
import { runTileAnalysis } from "@/lib/ai/router";
import { checkAndRecordRateLimit } from "@/lib/rateLimit";
import type { SignalEngineResult } from "@/lib/types";

// POST /api/signal-engine/generate
//
// Thema KI, Punkt 2/2 (05.09.2026) -- zweite ueber runTileAnalysis()/"auto"
// aufgerufene Kachel, mit Anthropic als primaerem Provider (Fallback:
// DeepSeek, siehe tileConfig.ts). Prueft die bestehende regelbasierte
// Gesamteinschaetzung (14-Faktoren-Engine) auf innere Konsistenz -- kein
// eigener Bias. Bewusst nur ueber POST -- das Lesen der Kachel liest
// ausschliesslich den zwischengespeicherten letzten Stand, nur ein
// expliziter Klick loest einen bezahlten AI-Aufruf aus. Gleiches Prinzip
// wie /api/handelslage/generate und /api/news-analysis/generate.
//
// Auth: proxy.ts sperrt diese Route wie jede andere /api/*-Route hinter
// eine Login-Session -- keine eigene Pruefung noetig.

const RATE_LIMIT_WINDOW_MINUTES = 20;
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_ENDPOINT = "signal_engine_generate";

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

  const context = await buildSignalEngineContext();

  // Noch keine market_states-Zeile vorhanden -- kein bezahlter AI-Aufruf
  // fuer "nichts zu pruefen" noetig (dieselbe Kosten-Zurueckhaltung wie bei
  // den anderen KI-Kacheln).
  if (context === null) {
    return NextResponse.json(
      { success: false, error: "Noch keine Gesamteinschaetzung vorhanden -- nichts zu pruefen." },
      { status: 422 }
    );
  }

  try {
    const result = await runTileAnalysis<SignalEngineResult>("signal-engine", {
      context: JSON.stringify(context),
    });

    const { data: snapshot, error: insertError } = await supabaseAdmin
      .from("signal_engine_snapshots")
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
        { success: false, error: `Signal-Engine-Pruefung erzeugt, aber Speichern fehlgeschlagen: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await supabaseAdmin.from("signal_engine_snapshots").insert({
      status: "error",
      error: message,
    });

    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
