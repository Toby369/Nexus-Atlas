"use client";

import type { ChartStructureData } from "@/lib/chartStructureContext";
import PanelInfo from "@/components/PanelInfo";
import { chartStructureInfo } from "@/lib/panelInfo";

// UI-Karte fuer "Struktur: Key Levels, AVWAP, Trendlinien, Muster"
// (Nutzer-Idee 24.09.2026) -- gleicher Anzeige-Stil wie GussSignalCard/
// VwapVectorCard/CvdFootprintCard in TradingIndicatorsCards.tsx, hier
// ausgelagert, da die vier Struktur-Bausteine thematisch eigenstaendig
// sind und die Datei sonst zu unuebersichtlich wuerde.

function formatPrice(value: number): string {
  return `$${value.toLocaleString("de-CH", { maximumFractionDigits: 0 })}`;
}

function PatternRow({ event }: { event: ChartStructureData["candlestickPatterns"][number] }) {
  const label = event.patternName.replace(/_/g, " ");
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-faint capitalize">{label}</span>
      <span className={event.direction === "BULLISH" ? "text-up" : "text-down"}>
        {event.direction === "BULLISH" ? "Bullisch" : "Bärisch"}
      </span>
    </div>
  );
}

function AvwapRow({ level }: { level: ChartStructureData["avwapPivotLevels"][number] }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-faint">
        {level.side === "resistance" ? "Widerstand" : "Unterstützung"} (seit{" "}
        {new Date(level.anchorOpenTime).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })})
      </span>
      <span className={level.side === "resistance" ? "text-down" : "text-up"}>{formatPrice(level.value)}</span>
    </div>
  );
}

function TrendlineRow({ line }: { line: ChartStructureData["trendlines"][number] }) {
  return (
    <div className="rounded-md border border-border/60 p-2 space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">{line.direction === "up" ? "Aufwärtslinie" : "Abwärtslinie"}</span>
        <span className={line.direction === "up" ? "text-up" : "text-down"}>{formatPrice(line.currentValue)}</span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">{line.touchCount} Berührungspunkte</span>
        <span className={line.confirmed ? "text-text" : "text-text-faint"}>
          {line.confirmed ? "Bestätigt" : "Unbestätigt"}
        </span>
      </div>
    </div>
  );
}

function KeyLevelRow({ level }: { level: ChartStructureData["keyLevels"][number] }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-faint">{level.label}</span>
      <span className="text-text">
        {formatPrice(level.price)} · {level.eventCount} Events
      </span>
    </div>
  );
}

export default function ChartStructureCard({ data }: { data: ChartStructureData }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-medium text-text-muted">Struktur: Key Levels, AVWAP, Trendlinien, Muster</p>
          <PanelInfo title="Struktur: Key Levels, AVWAP, Trendlinien, Muster" content={chartStructureInfo} />
        </div>
        {data.currentPrice !== null && <span className="text-xs text-text-faint">Preis {formatPrice(data.currentPrice)}</span>}
      </div>

      <div className="space-y-1">
        <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Kerzenmuster</p>
        {data.candlestickPatterns.length > 0 ? (
          data.candlestickPatterns.map((event, i) => <PatternRow key={`${event.candleOpenTime}-${i}`} event={event} />)
        ) : (
          <p className="text-xs text-text-faint">Keine erkannten Muster in den letzten Kerzen.</p>
        )}
      </div>

      <div className="space-y-1 pt-1 border-t border-border/60">
        <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">AVWAP-Pivot (aktive Linien)</p>
        {data.avwapPivotLevels.length > 0 ? (
          data.avwapPivotLevels.map((level, i) => <AvwapRow key={`${level.anchorOpenTime}-${level.side}-${i}`} level={level} />)
        ) : (
          <p className="text-xs text-text-faint">Keine aktiven AVWAP-Pivot-Linien.</p>
        )}
      </div>

      <div className="space-y-1.5 pt-1 border-t border-border/60">
        <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Trendlinien</p>
        {data.trendlines.length > 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
            {data.trendlines.map((line) => (
              <TrendlineRow key={line.direction} line={line} />
            ))}
          </div>
        ) : (
          <p className="text-xs text-text-faint">Keine ausreichenden Schwenkpunkte für eine Trendlinie.</p>
        )}
      </div>

      <div className="space-y-1 pt-1 border-t border-border/60">
        <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Key Levels (Liquidations-Cluster)</p>
        {data.keyLevels.length > 0 ? (
          data.keyLevels.map((level, i) => <KeyLevelRow key={`${level.price}-${i}`} level={level} />)
        ) : (
          <p className="text-xs text-text-faint">Keine Liquidations-Cluster im Zeitfenster.</p>
        )}
      </div>
    </div>
  );
}
