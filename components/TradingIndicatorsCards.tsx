"use client";

import type {
  CvdFootprintData,
  GussSignalData,
  GussVariantData,
  VwapVectorData,
  VwapEmaFan,
} from "@/lib/tradingIndicatorsContext";
import PanelInfo from "@/components/PanelInfo";
import { cvdFootprintInfo, gussSignalInfo, vwapVectorInfo } from "@/lib/panelInfo";

// UI-Karten fuer Tobys eigene Trading-Indikatoren (GUSS/VWAP-Vector/CVD --
// Umsetzungsplan "Exakte Faktoren"). Ausgelagert aus LernenDashboard.tsx
// (bereits 800+ Zeilen), gleicher Anzeige-Stil wie MeinSystemLiveValues
// dort (flex justify-between-Zeilen, Farbcodierung).

function formatPrice(value: number | null): string {
  return value === null ? "—" : value.toFixed(0);
}

function triStateBadge(value: boolean | null, trueLabel: string, falseLabel: string): { text: string; className: string } {
  if (value === null) return { text: "—", className: "text-text-faint" };
  return value
    ? { text: trueLabel, className: "text-up" }
    : { text: falseLabel, className: "text-down" };
}

function GussVariantRow({ variant }: { variant: GussVariantData }) {
  const touched = triStateBadge(variant.pullbackTouchedEma, "berührt", "nicht berührt");
  const clean = triStateBadge(variant.pullbackClean, "sauber", "gestört");
  const trendLabel =
    variant.trendDirection === "up" ? "Aufwärts" : variant.trendDirection === "down" ? "Abwärts" : "—";

  return (
    <div className="rounded-md border border-border/60 p-2 space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">EMA{variant.emaPeriod}</span>
        <span className="text-text">
          {formatPrice(variant.emaValue)} · Trend {trendLabel}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">Pullback</span>
        <span>
          <span className={touched.className}>{touched.text}</span>
          {" / "}
          <span className={clean.className}>{clean.text}</span>
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">GUSS aktiv</span>
        <span
          className={
            variant.active === null
              ? "text-text-faint"
              : variant.active
                ? "text-up font-medium"
                : "text-text-muted"
          }
        >
          {variant.active === null ? "—" : variant.active ? "✓ Ja" : "Nein"}
        </span>
      </div>
    </div>
  );
}

export function GussSignalCard({ data }: { data: GussSignalData }) {
  const regimeSuppressed = data.regimeAllowsGuss === false;

  return (
    <div
      className={`rounded-lg border border-border bg-surface-raised p-3 space-y-2 ${
        regimeSuppressed ? "opacity-60" : ""
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-medium text-text-muted">
            GUSS-Signal ({data.interval}){data.dataAsOf && <span className="text-text-faint"> · Stand Kerzen</span>}
          </p>
          <PanelInfo title="GUSS-Signal" content={gussSignalInfo} />
        </div>
        <span className="text-xs text-text-faint">Preis {formatPrice(data.closePrice)}</span>
      </div>

      {data.regimeAllowsGuss === null && (
        <p className="text-xs text-text-faint">Kein Regime-Wert verfügbar — GUSS-Anwendbarkeit unbekannt.</p>
      )}
      {regimeSuppressed && (
        <p className="text-xs text-down">
          Nexus stuft den Markt aktuell als Seitwärts/kein klares Regime ein — GUSS nicht anwendbar.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 items-start">
        {data.variants.map((variant) => (
          <GussVariantRow key={variant.emaPeriod} variant={variant} />
        ))}
      </div>
    </div>
  );
}

function VwapRow({ label, value, anchorUtc }: { label: string; value: number | null; anchorUtc?: string | null }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-faint">
        {label}
        {anchorUtc && (
          <span className="text-text-faint/70">
            {" "}
            (seit {new Date(anchorUtc).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })})
          </span>
        )}
      </span>
      <span className="text-text">{formatPrice(value)}</span>
    </div>
  );
}

function EmaFanRow({ fan }: { fan: VwapEmaFan }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-faint">EMA-Fächer ({fan.interval})</span>
      <span className="text-text">
        {formatPrice(fan.ema20)} / {formatPrice(fan.ema50)} / {formatPrice(fan.ema100)} / {formatPrice(fan.ema200)} /{" "}
        {formatPrice(fan.ema800)}
      </span>
    </div>
  );
}

export function VwapVectorCard({ data }: { data: VwapVectorData }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-medium text-text-muted">VWAP-Vector (1H)</p>
          <PanelInfo title="VWAP-Vector" content={vwapVectorInfo} />
        </div>
        <span className="text-xs text-text-faint">Preis {formatPrice(data.currentPrice)}</span>
      </div>

      <div className="space-y-1">
        <VwapRow label="Tag-VWAP" value={data.dayVwap} />
        <VwapRow label="Wochen-VWAP" value={data.weeklyVwap} anchorUtc={data.weeklyAnchorUtc} />
        <VwapRow label="Monats-VWAP" value={data.monthlyVwap} anchorUtc={data.monthlyAnchorUtc} />
        <VwapRow label="Swing-Hoch-VWAP" value={data.swingHighVwap} anchorUtc={data.swingHighAnchorUtc} />
        <VwapRow label="Swing-Tief-VWAP" value={data.swingLowVwap} anchorUtc={data.swingLowAnchorUtc} />
      </div>

      <div className="space-y-1 pt-1 border-t border-border/60">
        {data.emaFans.map((fan) => (
          <EmaFanRow key={fan.interval} fan={fan} />
        ))}
      </div>

      {data.fibLevels && (
        <div className="space-y-1 pt-1 border-t border-border/60">
          <p className="text-[10px] uppercase tracking-[0.12em] text-text-faint">Fibonacci-Retracement</p>
          {data.fibLevels.map((level) => (
            <div key={level.ratio} className="flex items-center justify-between text-xs">
              <span className="text-text-faint">{(level.ratio * 100).toFixed(1)}%</span>
              <span className="text-text">{formatPrice(level.price)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatDelta(value: number | null): string {
  if (value === null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toFixed(2)}`;
}

const CVD_TREND_LABEL: Record<"rising" | "falling" | "flat", string> = {
  rising: "steigend",
  falling: "fallend",
  flat: "seitwärts",
};

const CVD_TREND_CLASS: Record<"rising" | "falling" | "flat", string> = {
  rising: "text-up",
  falling: "text-down",
  flat: "text-text-faint",
};

export function CvdFootprintCard({ data }: { data: CvdFootprintData }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <p className="text-xs font-medium text-text-muted">CVD-Footprint ({data.higherTf})</p>
          <PanelInfo title="CVD-Footprint" content={cvdFootprintInfo} />
        </div>
      </div>

      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">Delta (letzte Kerze)</span>
        <span className={data.latestDelta === null ? "text-text-faint" : data.latestDelta >= 0 ? "text-up" : "text-down"}>
          {formatDelta(data.latestDelta)}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">Kumulativ (Fenster)</span>
        <span className={data.latestCumulative === null ? "text-text-faint" : data.latestCumulative >= 0 ? "text-up" : "text-down"}>
          {formatDelta(data.latestCumulative)}
        </span>
      </div>
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-faint">Trend</span>
        <span className={data.trend === null ? "text-text-faint" : CVD_TREND_CLASS[data.trend]}>
          {data.trend === null ? "—" : CVD_TREND_LABEL[data.trend]}
        </span>
      </div>

      {data.divergence && (
        <div
          className={`rounded-md border p-2 text-xs ${
            data.divergence.type === "bearish" ? "border-down/40 bg-down/10 text-down" : "border-up/40 bg-up/10 text-up"
          }`}
        >
          {data.divergence.type === "bearish" ? "Bärische" : "Bullische"} CVD-Divergenz seit{" "}
          {new Date(data.divergence.atOpenTime).toLocaleDateString("de-CH", { day: "2-digit", month: "2-digit" })} —
          Interpretationshilfe, kein Handelssignal.
        </div>
      )}
    </div>
  );
}
