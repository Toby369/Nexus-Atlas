import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { providerRegistry } from "@/lib/ai/providers";
import { isFreeTierReportProvider, FREE_TIER_REPORT_PROVIDERS } from "@/lib/ai/reportProviders";
import { isTimeframeId } from "@/lib/timeframes";
import type { ReportConfig } from "@/lib/types";

// PATCH /api/reports/config
// Body: { slot: 1-4, provider?, model?, timeframe?, schedule_times?, active?, email_enabled?, push_enabled? }
//
// Aendert NUR die Nutzer-Konfiguration eines bestehenden Slots. report_type
// bleibt fix (Slot 1-4 sind gemaess Vorgabe Teil N fest den 4 Report-Typen
// zugeordnet, siehe Seed-Daten der report_configs-Tabelle) -- diese Route
// aendert ihn daher bewusst nicht. Schreibt ueber den Service-Role-Client,
// da RLS auf report_configs nur "Public read access" (SELECT) erlaubt
// (Vorgabe Teil V: Schreibzugriff ausschliesslich serverseitig).
//
// 14.09.2026 -- schedule_time (einzelner Wert) durch schedule_times (Array,
// max. 5, siehe MAX_SCHEDULE_TIMES -- urspruenglich 3 ("bis zu 3 Zeiten
// planen"), auf Nutzer-Nachfrage "kann der auf 5 erhoeht werden?" noch am
// selben Tag erhoeht, DB-Constraint report_configs_schedule_times_max5
// synchron angepasst) ersetzt, und provider serverseitig auf Gratis-Tier-
// Provider beschraenkt ("muss kostenlos sein, gesamte AI report!", siehe
// lib/ai/reportProviders.ts) -- nicht nur in der UI ausgeblendet, da diese
// Route auch direkt (ohne Dashboard) aufrufbar ist.

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;
const MAX_SCHEDULE_TIMES = 5;

interface PatchBody {
  slot?: number;
  provider?: string;
  model?: string | null;
  timeframe?: string;
  schedule_times?: string[] | null;
  active?: boolean;
  email_enabled?: boolean;
  push_enabled?: boolean;
}

export async function PATCH(req: NextRequest) {
  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ success: false, error: "Ungueltiges JSON im Request-Body." }, { status: 400 });
  }

  const slot = body.slot;
  if (typeof slot !== "number" || slot < 1 || slot > 4) {
    return NextResponse.json({ success: false, error: "Feld 'slot' muss 1-4 sein." }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.provider !== undefined) {
    if (!(body.provider in providerRegistry)) {
      return NextResponse.json(
        { success: false, error: `Unbekannter Provider: ${body.provider}` },
        { status: 400 }
      );
    }
    if (!isFreeTierReportProvider(body.provider)) {
      return NextResponse.json(
        {
          success: false,
          error:
            `Provider "${body.provider}" hat keinen Gratis-Tier -- die AI Report Engine erlaubt ` +
            `nur: ${FREE_TIER_REPORT_PROVIDERS.join(", ")}.`,
        },
        { status: 400 }
      );
    }
    update.provider = body.provider;
  }

  if (body.model !== undefined) {
    update.model = body.model === "" ? null : body.model;
  }

  if (body.timeframe !== undefined) {
    if (!isTimeframeId(body.timeframe)) {
      return NextResponse.json(
        { success: false, error: `Unbekannter Zeitraum: ${body.timeframe}` },
        { status: 400 }
      );
    }
    update.timeframe = body.timeframe;
  }

  if (body.schedule_times !== undefined) {
    if (body.schedule_times !== null) {
      if (!Array.isArray(body.schedule_times)) {
        return NextResponse.json(
          { success: false, error: "schedule_times muss ein Array aus HH:MM-Strings sein oder null." },
          { status: 400 }
        );
      }
      if (body.schedule_times.length > MAX_SCHEDULE_TIMES) {
        return NextResponse.json(
          { success: false, error: `Maximal ${MAX_SCHEDULE_TIMES} Zeiten pro Report erlaubt.` },
          { status: 400 }
        );
      }
      for (const t of body.schedule_times) {
        if (typeof t !== "string" || !TIME_RE.test(t)) {
          return NextResponse.json(
            { success: false, error: `Ungueltige Uhrzeit "${t}" -- Format muss HH:MM sein.` },
            { status: 400 }
          );
        }
      }
      const unique = new Set(body.schedule_times);
      if (unique.size !== body.schedule_times.length) {
        return NextResponse.json(
          { success: false, error: "schedule_times enthaelt doppelte Uhrzeiten." },
          { status: 400 }
        );
      }
    }
    update.schedule_times =
      body.schedule_times === null || body.schedule_times.length === 0 ? null : body.schedule_times;
  }

  if (body.active !== undefined) {
    if (typeof body.active !== "boolean") {
      return NextResponse.json({ success: false, error: "'active' muss boolean sein." }, { status: 400 });
    }
    update.active = body.active;
  }

  if (body.email_enabled !== undefined) {
    if (typeof body.email_enabled !== "boolean") {
      return NextResponse.json(
        { success: false, error: "'email_enabled' muss boolean sein." },
        { status: 400 }
      );
    }
    update.email_enabled = body.email_enabled;
  }

  if (body.push_enabled !== undefined) {
    if (typeof body.push_enabled !== "boolean") {
      return NextResponse.json(
        { success: false, error: "'push_enabled' muss boolean sein." },
        { status: 400 }
      );
    }
    update.push_enabled = body.push_enabled;
  }

  if (Object.keys(update).length <= 1) {
    return NextResponse.json(
      { success: false, error: "Keine Felder zum Aktualisieren uebergeben." },
      { status: 400 }
    );
  }

  let supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin
    .from("report_configs")
    .update(update)
    .eq("slot", slot)
    .select()
    .maybeSingle<ReportConfig>();

  if (error || !data) {
    return NextResponse.json(
      { success: false, error: error?.message ?? `Slot ${slot} nicht gefunden.` },
      { status: error ? 500 : 404 }
    );
  }

  return NextResponse.json({ success: true, config: data });
}
