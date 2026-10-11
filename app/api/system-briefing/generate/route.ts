import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  buildSystemBriefingContext,
  sliceForRegelwerk,
  sliceForChartStruktur,
  sliceForTrigger,
  sliceForSynthese,
} from "@/lib/systemBriefingContext";
import { runTileAnalysis } from "@/lib/ai/router";
import { checkAndRecordRateLimit } from "@/lib/rateLimit";
import type { SystemBriefingResult, SystemBriefingTrigger } from "@/lib/types";

// POST /api/system-briefing/generate
//
// Erzeugt einen neuen System-Briefing-Snapshot (lib/systemBriefingContext.ts
// -> KI-Aufrufe -> Speichern in system_briefings). Nur ein expliziter Klick
// (oder der Auto-Refresh des Lagebilds) loest KI-Aufrufe aus; das Lesen der
// Kachel liest nur den gespeicherten Stand.
//
// Auth: proxy.ts sperrt diese Route wie jede andere /api/*-Route hinter eine
// Login-Session -- keine eigene Pruefung noetig.
//
// Aufbau wie die AI Report Engine: drei kleine, unabhaengige Teil-Aufrufe
// PARALLEL (Regelwerk-Check, Chart-Struktur, Trigger & Szenario), danach EIN
// kleiner Synthese-Call, der nur die drei Ergebnisse verdichtet -- siehe
// lib/ai/promptProfiles.ts ("system-briefing-*") und
// lib/systemBriefingContext.ts (sliceFor*). Die gespeicherte
// SystemBriefingResult-Form ist unveraendert.
//
// Warum so: ein einzelner grosser Aufruf riss bei jedem Versuch Vercels
// 60s-Limit (Hobby-Plan). Vier SEQUENZIELLE Aufrufe rissen es ebenfalls
// (clientseitig "Failed to fetch" -- Vercel killt die Funktion, bevor sie
// antworten kann). Daher parallel, mit den drei Teilen auf verschiedenen
// Vendors, damit Google nicht mehrfach gleichzeitig belastet wird (siehe
// lib/ai/tileConfig.ts).
//
// 300s statt 60s: mit Fluid Compute erlaubt auch der Hobby-Plan 300s. Das
// 60s-Limit zwang die Provider auf 20s, was Gratis-Modelle fuer diese Teile
// regelmaessig rissen -- jeder Versuch scheiterte (Zeitbudget siehe
// BRIEFING_TIMEOUT_MS in lib/ai/tileConfig.ts).
export const maxDuration = 300;

const RATE_LIMIT_WINDOW_MINUTES = 20;
const RATE_LIMIT_MAX_REQUESTS = 5;
const RATE_LIMIT_ENDPOINT = "system_briefing_generate";

interface RegelwerkResult {
  regelwerkCheck: string;
  leanBias: "bullish" | "bearish" | "neutral";
}

interface ChartStrukturResult {
  chartStruktur: string;
  leanBias: "bullish" | "bearish" | "neutral";
}

interface SyntheseResult {
  fazit: SystemBriefingResult["fazit"];
  konfluenzCheck: string | null;
}

export async function POST() {
  let supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }

  // Abgesichert, weil ein echter Netzwerkfehler beim Fetch an Supabase eine
  // Exception wirft (Supabase-FEHLERANTWORTEN faengt
  // checkAndRecordRateLimit selbst ab). Ungefangen liefert Vercel eine
  // HTML/Text-Fehlerseite statt JSON, die der Client vergeblich parsen
  // wuerde ("Unexpected token 'A'...").
  let rateLimit: Awaited<ReturnType<typeof checkAndRecordRateLimit>>;
  try {
    rateLimit = await checkAndRecordRateLimit(
      supabaseAdmin,
      RATE_LIMIT_ENDPOINT,
      RATE_LIMIT_WINDOW_MINUTES,
      RATE_LIMIT_MAX_REQUESTS
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `Rate-Limit-Pruefung fehlgeschlagen: ${message}` },
      { status: 500 }
    );
  }
  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        error: `Rate-Limit erreicht (${RATE_LIMIT_MAX_REQUESTS} Anfragen pro ${RATE_LIMIT_WINDOW_MINUTES} Minuten). Bitte kurz warten.`,
      },
      { status: 429, headers: { "Retry-After": String(rateLimit.retryAfterSeconds ?? RATE_LIMIT_WINDOW_MINUTES * 60) } }
    );
  }

  try {
    const context = await buildSystemBriefingContext();

    // Drei fokussierte, voneinander unabhaengige Teil-Aufrufe PARALLEL --
    // jeder bekommt nur seinen eigenen Daten-Ausschnitt (sliceFor*), daher
    // deutlich kleinerer Prompt je Call als vorher der eine grosse. Bewusst
    // Promise.all (nicht nacheinander, siehe Datei-Kopfkommentar fuer den
    // Vorfall mit der sequenziellen Zwischenversion): tileConfig.ts verteilt
    // die vier Teil-Aufrufe bereits auf zwei Provider, dadurch treffen hier
    // ohnehin nur zwei (Regelwerk + Trigger) gleichzeitig auf Google, nicht
    // alle drei/vier wie vorher.
    const [regelwerkResult, chartResult, triggerResult] = await Promise.all([
      runTileAnalysis<RegelwerkResult>("system-briefing-regelwerk", {
        context: JSON.stringify(sliceForRegelwerk(context)),
      }),
      runTileAnalysis<ChartStrukturResult>("system-briefing-chart", {
        context: JSON.stringify(sliceForChartStruktur(context)),
      }),
      runTileAnalysis<SystemBriefingTrigger>("system-briefing-trigger", {
        context: JSON.stringify(sliceForTrigger(context)),
      }),
    ]);

    // Vierter Call: verdichtet die drei Teil-Ergebnisse zu Fazit +
    // Konfluenz-Check -- bekommt KEINE Rohdaten mehr (ausser dem kleinen
    // Abgleichs-Schnitt in sliceForSynthese), analog zu report-master, das
    // ebenfalls nur die drei Teilreports liest statt neu zu rechnen.
    const syntheseResult = await runTileAnalysis<SyntheseResult>("system-briefing-synthese", {
      context: JSON.stringify(
        sliceForSynthese(context, {
          regelwerkCheck: regelwerkResult.data,
          chartStruktur: chartResult.data,
          trigger: triggerResult.data,
        })
      ),
    });

    const combined: SystemBriefingResult = {
      fazit: syntheseResult.data.fazit,
      regelwerkCheck: regelwerkResult.data.regelwerkCheck,
      chartStruktur: chartResult.data.chartStruktur,
      konfluenzCheck: syntheseResult.data.konfluenzCheck,
      trigger: triggerResult.data,
    };

    const { data: snapshot, error: insertError } = await supabaseAdmin
      .from("system_briefings")
      .insert({
        // Provider/Modell des Synthese-Calls -- der Abschluss-Aufruf, der das
        // Fazit erzeugt. Die drei Teil-Aufrufe koennen theoretisch auf
        // unterschiedliche Fallback-Provider ausgewichen sein; das bleibt
        // ohne eigene Spalte nachvollziehbar (jeder Aufruf wirft bei
        // Fehlschlag), ist aber fuer die Anzeige nicht relevant.
        provider: syntheseResult.provider,
        model: syntheseResult.model,
        result: combined,
        status: "ok",
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { success: false, error: `Briefing erzeugt, aber Speichern fehlgeschlagen: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, snapshot });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await supabaseAdmin.from("system_briefings").insert({
      status: "error",
      error: message,
    });

    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
