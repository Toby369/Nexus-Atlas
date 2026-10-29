"use client";

import { useState } from "react";
import {
  classifyFundingPct,
  fundingAnnualizedPct,
  FUNDING_BASELINE_PCT,
  FUNDING_ELEVATED_PCT,
  FUNDING_EUPHORIA_PCT,
  FUNDING_EXTREME_PCT,
  type FundingLevelId,
  type FundingTone,
} from "@/lib/fundingLevels";
import { NumberField, Pill, Stat, ToolBox, formatNum, type Tone } from "./ui";

const TONE: Record<FundingTone, Tone> = { calm: "neutral", watch: "watch", risk: "bearish" };

const B = FUNDING_BASELINE_PCT;
const E = FUNDING_ELEVATED_PCT;
const X = FUNDING_EXTREME_PCT;
const U = FUNDING_EUPHORIA_PCT;

// Dieselben Grenzen wie lib/fundingLevels.ts, hier nur als Lesetabelle.
const ZONES: { id: FundingLevelId; range: string; text: string }[] = [
  { id: "extreme_negative", range: `≤ −${X} %`, text: "Shorts überfüllt und zahlen viel. Treibstoff für einen Short-Squeeze." },
  { id: "negative", range: `−${X} bis −${B} %`, text: "Shorts dominieren, häufig nach Abverkäufen oder in Angstphasen." },
  { id: "slightly_negative", range: `−${B} bis 0 %`, text: "Leichter Short-Überhang, noch kein Crowding." },
  { id: "neutral", range: `0 bis ${B} %`, text: "Grundwert, kein Signal. 0,01 % pro 8 h ist der Standardwert der Börsen (≈ 11 % pro Jahr)." },
  { id: "elevated", range: `${B} bis ${E} %`, text: "Long-lastig, typisch in gesunden Aufwärtstrends." },
  { id: "high", range: `${E} bis ${X} %`, text: "Deutliches Long-Crowding. Rücksetzer fallen heftiger aus." },
  { id: "extreme", range: `${X} bis ${U} %`, text: "Nexus-Schwelle: ab hier bärisches Crowding-Signal (≈ 55 % pro Jahr)." },
  { id: "euphoria", range: `≥ ${U} %`, text: "Ausnahmezustand, nur in Blow-off-Phasen. Hohe Long-Squeeze-Gefahr." },
];

export default function FundingCalculator({ liveFundingPct }: { liveFundingPct: number | null }) {
  const [rate, setRate] = useState(liveFundingPct ?? 0.01);
  const [intervalHours, setIntervalHours] = useState(8);
  const [position, setPosition] = useState(10_000);

  const safeRate = Number.isFinite(rate) ? rate : 0;
  const per8h = safeRate * (8 / intervalHours);
  const level = classifyFundingPct(per8h);
  const annual = fundingAnnualizedPct(per8h);
  const perDay = (Number.isFinite(position) ? position : 0) * (safeRate / 100) * (24 / intervalHours);

  return (
    <ToolBox title="Funding-Rechner · Wann ist Funding sehr hoch?">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <NumberField id="fr-rate" label="Funding-Rate in %" value={rate} onChange={setRate} step={0.001} />
        <label htmlFor="fr-int" className="space-y-1 block">
          <span className="text-[11px] text-text-faint">Intervall der Börse</span>
          <select
            id="fr-int"
            value={intervalHours}
            onChange={(e) => setIntervalHours(Number(e.target.value))}
            className="w-full bg-surface border border-border rounded-md px-2 py-1 text-sm text-text"
          >
            <option value={8}>alle 8 h (Binance, Bybit, OKX)</option>
            <option value={4}>alle 4 h</option>
            <option value={1}>jede Stunde</option>
          </select>
        </label>
        <NumberField id="fr-pos" label="Positionsgrösse (USD)" value={position} onChange={setPosition} step={1000} />
      </div>
      {liveFundingPct !== null && (
        <button
          type="button"
          onClick={() => {
            setRate(liveFundingPct);
            setIntervalHours(8);
          }}
          className="text-[11px] text-accent underline decoration-dotted"
        >
          Aktuellen Nexus-Wert einsetzen ({formatNum(liveFundingPct, 4)} %, Ø 4 Börsen)
        </button>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <Pill tone={TONE[level.tone]}>{level.label}</Pill>
        <span className="text-xs text-text-muted">{level.hint}</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <Stat label="Umgerechnet auf 8 h" value={`${per8h >= 0 ? "+" : ""}${formatNum(per8h, 4)} %`} />
        <Stat label="Hochgerechnet pro Jahr" value={`${annual >= 0 ? "+" : ""}${formatNum(annual, 1)} %`} />
        <Stat
          label={perDay >= 0 ? "Kosten pro Tag (Long)" : "Ertrag pro Tag (Long)"}
          value={`${formatNum(Math.abs(perDay), 2)} USD`}
        />
      </div>

      <div className="space-y-1">
        {ZONES.map((z) => (
          <div
            key={z.id}
            className={`grid grid-cols-[6.5rem_1fr] gap-2 rounded-md px-2 py-1 text-xs ${
              z.id === level.id ? "bg-surface-raised ring-1 ring-border" : ""
            }`}
          >
            <span className="font-mono text-text-muted">{z.range}</span>
            <span className="text-text-faint">{z.text}</span>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-text-faint">
        Vergleiche Funding immer auf derselben Basis: 0,01 % pro Stunde sind achtmal mehr als 0,01 % pro 8 h.
      </p>
    </ToolBox>
  );
}
