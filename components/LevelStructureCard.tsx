"use client";

import type { LevelStructureZone } from "@/lib/levelStructureContext";
import PanelInfo from "@/components/PanelInfo";
import { levelStructureInfo } from "@/lib/panelInfo";

// Level-Struktur-Kachel (Nutzer-Wunsch 03.10.2026, siehe lib/
// levelStructureContext.ts fuer die Herleitung und Kommentare). Zeigt je
// Zone genau das Narrativ, das Toby manuell am Mai-Pivot nachvollzogen hat:
// "haelt die Zone noch (keine hoeheren Hochs/tieferen Tiefs dagegen)" oder
// "gebrochen, seitdem keine Gegenbewegung mehr" -- inkl. ehrlicher
// Gegentests (wie dem 28.9.-Dip), Konfluenz-Stufe (Key-Level +EMA50/
// +Swing-VWAP) und dem Abgleich mit anderen aktuellen Nexus-Signalen.

function formatPrice(value: number): string {
  return `$${value.toLocaleString("de-CH", { maximumFractionDigits: 0 })}`;
}

const TIER_LABEL: Record<1 | 2 | 3, string> = {
  1: "Schwach",
  2: "Mittel",
  3: "Stark",
};

function TierBadge({ tier, label }: { tier: 1 | 2 | 3; label: string }) {
  const style =
    tier === 3
      ? "border-accent/50 bg-accent/15 text-accent"
      : tier === 2
        ? "border-border bg-surface-raised text-text-muted"
        : "border-border/60 bg-surface text-text-faint";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${style}`} title={label}>
      {TIER_LABEL[tier]} ({label})
    </span>
  );
}

function ZoneRow({ zone }: { zone: LevelStructureZone }) {
  const phaseLabel = zone.phase === "respecting" ? (zone.side === "resistance" ? "Widerstand hält" : "Unterstützung hält") : "Gebrochen";
  const phaseColor = zone.phase === "respecting" ? (zone.side === "resistance" ? "text-down" : "text-up") : "text-accent";

  return (
    <div className="rounded-md border border-border/60 p-2.5 space-y-1.5">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className={zone.side === "resistance" ? "text-down font-medium" : "text-up font-medium"}>
          {formatPrice(zone.price)}
        </span>
        <span className={`text-xs ${phaseColor}`}>{phaseLabel}</span>
      </div>
      <p className="text-xs text-text-muted leading-relaxed">{zone.narrative}</p>
      <div className="flex items-center gap-1.5 flex-wrap">
        <TierBadge tier={zone.confluenceTier} label={zone.confluenceLabel} />
        {zone.signalTally.entries.length > 0 && (
          <span className="text-[10px] text-text-faint">
            Andere Signale: {zone.signalTally.bullish} bullisch / {zone.signalTally.bearish} bärisch
            {zone.signalTally.neutral > 0 && ` / ${zone.signalTally.neutral} neutral`}
          </span>
        )}
      </div>
    </div>
  );
}

export default function LevelStructureCard({ zones }: { zones: LevelStructureZone[] }) {
  const resistances = zones.filter((z) => z.side === "resistance");
  const supports = zones.filter((z) => z.side === "support");

  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3 space-y-3">
      <div className="flex items-center gap-1.5">
        <p className="text-xs font-medium text-text-muted">Level-Struktur</p>
        <PanelInfo title="Level-Struktur" content={levelStructureInfo} />
      </div>

      {zones.length === 0 ? (
        <p className="text-xs text-text-faint">Keine Key Levels mit Pivot-Anker im aktuellen Fenster.</p>
      ) : (
        <>
          {resistances.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Widerstand</p>
              {resistances.map((z, i) => (
                <ZoneRow key={`r-${z.price}-${i}`} zone={z} />
              ))}
            </div>
          )}
          {supports.length > 0 && (
            <div className="space-y-1.5 pt-1 border-t border-border/60">
              <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Unterstützung</p>
              {supports.map((z, i) => (
                <ZoneRow key={`s-${z.price}-${i}`} zone={z} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
