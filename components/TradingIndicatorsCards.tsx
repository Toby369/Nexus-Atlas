"use client";

import type { GussSignalData, GussVariantData } from "@/lib/tradingIndicatorsContext";
import PanelInfo from "@/components/PanelInfo";
import { gussSignalInfo } from "@/lib/panelInfo";

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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {data.variants.map((variant) => (
          <GussVariantRow key={variant.emaPeriod} variant={variant} />
        ))}
      </div>
    </div>
  );
}
