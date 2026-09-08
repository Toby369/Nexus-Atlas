import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildTradeDebateContext } from "@/lib/tradeDebateContext";
import { runTileAnalysis } from "@/lib/ai/router";
import { checkAndRecordRateLimit } from "@/lib/rateLimit";
import type { TradeDebateAnalystResult, TradeDebateRefereeResult } from "@/lib/types";

// POST /api/trade-debate/generate
//
// Trade-Debate-Kachel (Nutzer-Idee 07.09.2026, TradingAgents-Architektur
// [arXiv:2412.20138] recherchiert und fuer Einzelnutzer verkleinert): ein
// BULLISHER und ein BAERISCHER Analyst (bewusst unterschiedliche primaere
// Provider, siehe tileConfig.ts "trade-debate-bull"/"-bear") suchen
// UNABHAENGIG voneinander (parallel, kennen die Antwort des jeweils anderen
// nicht) nach einem Long- bzw. Short-Setup anhand desselben strukturierten
// Marktdaten-Kontexts (lib/tradeDebateContext.ts). Ein dritter Referee/CIO
// bekommt danach BEIDE Reports + den urspruenglichen Kontext und faellt die
// finale Entscheidung (long/short/wait) inkl. Divergenz-Pruefung.
//
// Anders als die Eskalations-Kachel (symmetrisches Ensemble, "min. 2 von N
// Reads") braucht der Referee hier zwingend BEIDE Analysten-Ergebnisse --
// faellt einer aus, gibt es nichts, was der Referee gegeneinander abwaegen
// koennte, die Anfrage schlaegt dann komplett fehl statt eines Teilergebnisses.
//
// Auth: proxy.ts sperrt diese Route wie jede andere /api/*-Route hinter
// eine Login-Session -- keine eigene Pruefung noetig.

// 3 KI-Calls pro Auslösung (2 parallel + 1 Referee) -- dieselbe
// Kosten-Zurueckhaltung wie bei der Eskalations-Kachel (identisches Limit).
const RATE_LIMIT_WINDOW_MINUTES = 30;
const RATE_LIMIT_MAX_REQUESTS = 3;
const RATE_LIMIT_ENDPOINT = "trade_debate_generate";

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

  const context = await buildTradeDebateContext();
  if (context === null) {
    return NextResponse.json(
      { success: false, error: "Noch keine ausreichende Datengrundlage (1h-Kerzen-Indikatoren fehlen)." },
      { status: 422 }
    );
  }
  const contextJson = JSON.stringify(context);

  const [bullOutcome, bearOutcome] = await Promise.allSettled([
    runTileAnalysis<TradeDebateAnalystResult>("trade-debate-bull", { context: contextJson }),
    runTileAnalysis<TradeDebateAnalystResult>("trade-debate-bear", { context: contextJson }),
  ]);

  if (bullOutcome.status === "rejected" || bearOutcome.status === "rejected") {
    const failed: string[] = [];
    if (bullOutcome.status === "rejected") {
      failed.push(`Bull: ${bullOutcome.reason instanceof Error ? bullOutcome.reason.message : String(bullOutcome.reason)}`);
    }
    if (bearOutcome.status === "rejected") {
      failed.push(`Bear: ${bearOutcome.reason instanceof Error ? bearOutcome.reason.message : String(bearOutcome.reason)}`);
    }
    const message = `Trade-Debate: Bull und Bear muessen beide antworten, damit der Referee etwas abwaegen kann. ${failed.join(" | ")}`;

    await supabaseAdmin.from("trade_debate_snapshots").insert({
      bull_read:
        bullOutcome.status === "fulfilled"
          ? { provider: bullOutcome.value.provider, model: bullOutcome.value.model, result: bullOutcome.value.data }
          : null,
      bear_read:
        bearOutcome.status === "fulfilled"
          ? { provider: bearOutcome.value.provider, model: bearOutcome.value.model, result: bearOutcome.value.data }
          : null,
      status: "error",
      error: message,
    });

    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }

  const bullRead = {
    provider: bullOutcome.value.provider,
    model: bullOutcome.value.model,
    result: bullOutcome.value.data,
  };
  const bearRead = {
    provider: bearOutcome.value.provider,
    model: bearOutcome.value.model,
    result: bearOutcome.value.data,
  };

  try {
    const refereeContext = JSON.stringify({
      market_data: context,
      bull_analysis: bullRead.result,
      bear_analysis: bearRead.result,
    });

    const refereeOutcome = await runTileAnalysis<TradeDebateRefereeResult>("trade-debate-referee", {
      context: refereeContext,
    });

    const { data: snapshot, error: insertError } = await supabaseAdmin
      .from("trade_debate_snapshots")
      .insert({
        bull_read: bullRead,
        bear_read: bearRead,
        referee_provider: refereeOutcome.provider,
        referee_model: refereeOutcome.model,
        referee_result: refereeOutcome.data,
        verdict: refereeOutcome.data.verdict,
        status: "ok",
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { success: false, error: `Trade-Debate ausgewertet, aber Speichern fehlgeschlagen: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await supabaseAdmin.from("trade_debate_snapshots").insert({
      bull_read: bullRead,
      bear_read: bearRead,
      status: "error",
      error: message,
    });

    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
