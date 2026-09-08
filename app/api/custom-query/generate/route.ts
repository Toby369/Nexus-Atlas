import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildCustomQueryContext } from "@/lib/customQueryContext";
import { runTileAnalysis } from "@/lib/ai/router";
import { checkAndRecordRateLimit } from "@/lib/rateLimit";

// POST /api/custom-query/generate
//
// Freie-Anfrage-Kachel (Nutzer-Wunsch 08.09.2026: "kann ich eine Kachel
// haben, in der ich KI konkreter Auftrag geben kann?"). Der Nutzer schreibt
// eine frei formulierte Aufgabe/Frage, die KI beantwortet sie ausschliesslich
// anhand des echten, strukturierten Nexus-Marktkontexts (siehe
// lib/customQueryContext.ts) -- nie mit erfundenen Zahlen.
//
// Provider-Kette (tileConfig.ts "custom-query"): Google primaer,
// OpenRouter/Groq als Fallback -- komplett kostenlose Kette wie bei
// Trade-Debate.
//
// Auth: proxy.ts sperrt diese Route wie jede andere /api/*-Route hinter
// eine Login-Session -- keine eigene Pruefung noetig.

interface CustomQueryAnswer {
  answer: string;
}

const RATE_LIMIT_WINDOW_MINUTES = 30;
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_ENDPOINT = "custom_query_generate";

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

  let prompt: unknown;
  try {
    const body = await request.json();
    prompt = body?.prompt;
  } catch {
    return NextResponse.json({ success: false, error: "Ungueltiger Request-Body." }, { status: 400 });
  }

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return NextResponse.json({ success: false, error: "Bitte eine Frage/Aufgabe eingeben." }, { status: 400 });
  }

  let context;
  try {
    context = await buildCustomQueryContext(prompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }

  const contextJson = JSON.stringify({
    user_task: context.userTask,
    market_data: context.marketData,
  });

  try {
    const outcome = await runTileAnalysis<CustomQueryAnswer>("custom-query", { context: contextJson });

    const { data, error: insertError } = await supabaseAdmin
      .from("custom_query_runs")
      .insert({
        prompt: context.userTask,
        provider: outcome.provider,
        model: outcome.model,
        answer: outcome.data.answer,
        market_data_generated_at: context.marketData.generated_at,
        status: "ok",
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { success: false, error: `Antwort erhalten, aber Speichern fehlgeschlagen: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, run: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await supabaseAdmin.from("custom_query_runs").insert({
      prompt: context.userTask,
      market_data_generated_at: context.marketData.generated_at,
      status: "error",
      error: message,
    });

    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
