"use client";

import { useLivePriceData } from "@/components/LivePriceDataProvider";
import PanelInfo from "@/components/PanelInfo";
import { zonesInfo } from "@/lib/panelInfo";
import { nearestZones, type ZoneRow } from "@/lib/zones";
import { computeTpSuggestions, type TpSuggestion } from "@/lib/tpStandard";
import type { FourHourBreakout } from "@/lib/fourHourBreakout";

// Zonen-Kachel (Schritt 2 im Dashboard, Toby 22.10.2026): naechste
// Verkaeufer-Zone ueber und Kaeufer-Zone unter dem Live-Kurs, mit Abstand,
// Chance-Risiko (SL 0,5 % Kurs) und TP-Standard; dazu die Frage, ob die
// letzte 4H-Kerze ein Level mit dem Koerper gebrochen hat.
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

function breakoutAnswer(b: FourHourBreakout): { text: string; tone: string } {
  if (!b.candle) return { text: "Keine Daten", tone: "bg-surface-raised text-text-muted" };
  const lvl = b.level !== null ? fmt(b.level) : "";
  switch (b.kind) {
    case "body_above":
      return { text: `Ja, Körper über ${lvl}`, tone: "bg-up/15 text-up" };
    case "body_below":
      return { text: `Ja, Körper unter ${lvl}`, tone: "bg-down/15 text-down" };
    case "wick_above":
      return { text: `Nur Docht über ${lvl}`, tone: "bg-warn/15 text-warn" };
    case "wick_below":
      return { text: `Nur Docht unter ${lvl}`, tone: "bg-warn/15 text-warn" };
    default:
      return { text: "Nein", tone: "bg-surface-raised text-text-muted" };
  }
}

export default function ZonesCard({
  keyLevels,
  breakout,
  dailyTrend,
}: {
  keyLevels: { price: number; side: "resistance" | "support" }[];
  breakout: FourHourBreakout;
  dailyTrend: "bullish" | "bearish" | null;
}) {
  const { latest } = useLivePriceData();
  const price = latest?.last_price ?? null;
  const { above, below } = nearestZones(keyLevels, price);
  const [longS, shortS] = computeTpSuggestions(keyLevels, price, dailyTrend);
  const answer = breakoutAnswer(breakout);
  const candleTime = breakout.candle
    ? new Intl.DateTimeFormat("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(
        new Date(breakout.candle.openTime)
      )
    : null;

  return (
    <section className="rounded-lg border border-border bg-surface p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <h2 className="text-[11px] uppercase tracking-[0.14em] text-text-faint">
            <span className="font-mono text-accent">2</span> · Zonen
          </h2>
          <PanelInfo title="Zonen" content={zonesInfo} />
        </span>
        <span className="text-[11px] text-text-faint">Keylevels · SL 0,5 %</span>
      </div>

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

      <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-2 text-xs">
        <span className="text-text-muted">
          Hat die letzte 4H-Kerze{candleTime ? ` (${candleTime} Uhr)` : ""} ein Level mit dem <b className="text-text">Körper</b>{" "}
          gebrochen?
        </span>
        <span className={`shrink-0 rounded px-2 py-0.5 font-semibold ${answer.tone}`}>{answer.text}</span>
      </div>
    </section>
  );
}
