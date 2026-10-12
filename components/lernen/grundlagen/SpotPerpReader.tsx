"use client";

import { useState } from "react";
import { spotPerpVerdict, type FlowDirection } from "@/lib/spotPerpFlow";
import { Pill, Segmented, ToolBox } from "./ui";

const OPTIONS: { value: FlowDirection; label: string }[] = [
  { value: "up", label: "kauft" },
  { value: "flat", label: "flach" },
  { value: "down", label: "verkauft" },
];

export default function SpotPerpReader() {
  const [spot, setSpot] = useState<FlowDirection>("up");
  const [perp, setPerp] = useState<FlowDirection>("flat");
  // Dieselbe Einordnung wie im Live-Aufklapper "Wer treibt" der Marktkontext-Kachel.
  const v = spotPerpVerdict(spot, perp);

  return (
    <ToolBox title="Spot-CVD gegen Perp-CVD">
      <div className="flex flex-wrap gap-3">
        <Segmented label="Spot" value={spot} onChange={setSpot} options={OPTIONS} />
        <Segmented label="Perp" value={perp} onChange={setPerp} options={OPTIONS} />
      </div>
      <div className="rounded-md bg-surface-raised p-3 space-y-2" aria-live="polite">
        <Pill tone={v.tone}>{v.label}</Pill>
        <p className="text-xs text-text-muted">{v.text}</p>
      </div>
      <p className="text-[11px] text-text-faint">
        Binance-Spot zeigt nicht die US-Nachfrage. ETF-Käufe laufen über Coinbase und OTC-Desks, dafür steht die
        Coinbase-Premium.
      </p>
    </ToolBox>
  );
}
