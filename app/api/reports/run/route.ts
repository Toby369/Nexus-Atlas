import { NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildMarketContext, type FullMarketContext } from "@/lib/reportContext";
import { runReportAnalysis } from "@/lib/ai/router";
import { sendReportEmail } from "@/lib/email";
import { sendReportPush } from "@/lib/push";
import { parseTimeframe } from "@/lib/timeframes";
import { checkAndRecordRateLimit } from "@/lib/rateLimit";
import { validateReportAgainstData } from "@/lib/reportValidation";
import { FREE_TIER_REPORT_PROVIDERS } from "@/lib/ai/reportProviders";
import type { AIProviderId } from "@/lib/ai/types";
import type { ReportConfig, ReportRun, ReportType } from "@/lib/types";

// Grosszuegig genug fuer ein legitimes Durchlaufen aller 4 Slots
// nacheinander (auch mehrfach in einer Sitzung), blockiert aber Spam/
// Endlosschleifen, die echte LLM-Kosten verursachen wuerden -- daher als
// benannte, leicht anpassbare Konstanten statt einer Magic Number im Code.
const RATE_LIMIT_WINDOW_MINUTES = 10;
const RATE_LIMIT_MAX_REQUESTS = 10;
const RATE_LIMIT_ENDPOINT = "reports_run";

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
// Ist report_configs.email_enabled gesetzt, wird nach einem erfolgreichen
// Lauf zusaetzlich sendReportEmail() aufgerufen (lib/email/index.ts). Diese
// Route kennt dabei keinen konkreten Anbieter (z.B. Resend) -- ist keiner
// konfiguriert oder schlaegt der Versand fehl, bleibt der Report-Lauf selbst
// trotzdem erfolgreich; nur report_runs.email_sent bleibt dann false.
//
// 14.09.2026 -- analog dazu report_configs.push_enabled (Nutzer-Wunsch:
// "zusaetzlich zum email, eine push benachrichtigung ... frei waehlbar wie
// email!"): sendReportPush() (lib/push/index.ts) ruft dieselbe
// send-state-change-push Edge Function wie die uebrigen Push-Trigger auf,
// mit url: "/reports" -- Antippen der Benachrichtigung oeffnet die AI
// Reports Seite, wo der generierte Text (Bias/Summary) direkt unter dem
// jeweiligen Slot sichtbar ist. Ebenfalls nie blockierend fuer den
// Report-Lauf selbst; nur report_runs.push_sent bleibt dann false.

const PROMPT_PROFILE_BY_TYPE: Record<ReportType, string> = {
  market_structure: "report-market-structure",
  positioning: "report-positioning",
  news_macro: "report-news-macro",
  master: "report-master",
};

const REPORT_TYPE_LABEL: Record<ReportType, string> = {
  market_structure: "Market Structure",
  positioning: "Positioning",
  news_macro: "News / Macro",
  master: "Master",
};

// Nutzer-Feedback 14.09.2026 ("email geht schoener! oder?", Screenshot
// zeigte den rohen JSON.stringify-Dump in einem <pre>-Block): baut
// stattdessen dieselben Felder, die das Dashboard (LastRunView in
// ReportEngineDashboard.tsx) bereits anzeigt, als lesbar formatiertes
// HTML -- Bias/Confidence als farbiges Badge, Zusammenfassung als
// Fliesstext, Faktoren/Widersprueche als Liste. Alle AI-generierten
// Strings MUESSEN escapeHtml() durchlaufen: sie landen direkt im
// HTML-Body, ein von der KI (oder theoretisch injizierten Rohdaten)
// erzeugter String wie "<img src=x onerror=...>" waere sonst im
// Mail-Client als Markup interpretierbar -- der bisherige <pre>-Ansatz
// hatte dieselbe Luecke, da <pre> weiterhin HTML parst.
function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface BadgeStyle {
  bg: string;
  fg: string;
  label: string;
}

const BIAS_STYLE: Record<string, BadgeStyle> = {
  bullish: { bg: "#e7f7ee", fg: "#16a34a", label: "Bullish" },
  bearish: { bg: "#fdecec", fg: "#dc2626", label: "Bearish" },
  neutral: { bg: "#f1f2f4", fg: "#6b7280", label: "Neutral" },
  "risk-on": { bg: "#e7f7ee", fg: "#16a34a", label: "Risk-On" },
  "risk-off": { bg: "#fdecec", fg: "#dc2626", label: "Risk-Off" },
  conflicting: { bg: "#fef3e2", fg: "#d97706", label: "Widerspruechlich" },
};

const RISK_LEVEL_STYLE: Record<string, BadgeStyle> = {
  low: { bg: "#e7f7ee", fg: "#16a34a", label: "Niedrig" },
  medium: { bg: "#fef3e2", fg: "#d97706", label: "Mittel" },
  high: { bg: "#fdecec", fg: "#dc2626", label: "Hoch" },
};

function badgeHtml(style: BadgeStyle | undefined, fallbackLabel: string): string {
  const s = style ?? { bg: "#f1f2f4", fg: "#6b7280", label: fallbackLabel };
  return (
    `<span style="display:inline-block;padding:4px 12px;border-radius:999px;` +
    `background:${s.bg};color:${s.fg};font-weight:600;font-size:13px;">${escapeHtml(s.label)}</span>`
  );
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

function buildReportEmailHtml(config: ReportConfig, timeframe: string, resultData: unknown): string {
  const data = (resultData && typeof resultData === "object" ? resultData : {}) as Record<string, unknown>;
  const reportLabel = REPORT_TYPE_LABEL[config.report_type];

  const biasField =
    config.report_type === "master"
      ? typeof data.overallBias === "string"
        ? data.overallBias
        : undefined
      : typeof data.bias === "string"
        ? data.bias
        : undefined;

  const confidence = typeof data.confidence === "number" ? Math.round(data.confidence) : undefined;
  const summary = typeof data.summary === "string" ? data.summary : "";
  const keyFactors = stringArray(data.keyFactors);
  const riskLevel = typeof data.riskLevel === "string" ? data.riskLevel : undefined;
  const conflicts = stringArray(data.conflicts);
  const componentBiases =
    data.componentBiases && typeof data.componentBiases === "object"
      ? (data.componentBiases as Record<string, unknown>)
      : undefined;

  const biasSection = biasField
    ? `<div style="margin:0 0 16px;">${badgeHtml(BIAS_STYLE[biasField], biasField)}` +
      (confidence !== undefined
        ? `<span style="margin-left:10px;color:#6b7280;font-size:13px;">Confidence ${confidence}/100</span>`
        : "") +
      `</div>`
    : "";

  const summarySection = summary
    ? `<p style="font-size:15px;line-height:1.5;color:#111827;margin:0 0 16px;">${escapeHtml(summary)}</p>`
    : "";

  const conflictsSection =
    conflicts.length > 0
      ? `<div style="margin:0 0 16px;padding:12px 14px;background:#fef3e2;border-radius:8px;">` +
        `<p style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#d97706;margin:0 0 6px;font-weight:600;">Widersprueche</p>` +
        `<ul style="margin:0;padding-left:20px;color:#78350f;font-size:14px;line-height:1.6;">` +
        conflicts.map((c) => `<li>${escapeHtml(c)}</li>`).join("") +
        `</ul></div>`
      : config.report_type === "master"
        ? `<div style="margin:0 0 16px;padding:12px 14px;background:#e7f7ee;border-radius:8px;color:#16a34a;font-size:14px;">Keine Widersprueche zwischen den drei Einzelreports.</div>`
        : "";

  const componentBiasesSection = componentBiases
    ? `<div style="margin:0 0 16px;"><p style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;margin:0 0 6px;">Einzelreports</p>` +
      `<table style="width:100%;border-collapse:collapse;font-size:14px;">` +
      Object.entries(componentBiases)
        .map(
          ([k, v]) =>
            `<tr><td style="padding:4px 0;color:#6b7280;width:40%;">${escapeHtml(k)}</td>` +
            `<td style="padding:4px 0;color:#111827;">${escapeHtml(String(v))}</td></tr>`
        )
        .join("") +
      `</table></div>`
    : "";

  const riskLevelSection = riskLevel
    ? `<div style="margin:0 0 16px;">${badgeHtml(RISK_LEVEL_STYLE[riskLevel], riskLevel)} ` +
      `<span style="color:#6b7280;font-size:13px;">Risikostufe</span></div>`
    : "";

  const keyFactorsSection =
    keyFactors.length > 0
      ? `<div style="margin:0 0 16px;"><p style="font-size:12px;text-transform:uppercase;letter-spacing:0.05em;color:#9ca3af;margin:0 0 6px;">Faktoren</p>` +
        `<ul style="margin:0;padding-left:20px;color:#374151;font-size:14px;line-height:1.6;">` +
        keyFactors.map((f) => `<li>${escapeHtml(f)}</li>`).join("") +
        `</ul></div>`
      : "";

  return (
    `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;">` +
    `<div style="padding:20px 24px;background:#111827;border-radius:12px 12px 0 0;">` +
    `<p style="margin:0;color:#9ca3af;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;">NEXUS Atlas</p>` +
    `<h1 style="margin:4px 0 0;color:#fff;font-size:18px;">${escapeHtml(reportLabel)}-Report</h1>` +
    `<p style="margin:6px 0 0;color:#9ca3af;font-size:12px;">Zeitraum ${escapeHtml(timeframe)} · ${escapeHtml(config.provider)}` +
    (config.model ? ` (${escapeHtml(config.model)})` : "") +
    `</p></div>` +
    `<div style="padding:20px 24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">` +
    biasSection +
    summarySection +
    conflictsSection +
    componentBiasesSection +
    riskLevelSection +
    keyFactorsSection +
    `<p style="margin:16px 0 0;padding-top:16px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:11px;">Automatisch generiert von NEXUS Atlas · Keine Anlageberatung</p>` +
    `</div></div>`
  );
}

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

  // Rate-Limit VOR dem AI-Aufruf pruefen (nicht erst danach) -- zaehlt jeden
  // Versuch, nicht nur erfolgreiche Laeufe, und blockt so auch gezielten
  // Fehler-Spam. middleware.ts sichert bereits, dass nur eine eingeloggte
  // Session hierher kommt; dieses Limit schuetzt zusaetzlich vor
  // versehentlichen Endlosschleifen (z.B. ein haengender Client-Retry).
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
      // 14.09.2026 -- Bugfix (Nutzer-Report: mistral HTTP 429 liess den
      // gesamten Report-Lauf ohne jeden Fallback scheitern): vorher wurde
      // hier gar keine fallbackProviders-Kette uebergeben, obwohl
      // runReportAnalysis() sie unterstuetzt. Faellt der vom Nutzer
      // gewaehlte Provider aus (Rate-Limit, Ausfall), springt die Kette auf
      // die uebrigen Gratis-Tier-Provider -- bleibt damit im Rahmen von
      // "muss kostenlos sein, gesamte AI report!" (lib/ai/reportProviders.ts).
      fallbackProviders: FREE_TIER_REPORT_PROVIDERS,
    });

    // Fact-Checker (Phase 2, Punkt 1): prueft die AI-Kernaussagen gegen die
    // Rohdaten, die IM SELBEN Request-Kontext an das Modell gingen -- vor
    // dem Insert, damit report_runs von Anfang an den Validierungsstatus
    // traegt statt ihn nachtraeglich per Update anzuflicken.
    const validation = validateReportAgainstData(result.data, contextPayload);

    const { data: run, error: insertError } = await supabaseAdmin
      .from("report_runs")
      .insert({
        report_config_id: config.id,
        report_type: config.report_type,
        provider: result.provider,
        model: result.model,
        timeframe,
        validation_status: validation.status,
        validation_notes: validation.contradictions.length > 0 ? validation.contradictions : null,
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

    if (config.email_enabled) {
      const to = process.env.REPORT_EMAIL_TO;
      if (!to) {
        console.warn(
          `Report-Slot ${slot}: email_enabled ist an, aber REPORT_EMAIL_TO ist nicht gesetzt -- Versand uebersprungen.`
        );
      } else {
        const emailResult = await sendReportEmail({
          to,
          subject: `NEXUS Atlas · ${REPORT_TYPE_LABEL[config.report_type]} (${timeframe})`,
          html: buildReportEmailHtml(config, timeframe, result.data),
        });

        if (!emailResult.attempted) {
          console.warn(`Report-Slot ${slot}: kein E-Mail-Provider konfiguriert, Versand uebersprungen.`);
        } else if (!emailResult.success) {
          console.error(`Report-Slot ${slot}: E-Mail-Versand fehlgeschlagen: ${emailResult.error}`);
        } else {
          const { error: emailUpdateError } = await supabaseAdmin
            .from("report_runs")
            .update({ email_sent: true })
            .eq("id", run.id);
          if (emailUpdateError) {
            console.error(
              `Report-Slot ${slot}: E-Mail versendet, aber email_sent-Flag konnte nicht gesetzt werden: ${emailUpdateError.message}`
            );
          } else {
            run.email_sent = true;
          }
        }
      }
    }

    if (config.push_enabled) {
      const summary = (result.data as { summary?: string } | undefined)?.summary;
      const pushResult = await sendReportPush({
        title: `NEXUS Atlas · ${REPORT_TYPE_LABEL[config.report_type]}-Report`,
        body: summary && summary.length > 0 ? summary : "Neuer Report verfuegbar.",
        // 14.09.2026 -- Deep-Link direkt zum Slot (statt nur "/reports"):
        // Nutzer-Report "moechte diese generierte nachricht lesen koennen",
        // die Reports-Seite scrollt beim Laden per Anchor automatisch zur
        // richtigen Kachel (siehe id={`slot-${config.slot}`} in
        // ReportEngineDashboard.tsx), kein manuelles Suchen unter 4 Slots.
        url: `/reports#slot-${config.slot}`,
      });

      if (!pushResult.attempted) {
        console.warn(`Report-Slot ${slot}: Push konnte nicht versucht werden: ${pushResult.error}`);
      } else if (!pushResult.success) {
        console.error(`Report-Slot ${slot}: Push-Versand fehlgeschlagen: ${pushResult.error}`);
      } else {
        const { error: pushUpdateError } = await supabaseAdmin
          .from("report_runs")
          .update({ push_sent: true })
          .eq("id", run.id);
        if (pushUpdateError) {
          console.error(
            `Report-Slot ${slot}: Push versendet, aber push_sent-Flag konnte nicht gesetzt werden: ${pushUpdateError.message}`
          );
        } else {
          run.push_sent = true;
        }
      }
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
