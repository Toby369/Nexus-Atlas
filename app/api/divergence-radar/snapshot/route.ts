import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { buildDivergenceRadar } from "@/lib/divergenceRadarContext";

// POST /api/divergence-radar/snapshot
//
// Periodischer KI-Rueckblick, Phase 5 (10.09.2026) -- persistiert einen
// Snapshot des bereits bestehenden, live berechneten Divergenz-Radars
// (lib/divergenceRadarContext.ts::buildDivergenceRadar) nach
// divergence_radar_snapshots. Kein AI-Aufruf, keine Kosten -- rein
// regelbasierte Momentaufnahme, damit spaeter eine Historie fuer
// signal_outcomes-Detection existiert (der Radar wurde bisher nur live
// fuer die Dashboard-Anzeige berechnet, nie gespeichert). Ausgeloest vom
// divergence-radar-scheduler-Cron alle 15 Minuten, gleiches Muster wie
// /api/signal-review/generate.
//
// Auth: proxy.ts erlaubt diese Route per CRON_SECRET-Bearer-Token
// (Server-zu-Server, siehe lib/authGate.ts SERVICE_ROLE_BEARER_PATHS) --
// keine eigene Pruefung noetig.

export async function POST() {
  let supabaseAdmin: ReturnType<typeof getSupabaseAdmin>;
  try {
    supabaseAdmin = getSupabaseAdmin();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }

  let radar: Awaited<ReturnType<typeof buildDivergenceRadar>>;
  try {
    radar = await buildDivergenceRadar();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ success: false, error: `Divergenz-Radar-Berechnung fehlgeschlagen: ${message}` }, { status: 502 });
  }

  const { error: insertError } = await supabaseAdmin.from("divergence_radar_snapshots").insert({
    price: radar.price,
    overall_state: radar.overallState,
    options_vs_sentiment: radar.optionsVsSentiment,
    spot_vs_futures: radar.spotVsFutures,
    spot_pressure_vs_price: radar.spotPressureVsPrice,
    cycle_vs_momentum: radar.cycleVsMomentum,
    cycle_band_label: radar.cycleBandLabel,
    handelslage_vs_state: radar.handelslageVsState,
    handelslage_bias: radar.handelslageBias ?? null,
    tradingview_vs_state: radar.tradingViewVsState,
    tv_direction: radar.tvDirection,
    rsi_divergence_vs_trend: radar.rsiDivergenceVsTrend,
    rsi_macd_divergence_direction: radar.rsiMacdDivergenceDirection,
    onchain_vs_price: radar.onchainVsPrice,
  });

  if (insertError) {
    return NextResponse.json({ success: false, error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
