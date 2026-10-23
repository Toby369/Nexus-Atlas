"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLivePriceData } from "@/components/LivePriceDataProvider";
import { useDashboardPoll } from "@/components/DashboardPollProvider";
import { useSpotPerpSummary } from "@/components/SpotPerpFlowPanel";
import { WARNING_LABELS } from "@/components/TradingHoursBadge";
import PanelInfo from "@/components/PanelInfo";
import { ruleCheckInfo, vetoInfo } from "@/lib/panelInfo";
import type { Candle4h } from "@/lib/fourHourBreakout";
import { evaluateRuleCheck, type CheckAnswer } from "@/lib/ruleCheck";
import { evaluateVeto, MAX_LOSSES_IN_ROW, MAX_TRADES_PER_DAY, type VetoAnswer } from "@/lib/veto";
import { fundingPctPer8h } from "@/lib/fundingLevels";
import { summarizePositioning } from "@/lib/positioning";
import { nextHighRiskWindow, type EconomicEventRow } from "@/lib/tradingHours";
import { getTimeframe, type TimeframeId } from "@/lib/timeframes";

// Schritte 3 und 4 im Dashboard (Toby 22.10.2026): Regelcheck aus den
// Kerzen und das Veto vor dem Klick. Beide Karten teilen die Richtung des
// juengsten 4H-Koerperausbruchs. Trades und Verluste des Tages fuehrt Toby
// per Tippen nach (nur in diesem Browser gespeichert).

const ANSWER_STYLE: Record<CheckAnswer | VetoAnswer, string> = {
  ja: "bg-up/15 text-up",
  ok: "bg-up/15 text-up",
  nein: "bg-down/15 text-down",
  veto: "bg-down/15 text-down",
  warnung: "bg-warn/15 text-warn",
  offen: "bg-surface-raised text-text-muted",
};

const VERDICT_STYLE = {
  trade: "border-up/40 text-up",
  wait: "border-border text-text",
  stop: "border-down/40 text-down",
};

const JOURNAL_KEY = "nexus-atlas-journal-day-v1";
const UPDATE_INTERVAL_MS = 30_000;

function zurichDate(ms: number): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Zurich" }).format(new Date(ms));
}

function useDayJournal() {
  const [journal, setJournal] = useState({ trades: 0, losses: 0 });
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const stored = JSON.parse(window.localStorage.getItem(JOURNAL_KEY) ?? "null");
        if (stored?.date === zurichDate(Date.now())) {
          setJournal({ trades: Number(stored.trades) || 0, losses: Number(stored.losses) || 0 });
        }
      } catch {
        // Privater Modus o.ae.: Zaehler starten bei 0.
      }
    });
  }, []);
  const update = (next: { trades: number; losses: number }) => {
    setJournal(next);
    try {
      window.localStorage.setItem(JOURNAL_KEY, JSON.stringify({ date: zurichDate(Date.now()), ...next }));
    } catch {
      // s.o.
    }
  };
  return [journal, update] as const;
}

function Row({ question, label, detail, tone }: { question: string; label: string; detail: string; tone: string }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/50 py-2 last:border-b-0">
      <div className="min-w-0">
        <p className="text-xs text-text">{question}</p>
        {detail && <p className="text-[11px] text-text-faint">{detail}</p>}
      </div>
      <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-semibold tabular ${tone}`}>{label}</span>
    </div>
  );
}

function Stepper({ label, value, max, onChange }: { label: string; value: number; max: number; onChange: (v: number) => void }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-text-muted">
      {label}
      <button
        type="button"
        aria-label={`${label} verringern`}
        onClick={() => onChange(Math.max(0, value - 1))}
        className="h-6 w-6 rounded border border-border text-text-muted hover:text-text"
      >
        −
      </button>
      <span className="w-8 text-center font-mono tabular text-text">
        {value}/{max}
      </span>
      <button
        type="button"
        aria-label={`${label} erhöhen`}
        onClick={() => onChange(value + 1)}
        className="h-6 w-6 rounded border border-border text-text-muted hover:text-text"
      >
        +
      </button>
    </span>
  );
}

function CardHead({ step, title, info, infoTitle, right }: { step: number; title: string; info: string; infoTitle: string; right?: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="flex items-center gap-1.5">
        <h2 className="text-[11px] uppercase tracking-[0.14em] text-text-faint">
          <span className="font-mono text-accent">{step}</span> · {title}
        </h2>
        <PanelInfo title={infoTitle} content={info} />
      </span>
      {right && <span className="text-[11px] font-semibold text-text-muted">{right}</span>}
    </div>
  );
}

export default function DecisionCards({
  keyLevels,
  candles4h,
  candles1h,
  candles15m,
  ema13,
  events,
  timeframe,
}: {
  keyLevels: { price: number }[];
  candles4h: Candle4h[];
  candles1h: Candle4h[];
  candles15m: Candle4h[];
  ema13: number | null;
  events: EconomicEventRow[];
  timeframe: TimeframeId;
}) {
  const { latest } = useLivePriceData();
  const { bundle, fetchedSinceIso } = useDashboardPoll();
  const [journal, setJournal] = useDayJournal();
  const [risk, setRisk] = useState<{ id: keyof typeof WARNING_LABELS; inMin: number } | null>(null);

  useEffect(() => {
    const update = () => setRisk(nextHighRiskWindow(Date.now(), events));
    update();
    const interval = setInterval(update, UPDATE_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [events]);

  const price = latest?.last_price ?? null;
  const check = evaluateRuleCheck({ levels: keyLevels, price, candles4h, candles1h, candles15m, ema13 });

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
  const veto = evaluateVeto({
    side: check.side,
    fundingPct: latest?.funding_rate == null ? null : fundingPctPer8h(latest.funding_rate),
    crowdLongPct: positioning?.crowdLongPct ?? null,
    spot: spotPerp.result.spotDirection,
    perp: spotPerp.result.perpDirection,
    driverLabel: spotPerp.result.verdict ? `${spotPerp.result.verdict.label}: ${spotPerp.result.verdict.text}` : null,
    upcomingRisk: risk ? `${WARNING_LABELS[risk.id]} ${risk.inMin === 0 ? "läuft jetzt" : `in ${risk.inMin} Min`}` : null,
    tradesToday: journal.trades,
    lossesInRow: journal.losses,
  });
  const vetoCount = veto.filter((r) => r.answer === "veto").length;
  const warnCount = veto.filter((r) => r.answer === "warnung").length;
  const sideLabel = check.side === "long" ? "Long" : check.side === "short" ? "Short" : undefined;

  return (
    <>
      <section className="rounded-lg border border-border bg-surface p-4 space-y-2">
        <CardHead step={3} title="Regelcheck" infoTitle="Regelcheck" info={ruleCheckInfo} right={sideLabel} />
        <div>
          {check.rows.map((r) => (
            <Row key={r.id} question={r.question} label={r.label} detail={r.detail} tone={ANSWER_STYLE[r.answer]} />
          ))}
        </div>
        <p className={`rounded-md border px-3 py-2 text-sm font-medium ${VERDICT_STYLE[check.verdict.tone]}`}>
          {check.verdict.text}
        </p>
        <Link href="/lernen" className="inline-block text-[11px] text-text-faint hover:text-text">
          Alle Fragen mit Risiko-Rechner: Trade-Entscheider unter Lernen →
        </Link>
      </section>

      <section className="rounded-lg border border-border bg-surface p-4 space-y-2">
        <CardHead
          step={4}
          title="Veto vor dem Klick"
          infoTitle="Veto vor dem Klick"
          info={vetoInfo}
          right={vetoCount > 0 ? "Veto" : warnCount > 0 ? `${warnCount} Warnung${warnCount > 1 ? "en" : ""}` : "Frei"}
        />
        <div>
          {veto.map((r) => (
            <Row key={r.id} question={r.question} label={r.label} detail={r.detail} tone={ANSWER_STYLE[r.answer]} />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 pt-2">
          <Stepper
            label="Trades heute"
            value={journal.trades}
            max={MAX_TRADES_PER_DAY}
            onChange={(trades) => setJournal({ ...journal, trades })}
          />
          <Stepper
            label="Verluste in Folge"
            value={journal.losses}
            max={MAX_LOSSES_IN_ROW}
            onChange={(losses) => setJournal({ ...journal, losses })}
          />
        </div>
      </section>
    </>
  );
}
