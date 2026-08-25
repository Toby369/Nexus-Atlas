import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { providerRegistry } from "@/lib/ai/providers";
import { isTimeframeId } from "@/lib/timeframes";
import type { AIProviderId } from "@/lib/ai/types";
import type { ReportConfig } from "@/lib/types";

// PATCH /api/reports/config
// Body: { slot: 1-4, provider?, model?, timeframe?, schedule_time?, active?, email_enabled? }
//
// Aendert NUR die Nutzer-Konfiguration eines bestehenden Slots. report_type
// bleibt fix (Slot 1-4 sind gemaess Vorgabe Teil N fest den 4 Report-Typen
// zugeordnet, siehe Seed-Daten der report_configs-Tabelle) -- diese Route
// aendert ihn daher bewusst nicht. Schreibt ueber den Service-Role-Client,
// da RLS auf report_configs nur "Public read access" (SELECT) erlaubt
// (Vorgabe Teil V: Schreibzugriff ausschliesslich serverseitig).

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

interface PatchBody {
  slot?: number;
  provider?: string;
  model?: string | null;
  timeframe?: string;
  schedule_time?: string | null;
  active?: boolean;
  email_enabled?: boolean;
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
    update.provider = body.provider as AIProviderId;
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

  if (body.schedule_time !== undefined) {
    if (body.schedule_time !== null && !TIME_RE.test(body.schedule_time)) {
      return NextResponse.json(
        { success: false, error: "schedule_time muss HH:MM sein oder null." },
        { status: 400 }
      );
    }
    update.schedule_time = body.schedule_time;
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
