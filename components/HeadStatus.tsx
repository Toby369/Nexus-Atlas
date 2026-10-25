"use client";

import { useLivePriceData } from "@/components/LivePriceDataProvider";
import { useTradeStatus, type DecisionProps } from "@/components/TradeStepCards";
import { headActionLine } from "@/lib/headLine";
import { classifyFunding, fundingPctPer8h } from "@/lib/fundingLevels";
import { getTimeframe } from "@/lib/timeframes";
import { OPEN_TAB_EVENT } from "@/lib/dashboardTabs";
import { headMarketInfo } from "@/lib/panelInfo";
import PanelInfo from "@/components/PanelInfo";

// Kopf des Lagebilds (Toby 25.10.2026): eine Handlungszeile (Plan, Stand des
// Regelchecks, Veto) und darunter OI, Spot, CVD und Funding als schlichte
// Werte mit einer Zeile Deutung. Ein Tipp auf die Handlungszeile springt in
// den Reiter "Trade".

const TONE = { neutral: "text-text", ok: "text-up", warn: "text-warn", stop: "text-down" } as const;
const BIAS = { bullish: "text-up", bearish: "text-down", neutral: "text-text-muted" } as const;

function signed(v: number | null, digits = 1): string {
  if (v === null || !Number.isFinite(v)) return "—";
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(digits)} %`;
}

const flowTone = (v: number | null) => (v === null ? "text-text-muted" : v > 0 ? "text-up" : v < 0 ? "text-down" : "text-text");

export default function HeadStatus({
  tradeStep,
  plan,
  oiChangePct,
  spotNetFlowPct,
  contextLabel,
  contextBias,
}: {
  tradeStep: DecisionProps;
  plan: string | null;
  oiChangePct: number | null;
  spotNetFlowPct: number | null;
  contextLabel: string;
  contextBias: keyof typeof BIAS;
}) {
  const { latest } = useLivePriceData();
  const { check, summary, spotPerp } = useTradeStatus(tradeStep);
  const action = headActionLine(check, summary, plan);
  const fundingPct = latest?.funding_rate == null ? null : fundingPctPer8h(latest.funding_rate);
  const funding = classifyFunding(latest?.funding_rate ?? null);
  const perpNetPct = spotPerp.result.perpNetPct;
  const driver = spotPerp.result.verdict?.label ?? null;

  const values = [
    { label: "OI", value: signed(oiChangePct), tone: flowTone(oiChangePct) },
    { label: "Spot", value: signed(spotNetFlowPct), tone: flowTone(spotNetFlowPct) },
    { label: "CVD Perp", value: signed(perpNetPct), tone: flowTone(perpNetPct) },
    {
      label: "Funding",
      value: fundingPct === null ? "—" : `${fundingPct.toFixed(3)} %`,
      tone: funding?.tone === "risk" ? "text-down" : funding?.tone === "watch" ? "text-warn" : "text-text",
    },
  ];

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent(OPEN_TAB_EVENT, { detail: "trade" }))}
        className={`block w-full text-left text-base font-medium leading-snug ${TONE[action.tone]}`}
      >
        {action.text} <span className="text-xs text-text-faint">→ Trade</span>
      </button>

      <div className="space-y-1.5 rounded-md border border-border/60 bg-surface px-3 py-2">
        <dl className="grid grid-cols-4 gap-x-3 text-xs tabular font-mono">
          {values.map((v) => (
            <div key={v.label}>
              <dt className="font-sans text-[11px] text-text-faint">{v.label}</dt>
              <dd className={v.tone}>{v.value}</dd>
            </div>
          ))}
        </dl>
        <p className="text-xs leading-snug">
          <span className={BIAS[contextBias]}>{contextLabel}</span>
          {driver && <span className="text-text-muted"> · Treiber: {driver}</span>}
          {funding && <span className="text-text-muted"> · Funding {funding.label.toLowerCase()}</span>}
          <span className="text-text-faint"> ({getTimeframe(tradeStep.timeframe).label})</span>{" "}
          <span className="inline-block align-middle">
            <PanelInfo title="OI, Spot, CVD, Funding" content={headMarketInfo} />
          </span>
        </p>
      </div>
    </div>
  );
}
