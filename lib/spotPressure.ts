// Regelbasierte Spot-Buying/Selling-Pressure-Einordnung (keine KI). Reine
// Schwellenwert-Logik auf dem bereits berechneten Netto-Taker-Flow% aus
// SpotPressurePanel/MarketContextCard -- kein neuer Datenpfad, nur eine
// explizite Verdikt-Kategorie statt nur der Rohzahl.
//
// Der Verdikt-Wert und der Data-Quality-Status sind bewusst als englische
// Grossbuchstaben-Tokens gehalten (BUYING PRESSURE / SELLING PRESSURE /
// NEUTRAL / INSUFFICIENT DATA, OK / PRELIMINARY / INSUFFICIENT) -- das sind
// die Werte, die spaeter unveraendert an eine AI-Auswertung uebergeben
// werden sollen (siehe Vorgabe Teil Q/T), sie sollen also nicht als
// deutscher Freitext existieren.

export type SpotPressureVerdict =
  | "BUYING_PRESSURE"
  | "SELLING_PRESSURE"
  | "NEUTRAL"
  | "INSUFFICIENT_DATA";

export type DataQuality = "OK" | "PRELIMINARY" | "INSUFFICIENT";

const FLAT_THRESHOLD_PCT = 5;
// Unter dieser Abdeckung ist die Stichprobe zu duenn fuer irgendeine
// Aussage -- der Verdikt wird unabhaengig vom Zahlenwert INSUFFICIENT_DATA.
const INSUFFICIENT_COVERAGE_RATIO = 0.2;
// Zwischen INSUFFICIENT und dieser Schwelle: Verdikt wird zwar berechnet,
// aber als PRELIMINARY gekennzeichnet (Basis noch nicht vollstaendig).
const PRELIMINARY_COVERAGE_RATIO = 0.8;

export interface SpotPressureInput {
  netFlowPct: number | null;
  candleCount: number;
  expectedCandles: number;
}

export interface SpotPressureResult {
  verdict: SpotPressureVerdict;
  label: string;
  dataQuality: DataQuality;
  coverageRatio: number;
}

export function classifySpotPressure({
  netFlowPct,
  candleCount,
  expectedCandles,
}: SpotPressureInput): SpotPressureResult {
  const coverageRatio = expectedCandles > 0 ? candleCount / expectedCandles : 0;
  const dataQuality: DataQuality =
    coverageRatio >= PRELIMINARY_COVERAGE_RATIO
      ? "OK"
      : coverageRatio >= INSUFFICIENT_COVERAGE_RATIO
      ? "PRELIMINARY"
      : "INSUFFICIENT";

  if (candleCount === 0 || netFlowPct === null || dataQuality === "INSUFFICIENT") {
    return {
      verdict: "INSUFFICIENT_DATA",
      label: "INSUFFICIENT DATA",
      dataQuality,
      coverageRatio,
    };
  }

  if (netFlowPct > FLAT_THRESHOLD_PCT) {
    return { verdict: "BUYING_PRESSURE", label: "BUYING PRESSURE", dataQuality, coverageRatio };
  }
  if (netFlowPct < -FLAT_THRESHOLD_PCT) {
    return { verdict: "SELLING_PRESSURE", label: "SELLING PRESSURE", dataQuality, coverageRatio };
  }
  return { verdict: "NEUTRAL", label: "NEUTRAL", dataQuality, coverageRatio };
}
