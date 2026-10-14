import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { runTileAnalysis } from "@/lib/ai/router";
import { AWAITING_MAX_MS, EVENT_TIME_ET, economicEventMarkMs, formatZurichTime } from "@/lib/economicCalendar";
import {
  headlinesReady,
  matchResultHeadlines,
  type EconomicEventResult,
  type EconomicResultBias,
  type ResultHeadline,
} from "@/lib/economicEventResult";

// POST /api/economic-result/generate
//
// Prueft alle verfolgten Wirtschaftstermine, deren Veroeffentlichung hoechstens
// 6h zurueckliegt und fuer die noch keine Einordnung gespeichert ist. Liegen
// passende Schlagzeilen vor (lib/economicEventResult.ts), schreibt die KI
// 1-2 Saetze + bullish/bearish und speichert sie in economic_event_results.
// Ohne Schlagzeilen: kein KI-Aufruf, nur DB-Reads.
//
// Aufrufer: send-state-change-push (alle 15 Min, CRON_SECRET -- siehe
// lib/authGate.ts) fuer die Push-Meldung, und das Lagebild
// (EconomicHeroBadge, Nutzer-Session), solange das Ergebnis aussteht.

export async function POST() {
  let supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }

  const nowMs = Date.now();
  const yesterdayIso = new Date(nowMs - 24 * 60 * 60_000).toISOString().slice(0, 10);
  const todayIso = new Date(nowMs).toISOString().slice(0, 10);

  const { data: events, error: eventsError } = await supabaseAdmin
    .from("economic_calendar_events")
    .select("event_key, label, event_date")
    .in("event_key", Object.keys(EVENT_TIME_ET))
    .gte("event_date", yesterdayIso)
    .lte("event_date", todayIso);
  if (eventsError) {
    return NextResponse.json({ success: false, error: eventsError.message }, { status: 500 });
  }

  const due = (events ?? []).flatMap((e: { event_key: string; label: string; event_date: string }) => {
    const markMs = economicEventMarkMs(e.event_key, e.event_date);
    return markMs !== null && nowMs >= markMs && nowMs - markMs <= AWAITING_MAX_MS ? [{ ...e, markMs }] : [];
  });

  const results: EconomicEventResult[] = [];
  const errors: string[] = [];

  for (const event of due) {
    const { data: existing } = await supabaseAdmin
      .from("economic_event_results")
      .select("event_key, event_date, bias, summary, created_at")
      .eq("event_key", event.event_key)
      .eq("event_date", event.event_date)
      .maybeSingle();
    if (existing) {
      results.push(existing as EconomicEventResult);
      continue;
    }

    const { data: news } = await supabaseAdmin
      .from("news_events")
      .select("published_at, title, title_de")
      .gte("published_at", new Date(event.markMs).toISOString())
      .order("published_at", { ascending: true })
      .limit(200);
    const headlines = matchResultHeadlines(event.event_key, (news ?? []) as ResultHeadline[], event.markMs);
    if (!headlinesReady(headlines, nowMs)) continue;

    try {
      const analysis = await runTileAnalysis<{ bias: EconomicResultBias; summary: string }>("economic-event-result", {
        context: JSON.stringify({
          event: { label: event.label, zeit_schweiz: formatZurichTime(event.markMs) },
          headlines: headlines.map((h) => ({
            zeit_schweiz: formatZurichTime(new Date(h.published_at).getTime()),
            titel: h.title_de ?? h.title,
          })),
        }),
      });
      // ignoreDuplicates: laufen Push-Cron und Lagebild gleichzeitig, gewinnt
      // der erste Eintrag; danach wird der gespeicherte gelesen.
      await supabaseAdmin.from("economic_event_results").upsert(
        {
          event_key: event.event_key,
          event_date: event.event_date,
          bias: analysis.data.bias,
          summary: analysis.data.summary.trim(),
          headlines,
          provider: analysis.provider,
          model: analysis.model,
        },
        { onConflict: "event_key,event_date", ignoreDuplicates: true }
      );
      const { data: stored } = await supabaseAdmin
        .from("economic_event_results")
        .select("event_key, event_date, bias, summary, created_at")
        .eq("event_key", event.event_key)
        .eq("event_date", event.event_date)
        .maybeSingle();
      if (stored) results.push(stored as EconomicEventResult);
    } catch (err) {
      errors.push(`${event.event_key} ${event.event_date}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (errors.length > 0) {
    console.error("economic-result/generate:", errors.join(" | "));
  }
  return NextResponse.json({ success: errors.length === 0, results, error: errors.join(" | ") || undefined });
}
