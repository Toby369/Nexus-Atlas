import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildMarketContext, type FullMarketContext } from "@/lib/reportContext";
import { runReportAnalysis } from "@/lib/ai/router";
import { parseTimeframe } from "@/lib/timeframes";
import type { AIProviderId } from "@/lib/ai/types";
import type { ReportConfig, ReportRun, ReportType } from "@/lib/types";

// POST /api/reports/run
// Body: { slot: 1 | 2 | 3 | 4 }
//
// Fuehrt genau einen Report-Slot aus der report_configs-Tabelle aus: baut
// den strukturierten Marktkontext (lib/reportContext.ts), ruft den fuer
// diesen Slot konfigurierten AI-Provider ueber runReportAnalysis() auf und
// schreibt das Ergebnis (oder den Fehler) als neue Zeile in report_runs --
// jeder Lauf bleibt so nachvollziehbar (Vorgabe Teil P).
//
// Master (Report 4) fasst NICHT frisch alles zusammen, sondern liest die
// zuletzt erfolgreichen Laeufe der Reports 1-3 aus report_runs. Existiert
// noch kein erfolgreicher Lauf fuer einen der drei, wird bewusst NICHT
// automatisch nachgetriggert (das wuerde unbemerkt zusaetzliche
// Free-Tier-Anfragen ausloesen) -- stattdessen ein klarer Fehler.
//
// E-Mail-Versand (report_configs.email_enabled) ist hier noch nicht
// verdrahtet -- das ist eine spaetere Etappe (E-Mail-Service-Abstraktion).

const PROMPT_PROFILE_BY_TYPE: Record<ReportType, string> = {
  market_structure: "report-market-structure",
  positioning: "report-positioning",
  news_macro: "report-news-macro",
  master: "report-master",
};

function sliceContextForMarketStructure(ctx: FullMarketContext) {
  const { timeframe, generated_at, btc_price, oi, funding, liquidations, spot_pressure, exchange_comparison, assessment, data_quality } = ctx;
  return { timeframe, generated_at, btc_price, oi, funding, liquidations, spot_pressure, exchange_comparison, assessment, data_quality };
}

function sliceContextForPositioning(ctx: FullMarketContext) {
  const { timeframe, generated_at, positioning, oi, spot_pressure, liquidations, data_quality } = ctx;
  return { timeframe, generated_at, positioning, oi, spot_pressure, liquidations, data_quality };
}

function sliceContextForNewsMacro(ctx: FullMarketContext) {
  const { timeframe, generated_at, news_macro, etf_flows, data_quality } = ctx;
  return { timeframe, generated_at, news_macro, etf_flows, data_quality };
}

async function getLatestSuccessfulRun(reportType: ReportType): Promise<ReportRun | null> {
  const { data, error } = await supabase
    .from("report_runs")
    .select("*")
    .eq("report_type", reportType)
    .eq("status", "ok")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error(`Fehler beim Laden des letzten ${reportType}-Laufs:`, error.message);
    return null;
  }
  return data;
}

export async function POST(req: NextRequest) {
  let body: { slot?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Ungueltiges JSON im Request-Body." }, { status: 400 });
  }

  const slot = body.slot;
  if (typeof slot !== "number" || slot < 1 || slot > 4) {
    return NextResponse.json({ success: false, error: "Feld 'slot' muss 1-4 sein." }, { status: 400 });
  }

  const { data: config, error: configError } = await supabase
    .from("report_configs")
    .select("*")
    .eq("slot", slot)
    .maybeSingle<ReportConfig>();

  if (configError || !config) {
    return NextResponse.json(
      { success: false, error: `Keine Konfiguration fuer Slot ${slot} gefunden.` },
      { status: 404 }
    );
  }

  const timeframe = parseTimeframe(config.timeframe);
  const providerId = config.provider as AIProviderId;
  const promptProfile = PROMPT_PROFILE_BY_TYPE[config.report_type];

  // Fruehzeitig aufloesen (statt erst beim Schreiben) -- fehlt der Service-
  // Role-Key, soll das ein klarer 500 sein, bevor ueberhaupt ein AI-Provider
  // (und damit Free-Tier-Kontingent) verbraucht wird.
  let supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }

  let fullContext: FullMarketContext;
  try {
    fullContext = await buildMarketContext(timeframe);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: `Fehler beim Aufbau des Marktkontexts: ${message}` },
      { status: 500 }
    );
  }

  let contextPayload: unknown;

  if (config.report_type === "master") {
    const [marketStructureRun, positioningRun, newsMacroRun] = await Promise.all([
      getLatestSuccessfulRun("market_structure"),
      getLatestSuccessfulRun("positioning"),
      getLatestSuccessfulRun("news_macro"),
    ]);

    const missing = [
      !marketStructureRun && "Market Structure",
      !positioningRun && "Positioning",
      !newsMacroRun && "News/Macro",
    ].filter((v): v is string => Boolean(v));

    if (missing.length > 0) {
      return NextResponse.json(
        {
          success: false,
          error:
            `Master-Report benoetigt mindestens einen erfolgreichen vorherigen Lauf von: ` +
            `${missing.join(", ")}. Bitte diese Reports zuerst ausfuehren.`,
        },
        { status: 409 }
      );
    }

    contextPayload = {
      timeframe: fullContext.timeframe,
      generated_at: fullContext.generated_at,
      marketStructureReport: {
        result: marketStructureRun!.result,
        generated_at: marketStructureRun!.generated_at,
        provider: marketStructureRun!.provider,
      },
      positioningReport: {
        result: positioningRun!.result,
        generated_at: positioningRun!.generated_at,
        provider: positioningRun!.provider,
      },
      newsMacroReport: {
        result: newsMacroRun!.result,
        generated_at: newsMacroRun!.generated_at,
        provider: newsMacroRun!.provider,
      },
      marketData: {
        btc_price: fullContext.btc_price,
        oi: fullContext.oi,
        funding: fullContext.funding,
        spot_pressure: fullContext.spot_pressure,
      },
      assessment: fullContext.assessment,
      data_quality: fullContext.data_quality,
    };
  } else if (config.report_type === "market_structure") {
    contextPayload = sliceContextForMarketStructure(fullContext);
  } else if (config.report_type === "positioning") {
    contextPayload = sliceContextForPositioning(fullContext);
  } else {
    contextPayload = sliceContextForNewsMacro(fullContext);
  }

  try {
    const result = await runReportAnalysis({
      providerId,
      model: config.model ?? undefined,
      promptProfile,
      context: JSON.stringify(contextPayload),
    });

    const { data: run, error: insertError } = await supabaseAdmin
      .from("report_runs")
      .insert({
        report_config_id: config.id,
        report_type: config.report_type,
        provider: result.provider,
        model: result.model,
        timeframe,
        status: "ok",
        result: result.data as Record<string, unknown>,
        data_snapshot: contextPayload as Record<string, unknown>,
      })
      .select()
      .single();

    if (insertError) {
      return NextResponse.json(
        { success: false, error: `Report erfolgreich, aber Speichern fehlgeschlagen: ${insertError.message}` },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, run });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    await supabaseAdmin.from("report_runs").insert({
      report_config_id: config.id,
      report_type: config.report_type,
      provider: providerId,
      model: config.model,
      timeframe,
      status: "error",
      data_snapshot: contextPayload as Record<string, unknown>,
      error: message,
    });

    return NextResponse.json({ success: false, error: message }, { status: 502 });
  }
}
