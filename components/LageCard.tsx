"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useLivePriceData } from "@/components/LivePriceDataProvider";
import { useDashboardPoll } from "@/components/DashboardPollProvider";
import { useSpotPerpSummary } from "@/components/SpotPerpFlowPanel";
import PanelInfo from "@/components/PanelInfo";
import { supabase } from "@/lib/supabase";
import { deriveMarketContext } from "@/lib/marketContext";
import { fundingPctPer8h } from "@/lib/fundingLevels";
import { summarizePositioning } from "@/lib/positioning";
import { nearestLiquidationTargets } from "@/lib/zones";
import { economicEventMarkMs } from "@/lib/economicCalendar";
import { logUsage } from "@/lib/tileUsage";
import { lageInfo } from "@/lib/panelInfo";
import { getTimeframe, type TimeframeId } from "@/lib/timeframes";
import { setVisibleInterval } from "@/lib/visibleInterval";
import {
  driverRow,
  leverageRow,
  macroRow,
  overallSentence,
  usInvestorsRow,
  type LageRow,
  type Light,
} from "@/lib/lageOverview";
import type { EconomicCalendarEvent, EtfFlowDay, MarketState } from "@/lib/types";
import type { EconomicEventResult } from "@/lib/economicEventResult";
import type { PremiumSummary } from "@/lib/coinbasePremium";
import Link from "next/link";
import { MACRO_DATA_DAY_KEYS, MACRO_EVENT_GUIDE } from "@/lib/macroGuide";

// Reiter "Lage" (Toby 15.11.2026): vier Fragen, je eine Zeile mit Ampel,
// darueber ein Satz Gesamtlage. Keine Diagramme auf dem Startbildschirm;
// die bisherigen Kacheln stecken als Details unter der jeweiligen Frage.

const LIGHT_DOT: Record<Light, string> = { up: "bg-up", down: "bg-down", warn: "bg-warn", neutral: "bg-text-faint" };
const LIGHT_TEXT: Record<Light, string> = { up: "text-up", down: "text-down", warn: "text-warn", neutral: "text-text" };
const ETF_DAYS = 5;
const PREMIUM_REFRESH_MS = 5 * 60_000;
const CLOCK_MS = 60_000;
const MACRO_KEYS = MACRO_DATA_DAY_KEYS;
const BIAS_TEXT = { bullish: "bullisch", bearish: "bärisch", neutral: "neutral" } as const;
const BIAS_CLASS = { bullish: "text-up", bearish: "text-down", neutral: "text-text-muted" } as const;

const dateCh = (ms: number) =>
  new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", day: "numeric", month: "numeric" }).format(ms);
const timeCh = (ms: number) =>
  new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(ms);

/** Aufklapper "US-Makro": naechster Termin mit Erklaerung, letzte Einordnung, naechste Termine. */
function MacroDetail({
  upcoming,
  lastResult,
  lastLabel,
  nowMs,
}: {
  upcoming: { label: string; key: string; ms: number }[];
  lastResult: EconomicEventResult | null;
  lastLabel: string | null;
  nowMs: number | null;
}) {
  const next = upcoming[0];
  const guide = next ? MACRO_EVENT_GUIDE[next.key] : undefined;
  const hours = next && nowMs !== null ? (next.ms - nowMs) / 3_600_000 : null;
  return (
    <div className="space-y-2.5 rounded-md border border-border bg-surface-raised p-3 text-sm">
      {next && guide ? (
        <div className="space-y-1.5">
          <p className="flex items-baseline justify-between gap-2">
            <span className="font-medium text-text">
              {guide.short} · {guide.name}
            </span>
            <span className={`shrink-0 font-mono text-xs ${hours !== null && hours <= 24 ? "text-warn" : "text-text-faint"}`}>
              {dateCh(next.ms)} {timeCh(next.ms)}
            </span>
          </p>
          <dl className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-1 text-xs">
            <dt className="text-text-faint">Misst</dt>
            <dd className="text-text">{guide.measures}</dd>
            <dt className="text-text-faint">Wirkung</dt>
            <dd className="text-text">{guide.effect}</dd>
            <dt className="text-text-faint">Regeln</dt>
            <dd className="text-text">{guide.rules}</dd>
          </dl>
        </div>
      ) : (
        <p className="text-xs text-text-faint">Kein Termin im Kalender.</p>
      )}
      {lastResult && (
        <p className="border-t border-border/60 pt-2 text-xs text-text-muted">
          Zuletzt {lastLabel} {dateCh(Date.parse(lastResult.event_date))}:{" "}
          <span className={BIAS_CLASS[lastResult.bias]}>{BIAS_TEXT[lastResult.bias]}</span> · {lastResult.summary}
        </p>
      )}
      {upcoming.length > 1 && (
        <ul className="space-y-0.5 border-t border-border/60 pt-2 text-xs text-text-muted">
          {upcoming.slice(1, 4).map((u) => (
            <li key={`${u.key}${u.ms}`} className="flex justify-between gap-2">
              <span>{MACRO_EVENT_GUIDE[u.key]?.short ?? u.label}</span>
              <span className="font-mono">
                {dateCh(u.ms)} {timeCh(u.ms)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <Link href="/lernen" className="inline-block text-xs text-accent">
        Alles zu Makro-Daten unter Lernen →
      </Link>
    </div>
  );
}

function Question({ row, children }: { row: LageRow; children?: ReactNode }) {
  return (
    <details
      className="group border-b border-border/50 py-2.5 last:border-b-0"
      onToggle={(e) => e.currentTarget.open && logUsage(`step:lage-${row.id}`)}
    >
      <summary className="flex cursor-pointer select-none list-none items-start gap-3 [&::-webkit-details-marker]:hidden">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${LIGHT_DOT[row.light]}`} aria-hidden />
        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] uppercase tracking-[0.12em] text-text-faint">{row.title}</span>
            <span className={`shrink-0 text-xs font-medium ${LIGHT_TEXT[row.light]}`}>{row.chip}</span>
          </span>
          <span className="block text-sm text-text tabular">{row.line}</span>
        </span>
        <span aria-hidden className="pt-1 text-xs text-text-faint transition-transform group-open:rotate-180">
          ▾
        </span>
      </summary>
      {children && <div className="mt-3 space-y-3">{children}</div>}
    </details>
  );
}

export default function LageCard({
  timeframe,
  marketState,
  etfFlows,
  events,
  liquidationZones,
  details,
}: {
  timeframe: TimeframeId;
  marketState: MarketState | null;
  etfFlows: EtfFlowDay[];
  events: EconomicCalendarEvent[];
  liquidationZones: { side: "long" | "short"; priceLow: number; priceHigh: number; massUsd: number }[];
  /** Bisherige Kacheln als Details unter der jeweiligen Frage. */
  details: Partial<Record<LageRow["id"], ReactNode>>;
}) {
  const { latest } = useLivePriceData();
  const { bundle, fetchedSinceIso, fetchedAtMs } = useDashboardPoll();
  const [premium, setPremium] = useState<PremiumSummary | null>(null);
  const [lastResult, setLastResult] = useState<EconomicEventResult | null>(null);
  const [nowMs, setNowMs] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/coinbase-premium");
        const json = await res.json();
        if (!cancelled && json?.success) setPremium(json.summary as PremiumSummary);
      } catch {
        // Ohne Praemie zaehlt nur der ETF-Fluss.
      }
    };
    load();
    const stop = setVisibleInterval(load, PREMIUM_REFRESH_MS);
    return () => {
      cancelled = true;
      stop();
    };
  }, []);

  useEffect(() => {
    supabase
      .from("economic_event_results")
      .select("event_key, event_date, bias, summary, created_at")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => setLastResult((data as EconomicEventResult | null) ?? null));
  }, []);

  useEffect(() => {
    const tick = () => setNowMs(Date.now());
    tick();
    const id = setInterval(tick, CLOCK_MS);
    return () => clearInterval(id);
  }, []);

  const context = deriveMarketContext(bundle, timeframe, fetchedSinceIso, fetchedAtMs);
  const spotSummary = bundle.spot_summary;
  const spotPerp = useSpotPerpSummary({
    sinceIso: fetchedSinceIso,
    windowMinutes: getTimeframe(timeframe).minutes,
    spotBuy: spotSummary?.sum_taker_buy_vol ?? null,
    spotSell: spotSummary?.sum_taker_sell_vol ?? null,
  });
  const positioning = summarizePositioning(
    [bundle.positioning_binance, bundle.positioning_bybit, bundle.positioning_okx, bundle.positioning_bitget],
    bundle.positioning_binance
  );
  const liq = nearestLiquidationTargets(liquidationZones, latest?.last_price ?? null);

  const etfDays = etfFlows.slice(0, ETF_DAYS);
  const etfSum = etfDays.length > 0 ? etfDays.reduce((s, f) => s + (f.total_flow_usd_m ?? 0), 0) : null;
  const sentiment = marketState?.factors?.sentiment?.basis as { value?: number; classification?: string } | undefined;
  const macroBasis = marketState?.factors?.macro?.basis as { regime?: string } | undefined;

  const upcomingEvents =
    nowMs === null
      ? []
      : events
          .filter((e) => MACRO_KEYS.includes(e.event_key))
          .map((e) => ({ e, ms: economicEventMarkMs(e.event_key, e.event_date) }))
          .filter((x): x is { e: EconomicCalendarEvent; ms: number } => x.ms !== null && x.ms > nowMs)
          .sort((a, b) => a.ms - b.ms);
  const nextEvent = upcomingEvents[0] ?? null;
  const labelFor = (key: string) => events.find((e) => e.event_key === key)?.label ?? key.toUpperCase();

  const rows: LageRow[] = [
    driverRow({
      spot: spotPerp.result.spotDirection,
      perp: spotPerp.result.perpDirection,
      verdictLabel: spotPerp.result.verdict?.label ?? null,
      oiChangePct: context.oiChangePct,
      scenarioLabel: context.result.label,
    }),
    leverageRow({
      fundingPct: latest?.funding_rate == null ? null : fundingPctPer8h(latest.funding_rate),
      crowdLongPct: positioning?.crowdLongPct ?? null,
      liqAbove: liq.above?.low ?? null,
      liqBelow: liq.below?.high ?? null,
    }),
    usInvestorsRow({
      etfLastUsdM: etfDays[0]?.total_flow_usd_m ?? null,
      etfSumUsdM: etfSum,
      etfDays: etfDays.length,
      premiumPct: premium?.currentPct ?? null,
      premiumLabel: premium?.label ?? null,
      fearGreed: typeof sentiment?.value === "number" ? sentiment.value : null,
      fearGreedLabel: sentiment?.classification ?? null,
    }),
    macroRow({
      next:
        nextEvent && nowMs !== null
          ? {
              label: nextEvent.e.label,
              whenText: `${dateCh(nextEvent.ms)} ${timeCh(nextEvent.ms)}`,
              hoursAway: (nextEvent.ms - nowMs) / 3_600_000,
            }
          : null,
      lastResult: lastResult
        ? { label: labelFor(lastResult.event_key), bias: lastResult.bias, dateText: dateCh(Date.parse(lastResult.event_date)) }
        : null,
      regime: macroBasis?.regime ?? null,
    }),
  ];
  const overall = overallSentence(rows);

  return (
    <section className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <h2 className="text-[11px] uppercase tracking-[0.14em] text-text-faint">Marktlage</h2>
          <PanelInfo title="Marktlage" content={lageInfo} />
        </span>
        <span className="text-[11px] text-text-faint">Zeitraum {getTimeframe(timeframe).label}</span>
      </div>
      <p className={`text-base font-medium leading-snug ${LIGHT_TEXT[overall.light]}`}>{overall.text}</p>
      <div>
        {rows.map((r) => (
          <Question key={r.id} row={r}>
            {r.id === "macro" && (
              <MacroDetail
                upcoming={upcomingEvents.map(({ e, ms }) => ({ label: e.label, key: e.event_key, ms }))}
                lastResult={lastResult}
                lastLabel={lastResult ? MACRO_EVENT_GUIDE[lastResult.event_key]?.short ?? labelFor(lastResult.event_key) : null}
                nowMs={nowMs}
              />
            )}
            {details[r.id]}
          </Question>
        ))}
      </div>
    </section>
  );
}
