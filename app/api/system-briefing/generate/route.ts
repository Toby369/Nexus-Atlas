import { NextResponse, type NextRequest } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import {
  buildSystemBriefingContext,
  sliceForRegelwerk,
  sliceForChartStruktur,
  sliceForTrigger,
  sliceForSynthese,
  type PreviousBriefing,
} from "@/lib/systemBriefingContext";
import { notifyBriefing } from "@/lib/systemBriefingNotify";
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
// Login-Session -- keine eigene Pruefung noetig. Ausnahme: der
// report-scheduler (Supabase Edge Function) ruft sie zu den Uhrzeiten aus
// system_briefing_config mit CRON_SECRET auf (lib/authGate.ts). Nur diese
// geplanten Laeufe verschicken E-Mail/Push -- ein Klick auf "Neu generieren"
// zeigt das Ergebnis ohnehin direkt an.
//
// Seit der Zusammenlegung mit dem Master-Report der AI Report Engine
// vergleicht die Synthese zusaetzlich mit dem vorherigen Lauf
// (aenderungSeitLetztem).
//
// Aufbau: drei kleine, unabhaengige Teil-Aufrufe
// PARALLEL (Regelwerk-Check, Chart-Struktur, Trigger & Szenario), danach EIN
// kleiner Synthese-Call, der nur die drei Ergebnisse verdichtet -- siehe
// lib/ai/promptProfiles.ts ("system-briefing-*") und
// lib/systemBriefingContext.ts (sliceFor*). Die gespeicherte
// SystemBriefingResult-Form ist unveraendert.
//
// Warum so: ein einzelner grosser Aufruf riss bei jedem Versuch Vercels
// 60s-Limit (Hobby-Plan). Vier SEQUENZIELLE Aufrufe rissen es ebenfalls
// (clientseitig "Failed to fetch" -- Vercel killt die Funktion, bevor sie
// antworten kann). Daher parallel; Provider-Wahl je Teil siehe
// lib/ai/tileConfig.ts.
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

type SyntheseResult = Pick<
  SystemBriefingResult,
  "fazit" | "konfluenzCheck" | "schlagzeile" | "marktupdate" | "momentum" | "liquidationen" | "etfFlows" | "wirtschaftskalender"
> & { aenderungSeitLetztem?: string | null };

async function getPreviousBriefing(
  supabaseAdmin: ReturnType<typeof getSupabaseAdmin>
): Promise<PreviousBriefing | null> {
  const { data } = await supabaseAdmin
    .from("system_briefings")
    .select("generated_at, result")
    .eq("status", "ok")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const fazit = (data?.result as SystemBriefingResult | null)?.fazit;
  if (!data || !fazit?.kernaussage) return null;
  return {
    generated_at: data.generated_at,
    bias: fazit.bias,
    confidence: fazit.confidence,
    kernaussage: fazit.kernaussage,
  };
}

export async function POST(req: NextRequest) {
  // proxy.ts hat den Bearer bereits geprueft; hier nur unterscheiden, ob
  // der Lauf geplant (Scheduler) oder per Klick ausgeloest wurde.
  const cronSecret = process.env.CRON_SECRET;
  const isScheduled = !!cronSecret && req.headers.get("authorization") === `Bearer ${cronSecret}`;

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
    const [context, previousBriefing] = await Promise.all([
      buildSystemBriefingContext(),
      getPreviousBriefing(supabaseAdmin),
    ]);

    // Drei fokussierte, voneinander unabhaengige Teil-Aufrufe PARALLEL --
    // jeder bekommt nur seinen eigenen Daten-Ausschnitt (sliceFor*), daher
    // deutlich kleinerer Prompt je Call als vorher der eine grosse. Bewusst
    // Promise.all (nicht nacheinander, siehe Datei-Kopfkommentar fuer den
    // Vorfall mit der sequenziellen Zwischenversion).
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
    // Konfluenz-Check und vergleicht mit dem vorherigen Lauf -- bekommt KEINE
    // Rohdaten mehr (ausser dem kleinen Abgleichs-Schnitt in sliceForSynthese).
    const syntheseResult = await runTileAnalysis<SyntheseResult>("system-briefing-synthese", {
      context: JSON.stringify(
        sliceForSynthese(context, {
          regelwerkCheck: regelwerkResult.data,
          chartStruktur: chartResult.data,
          trigger: triggerResult.data,
        }, previousBriefing)
      ),
    });

    const combined: SystemBriefingResult = {
      fazit: syntheseResult.data.fazit,
      regelwerkCheck: regelwerkResult.data.regelwerkCheck,
      chartStruktur: chartResult.data.chartStruktur,
      konfluenzCheck: syntheseResult.data.konfluenzCheck,
      trigger: triggerResult.data,
      aenderungSeitLetztem: previousBriefing ? (syntheseResult.data.aenderungSeitLetztem ?? null) : null,
      schlagzeile: syntheseResult.data.schlagzeile,
      marktupdate: syntheseResult.data.marktupdate,
      momentum: syntheseResult.data.momentum,
      liquidationen: syntheseResult.data.liquidationen,
      etfFlows: syntheseResult.data.etfFlows,
      wirtschaftskalender: syntheseResult.data.wirtschaftskalender,
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

    if (isScheduled) {
      const { data: config } = await supabaseAdmin
        .from("system_briefing_config")
        .select("email_enabled, push_enabled")
        .eq("id", 1)
        .maybeSingle();
      if (config && (config.email_enabled || config.push_enabled)) {
        const { emailSent, pushSent } = await notifyBriefing(combined, config, {
          kurs: context.btc_markt.kurs_usd,
          levels: context.keyLevels,
        });
        if (emailSent || pushSent) {
          const { error: flagError } = await supabaseAdmin
            .from("system_briefings")
            .update({ email_sent: emailSent, push_sent: pushSent })
            .eq("id", snapshot.id);
          if (flagError) console.error(`System-Briefing: Versand-Flags nicht gesetzt: ${flagError.message}`);
        }
      }
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
