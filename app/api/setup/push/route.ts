import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { evaluateSetup, type DrawingInput } from "@/lib/setupEngine";
import { hourlySpotNet } from "@/lib/spotHourly";
import { hourlyNoisePct } from "@/lib/veto";
import { fundingPctPer8h } from "@/lib/fundingLevels";
import { summarizePositioning } from "@/lib/positioning";
import { deriveMarketContext } from "@/lib/marketContext";
import { nextHighRiskWindow } from "@/lib/tradingHours";
import { dataDayLabel } from "@/lib/macroGuide";
import { sendReportPush } from "@/lib/push";
import {
  alreadyPushed,
  RISK_LABELS,
  SETUP_PUSH_KIND,
  SETUP_PUSH_LOCK_HOURS,
  setupPushMessage,
  spotDirection4h,
} from "@/lib/setupPush";
import type { Candle } from "@/lib/candles";
import type { DashboardPollBundle, SpotPressurePoint } from "@/lib/types";

// POST /api/setup/push (Toby 23.11.2026, Ausbau A)
//
// Rechnet den Setup-Rechner wie im Reiter "Trade" (lib/setupEngine.ts) und
// schickt einen Push, wenn die erste Idee "steht" und dieselbe Seite am
// selben Cluster in den letzten 6 Stunden noch nicht gemeldet wurde.
// Ausgeloest per pg_cron alle 15 Min (Job setup-push-every-15-min).
// Zwei Datenbank-Abfragen je Lauf: get_setup_inputs() und der Poll-Bundle
// (OI-Aenderung, Masse). Das Tageslimit aus dem Journal kennt nur der
// Browser; der Push nennt es deshalb nicht.
//
// Auth: proxy.ts erlaubt diese Route per CRON_SECRET-Bearer-Token
// (lib/authGate.ts SERVICE_ROLE_BEARER_PATHS).

const BUNDLE_HOURS = 4;

interface CandleRow {
  open_time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

const toCandle = (r: CandleRow): Candle => ({
  openTime: r.open_time,
  open: Number(r.open),
  high: Number(r.high),
  low: Number(r.low),
  close: Number(r.close),
  volume: r.volume === null ? undefined : Number(r.volume),
});

export async function POST() {
  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch (err) {
    return NextResponse.json({ success: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }

  const nowMs = Date.now();
  const sinceIso = new Date(nowMs - BUNDLE_HOURS * 3_600_000).toISOString();
  const [inputsRes, bundleRes] = await Promise.all([
    admin.rpc("get_setup_inputs"),
    admin.rpc("get_dashboard_poll_bundle", { p_since: sinceIso, p_max_points: 300 }),
  ]);
  if (inputsRes.error || !inputsRes.data) {
    return NextResponse.json({ success: false, error: inputsRes.error?.message ?? "Keine Eingaben" }, { status: 502 });
  }
  const x = inputsRes.data as {
    drawings: DrawingInput[];
    avwaps: { autark_id: number; vwap: number | null }[];
    anchored: { weekly_vwap?: number | null; monthly_vwap?: number | null } | null;
    candles15m: CandleRow[];
    candles1h: CandleRow[];
    spot: SpotPressurePoint[];
    funding_rate: number | null;
    events: { event_key: string; event_date: string }[];
  };
  const bundle = (bundleRes.data ?? null) as DashboardPollBundle | null;

  const candles15m = x.candles15m.map(toCandle);
  const avwaps: Record<number, number> = {};
  for (const a of x.avwaps) if (a.vwap !== null) avwaps[a.autark_id] = Number(a.vwap);
  const risk = nextHighRiskWindow(nowMs, x.events);
  const positioning = bundle
    ? summarizePositioning(
        [bundle.positioning_binance, bundle.positioning_bybit, bundle.positioning_okx, bundle.positioning_bitget],
        bundle.positioning_binance
      )
    : null;
  const oiChangePct = bundle ? deriveMarketContext(bundle, "4H", sinceIso, nowMs).oiChangePct : null;

  const { ideas } = evaluateSetup({
    price: candles15m[candles15m.length - 1]?.close ?? null,
    nowMs,
    candles15m,
    drawings: x.drawings,
    avwaps,
    weeklyVwap: x.anchored?.weekly_vwap != null ? Number(x.anchored.weekly_vwap) : null,
    monthlyVwap: x.anchored?.monthly_vwap != null ? Number(x.anchored.monthly_vwap) : null,
    spotBars: hourlySpotNet(x.spot, nowMs),
    spot4h: spotDirection4h(x.spot, nowMs),
    oiChangePct,
    fundingPct: x.funding_rate === null ? null : fundingPctPer8h(x.funding_rate),
    crowdLongPct: positioning?.crowdLongPct ?? null,
    noisePct: hourlyNoisePct(x.candles1h.map(toCandle)),
    upcomingRisk: risk ? `${RISK_LABELS[risk.id] ?? risk.id} ${risk.inMin === 0 ? "läuft jetzt" : `in ${risk.inMin} Min`}` : null,
    dataDay: dataDayLabel(nowMs, x.events),
    tradesToday: 0,
    lossesInRow: 0,
  });

  const first = ideas[0];
  const msg = setupPushMessage(first);
  const state = first ? first.verdict.short : "keine Idee";
  if (!msg) return NextResponse.json({ success: true, pushed: false, state });

  const { data: recent } = await admin
    .from("push_messages")
    .select("title")
    .eq("kind", SETUP_PUSH_KIND)
    .gte("created_at", new Date(nowMs - SETUP_PUSH_LOCK_HOURS * 3_600_000).toISOString());
  if (alreadyPushed(msg, (recent ?? []).map((r) => r.title as string))) {
    return NextResponse.json({ success: true, pushed: false, state, reason: "schon gemeldet" });
  }

  const res = await sendReportPush({ title: msg.title, body: msg.body, url: "/", kind: SETUP_PUSH_KIND, explanation: msg.explanation });
  return NextResponse.json({ success: true, pushed: res.success, state, error: res.error });
}
