// Zentrale Zeitraum-Definition fuer OI-Change/BTC-Change/Price-OI-Chart.
// Einzige Quelle der Wahrheit fuer die Selector-Optionen, damit Berechnung,
// Chart und Anzeige nie auseinanderlaufen koennen.

export type TimeframeId = "15M" | "1H" | "4H" | "24H" | "1W" | "1M";

export interface TimeframeOption {
  id: TimeframeId;
  label: string;
  minutes: number;
}

export const TIMEFRAMES: TimeframeOption[] = [
  { id: "15M", label: "15M", minutes: 15 },
  { id: "1H", label: "1H", minutes: 60 },
  { id: "4H", label: "4H", minutes: 4 * 60 },
  { id: "24H", label: "24H", minutes: 24 * 60 },
  { id: "1W", label: "1W", minutes: 7 * 24 * 60 },
  { id: "1M", label: "1M", minutes: 30 * 24 * 60 },
];

export const DEFAULT_TIMEFRAME: TimeframeId = "4H";

export function getTimeframe(id: TimeframeId): TimeframeOption {
  const tf = TIMEFRAMES.find((t) => t.id === id);
  if (!tf) throw new Error(`Unbekannter Zeitraum: ${id}`);
  return tf;
}
