"use client";

import { useEffect, useState } from "react";
import StepCard from "@/components/StepCard";
import { useLivePriceData } from "@/components/LivePriceDataProvider";
import { useDashboardPoll } from "@/components/DashboardPollProvider";
import { useTradeStatus, type DecisionProps } from "@/components/TradeStepCards";
import { supabase } from "@/lib/supabase";
import { setVisibleInterval } from "@/lib/visibleInterval";
import { deriveMarketContext } from "@/lib/marketContext";
import { hourlySpotNet, SPOT_HOURS } from "@/lib/spotHourly";
import { evaluateSetup, MAX_POINTS, SETUP_MIN_POINTS, type DrawingInput, type SetupIdea } from "@/lib/setupEngine";
import { setupInfo } from "@/lib/panelInfo";
import type { Candle } from "@/lib/candles";
import type { SpotPressurePoint } from "@/lib/types";

// Setup-Rechner (Toby 22.11.2026): ersetzt im Reiter "Trade" den Regelcheck.
// Rechnung in lib/setupEngine.ts; hier nur Daten laden und anzeigen.
// Daten, die nur diese Karte braucht (Zeichnungen, AVWAP, 300 15m-Kerzen,
// Spot je Stunde, Wochen-/Monats-VWAP), laedt EIN gemeinsamer Cache fuer
// Karte und Kopf-Zeile, alle 5 Minuten und nur bei sichtbarer Seite.

interface SetupData {
  drawings: DrawingInput[];
  avwaps: Record<number, number>;
  weeklyVwap: number | null;
  monthlyVwap: number | null;
  candles15m: Candle[];
  spotPoints: SpotPressurePoint[];
  loadedAt: number;
}

const REFRESH_MS = 5 * 60_000;
const CANDLES_15M = 300;
let cache: SetupData | null = null;
let inflight: Promise<SetupData | null> | null = null;
const listeners = new Set<(d: SetupData) => void>();

async function loadSetupData(): Promise<SetupData | null> {
  const now = Date.now();
  const since = new Date(now - SPOT_HOURS * 3_600_000).toISOString();
  const [drawRes, summaryRes, candleRes, spotRes] = await Promise.all([
    supabase.from("autark_drawings").select("autark_id, kind, label, points"),
    supabase.rpc("get_anchored_vwap_summary"),
    supabase
      .from("candles")
      .select("open_time, open, high, low, close, volume")
      .eq("exchange", "binance")
      .eq("symbol", "BTCUSDT")
      .eq("interval", "15m")
      .order("open_time", { ascending: false })
      .limit(CANDLES_15M + 1),
    supabase.rpc("get_spot_pressure_series", { p_since: since, p_max_points: 300 }),
  ]);
  if (drawRes.error || candleRes.error) return null;
  const drawings = (drawRes.data ?? []) as DrawingInput[];
  const anchors = drawings.filter((d) => d.kind === "avwap" && d.points[0]).map((d) => ({ id: d.autark_id, t: d.points[0].t }));
  const avwaps: Record<number, number> = {};
  if (anchors.length > 0) {
    const { data } = await supabase.rpc("get_anchored_vwaps", {
      p_anchors: anchors.map((a) => new Date(a.t).toISOString()),
    });
    for (const row of (data ?? []) as { anchor: string; vwap: number | null }[]) {
      const ms = Date.parse(row.anchor);
      for (const a of anchors) if (Math.abs(a.t - ms) < 1000 && row.vwap !== null) avwaps[a.id] = Number(row.vwap);
    }
  }
  const summary = (summaryRes.data ?? null) as { weekly_vwap?: number | null; monthly_vwap?: number | null } | null;
  const candles15m = ((candleRes.data ?? []) as Record<string, unknown>[])
    .map((r) => ({
      openTime: r.open_time as string,
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: r.volume === null ? undefined : Number(r.volume),
    }))
    .filter((c) => Date.parse(c.openTime) + 15 * 60_000 <= now)
    .slice(0, CANDLES_15M)
    .reverse();
  return {
    drawings,
    avwaps,
    weeklyVwap: summary?.weekly_vwap != null ? Number(summary.weekly_vwap) : null,
    monthlyVwap: summary?.monthly_vwap != null ? Number(summary.monthly_vwap) : null,
    candles15m,
    spotPoints: (spotRes.data ?? []) as SpotPressurePoint[],
    loadedAt: now,
  };
}

function refresh() {
  if (inflight) return inflight;
  inflight = loadSetupData()
    .then((d) => {
      if (d) {
        cache = d;
        listeners.forEach((fn) => fn(d));
      }
      return d;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

function useSetupData(): SetupData | null {
  const [data, setData] = useState<SetupData | null>(cache);
  useEffect(() => {
    listeners.add(setData);
    if (!cache || Date.now() - cache.loadedAt > REFRESH_MS / 2) refresh();
    const stop = setVisibleInterval(() => {
      if (!cache || Date.now() - cache.loadedAt >= REFRESH_MS - 5_000) refresh();
    }, REFRESH_MS);
    return () => {
      listeners.delete(setData);
      stop();
    };
  }, []);
  return data;
}

/** Setup-Ideen fuer Karte und Kopf-Zeile. */
export function useSetup(props: DecisionProps): { ideas: SetupIdea[]; loaded: boolean } {
  const data = useSetupData();
  const { latest } = useLivePriceData();
  const { bundle, fetchedSinceIso, fetchedAtMs } = useDashboardPoll();
  const { spotPerp, journal, inputs } = useTradeStatus(props);
  const [nowMs, setNowMs] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, []);
  if (!data || nowMs === null) return { ideas: [], loaded: false };
  const context = deriveMarketContext(bundle, props.timeframe, fetchedSinceIso, fetchedAtMs);
  const price = latest?.last_price ?? data.candles15m[data.candles15m.length - 1]?.close ?? null;
  const { ideas } = evaluateSetup({
    price,
    nowMs,
    candles15m: data.candles15m,
    drawings: data.drawings,
    avwaps: data.avwaps,
    weeklyVwap: data.weeklyVwap,
    monthlyVwap: data.monthlyVwap,
    spotBars: hourlySpotNet(data.spotPoints, nowMs),
    spot4h: spotPerp.result.spotDirection,
    oiChangePct: context.oiChangePct,
    fundingPct: inputs.fundingPct,
    crowdLongPct: inputs.crowdLongPct,
    noisePct: inputs.noisePct,
    upcomingRisk: inputs.upcomingRisk,
    dataDay: inputs.dataDay,
    tradesToday: journal.trades,
    lossesInRow: journal.losses,
  });
  return { ideas, loaded: true };
}

const TONE = { trade: "ok", watch: "warn", wait: "neutral", stop: "stop" } as const;
const fmt = (n: number) => Math.round(n).toLocaleString("de-CH");
const pct = (n: number, d = 1) => n.toLocaleString("de-CH", { minimumFractionDigits: d, maximumFractionDigits: d });
const MARK = { ja: ["✓", "text-up"], teil: ["◐", "text-warn"], nein: ["–", "text-text-faint"] } as const;

export function IdeaBody({ idea }: { idea: SetupIdea }) {
  const half = idea.halfSize.length > 0;
  const range = idea.cluster.lo === idea.cluster.hi ? fmt(idea.cluster.lo) : `${fmt(idea.cluster.lo)}–${fmt(idea.cluster.hi)}`;
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className={`font-semibold ${idea.side === "long" ? "text-up" : "text-down"}`}>
          {idea.side === "long" ? "Long" : "Short"} {range}
        </span>
        <span className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[11px] text-text-muted">
          {idea.cluster.horizon === "swing" ? "Swing" : "Intraday"}
          {idea.atCluster ? " · am Cluster" : ` · ${pct(idea.distancePct)} % entfernt`}
        </span>
      </div>
      <p className="text-xs text-text-faint">{idea.cluster.levels.map((l) => l.name).join(" · ")}</p>

      <dl className="grid grid-cols-[auto_1fr_auto] gap-x-3 gap-y-1 text-[13px]">
        <dt className="text-text-faint">{idea.atCluster ? "Einstieg" : "Einstieg ab"}</dt>
        <dd className="font-mono tabular">{fmt(idea.entry)}</dd>
        <dd className="text-right font-mono text-xs text-text-muted">{idea.atCluster ? "Kurs" : "Cluster-Kante"}</dd>
        <dt className="text-text-faint">Stop</dt>
        <dd className="font-mono tabular text-down">{fmt(idea.stop)}</dd>
        <dd className="text-right font-mono text-xs text-text-muted">
          −{pct(idea.stopPct, 2)} %{idea.stopWidened ? " · 1H-Rauschen" : ""}
        </dd>
        {idea.targets.map((t, i) => (
          <div key={t.price} className="contents">
            <dt className="text-text-faint">Ziel {i + 1}</dt>
            <dd className="font-mono tabular text-up">{fmt(t.price)}</dd>
            <dd className="text-right font-mono text-xs text-text-muted">
              +{pct(t.pct)} % · CRV {pct(t.crv)}
            </dd>
          </div>
        ))}
        <dt className="text-text-faint">Hebel</dt>
        <dd className="font-mono tabular">{idea.leverage}x</dd>
        <dd className={`text-right font-mono text-xs ${half ? "text-warn" : "text-text-muted"}`}>
          {half ? "halbe Grösse · Risiko 0,5 USDT" : "Risiko 1 USDT"}
        </dd>
      </dl>

      <div className="space-y-1 border-t border-border/60 pt-2">
        <p className="flex items-baseline justify-between text-xs">
          <span className="font-medium text-text">Belege</span>
          <span className="font-mono text-text-muted">
            {idea.score} / {MAX_POINTS} · ab {SETUP_MIN_POINTS} steht das Setup
          </span>
        </p>
        <ul className="space-y-0.5 text-[13px]">
          {idea.evidence.map((e) => (
            <li key={e.id} className="grid grid-cols-[1rem_minmax(0,1fr)_auto] gap-1.5">
              <span className={`font-mono ${MARK[e.state][1]}`}>{MARK[e.state][0]}</span>
              <span className="text-text">{e.text}</span>
              <span className="font-mono text-xs text-text-faint">
                {e.points}/{e.max}
              </span>
            </li>
          ))}
        </ul>
      </div>

      {idea.against.length > 0 && (
        <div className="space-y-1 border-t border-border/60 pt-2 text-[13px]">
          <p className="text-xs font-medium text-text">
            Dagegen <span className="font-normal text-text-faint">(Hintergrund, ändert nur die Grösse)</span>
          </p>
          <ul className="space-y-0.5 text-text-muted">
            {idea.against.map((a) => (
              <li key={a}>✗ {a}</li>
            ))}
          </ul>
        </div>
      )}
      {half && <p className="text-xs text-warn">Halbe Grösse: {idea.halfSize.join(", ")}.</p>}
      <p
        className={`rounded-md border px-3 py-2 text-xs ${
          idea.vetos.length > 0 ? "border-down/40 bg-down/10 text-down" : "border-border text-text-muted"
        }`}
      >
        {idea.vetos.length > 0 ? `Veto: ${idea.vetos.join(" · ")}` : "Veto: keins."}
      </p>
    </div>
  );
}

export function SetupCard(props: DecisionProps) {
  const { ideas, loaded } = useSetup(props);
  const [first, second] = ideas;
  const line = !loaded
    ? "Lädt …"
    : first
      ? `${first.verdict.short}${first.halfSize.length > 0 && first.verdict.tone !== "wait" ? " · halbe Grösse" : ""}`
      : "Keine eigenen Zeichnungen in der Nähe";
  return (
    <StepCard step={3} title="Setup-Rechner" line={line} tone={first ? TONE[first.verdict.tone] : "neutral"} info={setupInfo} usageId="setup">
      {first ? <IdeaBody idea={first} /> : <p className="text-sm text-text-muted">Nexus findet keinen Cluster mit deinen Zeichnungen.</p>}
      {second && (
        <details className="rounded-md border border-border/60 px-3 py-2">
          <summary className="cursor-pointer text-xs text-text-muted">{second.verdict.short}</summary>
          <div className="mt-3">
            <IdeaBody idea={second} />
          </div>
        </details>
      )}
    </StepCard>
  );
}
