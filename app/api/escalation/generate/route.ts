import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { detectEscalationTriggers, buildEscalationContext } from "@/lib/escalationContext";
import { computeEscalationConsensus } from "@/lib/escalationConsensus";
import { runTileAnalysis } from "@/lib/ai/router";
import { ESCALATION_PROVIDER_ENSEMBLE } from "@/lib/ai/tileConfig";
import { checkAndRecordRateLimit } from "@/lib/rateLimit";
import type { AIProviderId } from "@/lib/ai/types";
import type { EscalationRead } from "@/lib/types";

// POST /api/escalation/generate
//
// "Gezielte Eskalation" (Thema KI, 05.09.2026): statt einer dauerhaften
// 2-4-fach-Kachel (verworfen -- Modell-Uneinigkeit auf denselben Rohdaten
// spiegelt meist Modellrauschen statt echter Markt-Ambiguitaet), holt diese
// Route mehrere unabhaengige AI-Meinungen NUR ein, wenn Nexus intern bereits
// eine Divergenz/einen Widerspruch erkannt hat (Signal-Engine, Divergenz-
// Radar, Report-Master -- siehe lib/escalationContext.ts). Die
// Trigger-Erkennung selbst ist kostenlos (reine DB-Reads); erst wenn
// mindestens ein Trigger aktiv ist, werden die drei Provider aus
// ESCALATION_PROVIDER_ENSEMBLE parallel aufgerufen.
//
// Auth: proxy.ts sperrt diese Route wie jede andere /api/*-Route hinter
// eine Login-Session -- keine eigene Pruefung noetig.

// Grosszuegigeres Limit als bei den anderen Kacheln (20min/5), weil ein
// einzelner Aufruf hier bis zu 3 bezahlte Provider-Calls ausloest.
const RATE_LIMIT_WINDOW_MINUTES = 30;
const RATE_LIMIT_MAX_REQUESTS = 3;
const RATE_LIMIT_ENDPOINT = "escalation_generate";

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

  const triggers = await detectEscalationTriggers();
  if (triggers.length === 0) {
    return NextResponse.json(
      { success: false, error: "Aktuell keine Divergenz/kein Widerspruch erkannt -- keine Eskalation noetig." },
      { status: 422 }
    );
  }

  const context = await buildEscalationContext(triggers);
  if (context === null) {
    return NextResponse.json(
      { success: false, error: "Noch keine Gesamteinschaetzung vorhanden -- nichts, worauf sich eine Zweitmeinung beziehen koennte." },
      { status: 422 }
    );
  }

  const contextJson = JSON.stringify(context);
  const settled = await Promise.allSettled(
    ESCALATION_PROVIDER_ENSEMBLE.map((providerId: AIProviderId) =>
      runTileAnalysis<{ bias: EscalationRead["bias"]; confidence: number; summary: string }>("escalation", {
        context: contextJson,
        providerOverride: providerId,
      })
    )
  );

  const reads: EscalationRead[] = [];
  const failedProviders: string[] = [];

  settled.forEach((outcome, i) => {
    const providerId = ESCALATION_PROVIDER_ENSEMBLE[i];
    if (outcome.status === "fulfilled") {
      reads.push({
        provider: outcome.value.provider,
        model: outcome.value.model,
        bias: outcome.value.data.bias,
        confidence: outcome.value.data.confidence,
        summary: outcome.value.data.summary,
      });
    } else {
      failedProviders.push(providerId);
    }
  });

  if (reads.length < 2) {
    const message = `Zu wenige Provider haben geantwortet fuer eine Konsens-Auswertung (${reads.length}/${ESCALATION_PROVIDER_ENSEMBLE.length} erfolgreich, fehlgeschlagen: ${failedProviders.join(", ") || "keine"}).`;

    await supabaseAdmin.from("escalation_snapshots").insert({
      trigger_reasons: triggers,
      reads,
      failed_providers: failedProviders,
      status: "error",
      error: message,
    });

    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }

  const consensus = computeEscalationConsensus(reads);

  const { data: snapshot, error: insertError } = await supabaseAdmin
    .from("escalation_snapshots")
    .insert({
      trigger_reasons: triggers,
      reads,
      failed_providers: failedProviders,
      consensus,
      status: "ok",
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json(
      { success: false, error: `Eskalation ausgewertet, aber Speichern fehlgeschlagen: ${insertError.message}` },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, snapshot });
}
