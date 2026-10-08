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
// Umsetzungsplan Phase 4 (18.09.2026): erzeugt einen neuen System-Briefing-
// Snapshot (lib/systemBriefingContext.ts -> runTileAnalysis() -> Speichern in
// system_briefings). 1:1 dasselbe Prinzip wie bei den anderen manuell
// ausgeloesten KI-Kacheln -- nur ein expliziter Klick loest einen bezahlten
// AI-Aufruf aus, das Lesen der Kachel liest ausschliesslich den
// zwischengespeicherten letzten Stand.
//
// Auth: proxy.ts sperrt diese Route wie jede andere /api/*-Route hinter eine
// Login-Session -- keine eigene Pruefung noetig.
//
// 08.10.2026 -- struktureller Umbau (Nutzer-Beobachtung "sollten Master-
// Report und System-Briefing nicht effizienter laufen, 3 verschiedene KI-
// Aufrufe nutzen?"): vorher EIN grosser runTileAnalysis()-Aufruf mit allen
// fuenf Abschnitten. Nach der Zusammenlegung mit Chart-Narrativ (06.10.2026)
// riss dieser EINE Aufruf die Route bei jedem Versuch exakt bei Vercels
// 60s-Limit (Hobby-Plan) ab; reines Kuerzen des Prompts (07.10.2026) war nur
// ein Pflaster. Jetzt wie die AI Report Engine (report-market-structure/
// positioning/news-macro + report-master): drei kleine, unabhaengige
// Teil-Aufrufe PARALLEL (Regelwerk-Check, Chart-Struktur, Trigger&Szenario),
// danach EIN kleiner Synthese-Call, der nur die drei Teil-Ergebnisse
// verdichtet (keine Rohdaten erneut) -- siehe lib/ai/promptProfiles.ts
// ("system-briefing-*") und lib/systemBriefingContext.ts (sliceFor*). Die
// gespeicherte SystemBriefingResult-Form bleibt exakt gleich, die Kachel
// merkt vom Split nichts.
export const maxDuration = 60;

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

  try {
    const context = await buildSystemBriefingContext();

    // Drei fokussierte, voneinander unabhaengige Teil-Aufrufe parallel --
    // jeder bekommt nur seinen eigenen Daten-Ausschnitt (sliceFor*), daher
    // deutlich kleinerer Prompt je Call als vorher der eine grosse.
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
