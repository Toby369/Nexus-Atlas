"use client";

import { useState } from "react";
import { readScenario, type FundingState, type OiMove, type PriceMove } from "@/lib/grundlagen/scenario";
import { Pill, Segmented, ToolBox } from "./ui";

export default function ScenarioReader() {
  const [price, setPrice] = useState<PriceMove>("up");
  const [oi, setOi] = useState<OiMove>("up");
  const [funding, setFunding] = useState<FundingState>("neutral");
  const r = readScenario(price, oi, funding);

  return (
    <ToolBox title="Szenario-Leser · Preis × OI × Funding">
      <div className="flex flex-wrap gap-3">
        <Segmented
          label="Preis"
          value={price}
          onChange={setPrice}
          options={[
            { value: "up", label: "steigt" },
            { value: "flat", label: "seitwärts" },
            { value: "down", label: "fällt" },
          ]}
        />
        <Segmented
          label="Open Interest"
          value={oi}
          onChange={setOi}
          options={[
            { value: "up", label: "steigt" },
            { value: "down", label: "fällt" },
          ]}
        />
        <Segmented
          label="Funding"
          value={funding}
          onChange={setFunding}
          options={[
            { value: "neg", label: "stark negativ" },
            { value: "neutral", label: "normal" },
            { value: "pos", label: "stark positiv" },
          ]}
        />
      </div>
      <div className="rounded-md bg-surface-raised p-3 space-y-2" aria-live="polite">
        <div className="flex flex-wrap gap-1.5">
          <Pill tone={r.tone}>{r.name}</Pill>
          <Pill tone={r.fundingTone}>{r.fundingTag}</Pill>
        </div>
        <p className="text-xs text-text-muted">{r.text}</p>
        <p className="text-xs text-text-muted">{r.fundingText}</p>
        <p className="text-[11px] text-text-faint">
          <span className="font-medium">Als Nächstes prüfen:</span> {r.watch}
        </p>
      </div>
    </ToolBox>
  );
}
