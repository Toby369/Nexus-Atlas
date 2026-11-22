"use client";

import type { DecisionProps } from "@/components/TradeStepCards";
import { useSetup } from "@/components/SetupCard";
import { headFromSetup } from "@/lib/headLine";
import { OPEN_TAB_EVENT } from "@/lib/dashboardTabs";

// Kopf des Lagebilds: eine Handlungszeile (Plan, Stand des Regelchecks,
// Veto). Ein Tipp darauf springt in den Reiter "Trade".
// 15.11.2026 (Toby: "Ruhe, Klarheit"): Die Zeile mit OI, Spot, CVD und
// Funding steht nicht mehr im Kopf, sondern im Reiter "Lage" (LageCard).

const TONE = { neutral: "text-text", ok: "text-up", warn: "text-warn", stop: "text-down" } as const;

export default function HeadStatus({ tradeStep, plan }: { tradeStep: DecisionProps; plan: string | null }) {
  const { ideas } = useSetup(tradeStep);
  const action = headFromSetup(ideas[0], plan);

  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent(OPEN_TAB_EVENT, { detail: "trade" }))}
      className={`block w-full text-left text-base font-medium leading-snug ${TONE[action.tone]}`}
    >
      {action.text} <span className="text-xs text-text-faint">→ Trade</span>
    </button>
  );
}
