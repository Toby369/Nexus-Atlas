// Gemeinsame Formatierungs-Helfer der Preis-Kacheln (OiChangeCard,
// FundingRateCard) und des Lagebilds -- State/Polling siehe
// components/LivePriceDataProvider.tsx.

export function formatUsd(value: number | null, decimals = 2): string {
  if (value === null || Number.isNaN(value)) return "—";
  return value.toLocaleString("de-CH", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(4)}%`;
}

export function formatSignedPct(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`;
}

// Fuer Chart-Achsenbeschriftungen -- Recharts' ResponsiveContainer rendert
// seine Kinder erst nach dem Mount (braucht die gemessene Breite/Hoehe),
// darum ist auch dieser Text nie Teil des SSR-Outputs. formatAxisTime von
// TimeSeriesChart erwartet eine reine (string) => string Funktion, keine
// Komponente.
export function clockTimeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit" });
}
