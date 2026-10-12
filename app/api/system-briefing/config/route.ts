import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { MAX_BRIEFING_SCHEDULE_TIMES } from "@/lib/systemBriefingConfig";
import type { SystemBriefingConfig } from "@/lib/types";

// PATCH /api/system-briefing/config
// Body: { schedule_times?: string[] | null, email_enabled?: boolean, push_enabled?: boolean }
//
// Zeitplan und Benachrichtigungen des System-Briefings (eine Zeile,
// system_briefing_config.id = 1). Schreibt ueber den Service-Role-Client,
// da RLS nur Lesen erlaubt. Der report-scheduler (Supabase Edge Function)
// liest schedule_times alle 5 Minuten und startet das Briefing zur
// jeweiligen Uhrzeit (Schweizer Zeit, Europe/Zurich).

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(:[0-5]\d)?$/;

interface PatchBody {
  schedule_times?: string[] | null;
  email_enabled?: boolean;
  push_enabled?: boolean;
}

function badRequest(error: string) {
  return NextResponse.json({ success: false, error }, { status: 400 });
}

export async function PATCH(req: NextRequest) {
  let body: PatchBody;
  try {
    body = await req.json();
  } catch {
    return badRequest("Ungueltiges JSON im Request-Body.");
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.schedule_times !== undefined) {
    const times = body.schedule_times;
    if (times !== null) {
      if (!Array.isArray(times)) return badRequest("schedule_times muss ein Array aus HH:MM-Strings sein oder null.");
      if (times.length > MAX_BRIEFING_SCHEDULE_TIMES) {
        return badRequest(`Maximal ${MAX_BRIEFING_SCHEDULE_TIMES} Zeiten erlaubt.`);
      }
      for (const t of times) {
        if (typeof t !== "string" || !TIME_RE.test(t)) {
          return badRequest(`Ungueltige Uhrzeit "${t}" -- Format muss HH:MM sein.`);
        }
      }
      if (new Set(times).size !== times.length) return badRequest("schedule_times enthaelt doppelte Uhrzeiten.");
    }
    update.schedule_times = times === null || times.length === 0 ? null : times;
  }

  for (const key of ["email_enabled", "push_enabled"] as const) {
    if (body[key] !== undefined) {
      if (typeof body[key] !== "boolean") return badRequest(`'${key}' muss boolean sein.`);
      update[key] = body[key];
    }
  }

  if (Object.keys(update).length <= 1) return badRequest("Keine Felder zum Aktualisieren uebergeben.");

  let supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }

  const { data, error } = await supabaseAdmin
    .from("system_briefing_config")
    .update(update)
    .eq("id", 1)
    .select()
    .maybeSingle<SystemBriefingConfig>();

  if (error || !data) {
    return NextResponse.json(
      { success: false, error: error?.message ?? "system_briefing_config nicht gefunden." },
      { status: error ? 500 : 404 }
    );
  }

  return NextResponse.json({ success: true, config: data });
}
