"use client";

import { useLivePriceData } from "@/components/LivePriceDataProvider";
import StepCard from "@/components/StepCard";
import { zonesInfo } from "@/lib/panelInfo";
import { nearestZones, type ZoneRow } from "@/lib/zones";
import { computeTpSuggestions, type TpSuggestion } from "@/lib/tpStandard";

// Zonen-Kachel (Schritt 2 im Dashboard, Toby 22.10.2026): naechste
// Verkaeufer-Zone ueber und Kaeufer-Zone unter dem Live-Kurs, mit Abstand,
// Chance-Risiko (SL 0,5 % Kurs) und TP-Standard. Die 4H-Koerperfrage
// beantwortet der Regelcheck (lib/ruleCheck.ts).
const STOP_PCT = 0.5;

const fmt = (n: number) => n.toLocaleString("de-CH", { maximumFractionDigits: 0 });

function verdictText(s: TpSuggestion | undefined): string {
  if (!s || s.distancePct === null) return "";
  if (!s.standard) return "kein Trade (unter 1 %)";
  return `Standard ${s.standard.id} (TP ${s.standard.marginPct} %)${s.againstDaily ? " · ⚠ gegen 1D" : ""}`;
}

function ZoneBox({ zone, suggestion }: { zone: ZoneRow; suggestion?: TpSuggestion }) {
  const sell = zone.role === "Verkäufer-Zone";
  const sign = sell ? "+" : "−";
  return (
    <div
      className={`grid grid-cols-[1fr_auto] gap-x-3 rounded-md border px-3 py-2 text-xs ${
        sell ? "border-down/40 bg-down/10" : "border-up/40 bg-up/10"
      }`}
    >
      <span className={`font-semibold ${sell ? "text-down" : "text-up"}`}>{zone.role}</span>
      <span className="font-mono tabular text-text">{fmt(zone.price)}</span>
      <span className="col-span-2 text-text-muted">
        {sign}
        {zone.distancePct.toFixed(1)} %
        {suggestion && (
          <>
            {" · CRV "}
            {(zone.distancePct / STOP_PCT).toFixed(1)}
            {" · "}
            <span className={suggestion.standard ? "text-text" : "text-down"}>{verdictText(suggestion)}</span>
          </>
        )}
      </span>
    </div>
  );
}

export default function ZonesCard({
  keyLevels,
  dailyTrend,
}: {
  keyLevels: { price: number; side: "resistance" | "support" }[];
  dailyTrend: "bullish" | "bearish" | null;
}) {
  const { latest } = useLivePriceData();
  const price = latest?.last_price ?? null;
  const { above, below } = nearestZones(keyLevels, price);
  const [longS, shortS] = computeTpSuggestions(keyLevels, price, dailyTrend);
  const line =
    price === null
      ? "Kein Live-Kurs"
      : [above[0] && `↑ ${fmt(above[0].price)} +${above[0].distancePct.toFixed(1)} %`, below[0] && `↓ ${fmt(below[0].price)} −${below[0].distancePct.toFixed(1)} %`]
          .filter(Boolean)
          .join(" · ") || "Keine Keylevels in der Nähe";

  return (
    <StepCard step={2} title="Zonen" line={line} tone="neutral" info={zonesInfo}>
      <p className="text-[11px] text-text-faint">Keylevels · SL 0,5 %</p>
      {price === null || (above.length === 0 && below.length === 0) ? (
        <p className="text-xs text-text-faint">Keine Keylevels oder kein Live-Kurs verfügbar.</p>
      ) : (
        <div className="flex flex-col gap-1.5">
          {[...above].reverse().map((z, i) => (
            <ZoneBox key={`a${z.price}`} zone={z} suggestion={i === above.length - 1 ? longS : undefined} />
          ))}
          <div className="flex items-center gap-2 text-[11px] text-accent">
            <span className="h-px flex-1 bg-accent/50" />
            <span className="font-mono tabular">Kurs {fmt(price)}</span>
            <span className="h-px flex-1 bg-accent/50" />
          </div>
          {below.map((z, i) => (
            <ZoneBox key={`b${z.price}`} zone={z} suggestion={i === 0 ? shortS : undefined} />
          ))}
        </div>
      )}
    </StepCard>
  );
}
