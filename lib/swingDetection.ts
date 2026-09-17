// Geteilte Swing-/Pivot-Primitive fuer Tobys eigene Trading-Indikatoren
// (GUSS, VWAP-Vector, CVD-Divergenz -- Umsetzungsplan "Exakte Faktoren",
// Phase 0). TS-Port der fraktalen Swing-Erkennung + EMA-Serienberechnung aus
// der collect-candles-Edge-Function (computeMarketStructure()/emaSeries()),
// NICHT importiert -- Edge Functions in diesem Projekt sind self-contained
// (jede index.ts fuehrt ihre eigenen Kopien der Helper, kein Cross-Runtime-
// Import zwischen Deno und Next.js moeglich).
//
// WICHTIG: Dies ist eine BEWUSST ZWEITE, GETRENNTE Swing-Definition neben
// market_features.swing_type/bos/choch (dort SWING_LOOKBACK=5, fest in
// collect-candles verdrahtet, Grundlage fuer get_anchored_vwap_summary()'s
// swing_vwap). Toby's eigene Indikatoren (Mo's VWAP Vector: swingPivLen=20,
// Mo's CVD-Divergenz: divLb=10) nutzen andere Lookbacks als Nexus' eigene
// Struktur-Faktoren -- die beiden Serien duerfen nicht verwechselt werden,
// sie beantworten unterschiedliche Fragen mit unterschiedlicher Empfindlichkeit.

export type FractalSwingType = "HH" | "HL" | "LH" | "LL";
export type StructureTrend = "bullish" | "bearish" | "ranging";

export interface FractalSwingResult {
  swingType: (FractalSwingType | null)[];
  isSwingHigh: boolean[];
  isSwingLow: boolean[];
  structureTrend: StructureTrend[];
}

// Fraktale Swing-Erkennung: ein Hoch/Tief bei Index i gilt als bestaetigt,
// wenn es hoeher/tiefer ist als jede der `lookback` Kerzen davor UND danach
// (symmetrisches Fenster, Standard-Fraktal-Definition -- identische Logik
// wie computeMarketStructure() in collect-candles, hier mit variablem
// lookback statt fest 5). HH/HL/LH/LL-Klassifikation + daraus abgeleiteter
// Trend, exakt wie im Original: ein neues Swing-Hoch ist HH (hoeher als das
// vorherige Swing-Hoch) oder LH, ein neues Swing-Tief ist HL oder LL.
export function detectFractalSwings(highs: number[], lows: number[], lookback: number): FractalSwingResult {
  const n = highs.length;
  const swingType: (FractalSwingType | null)[] = new Array(n).fill(null);
  const isSwingHigh: boolean[] = new Array(n).fill(false);
  const isSwingLow: boolean[] = new Array(n).fill(false);
  const structureTrend: StructureTrend[] = new Array(n).fill("ranging");

  for (let i = lookback; i < n - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (highs[j] >= highs[i]) isHigh = false;
      if (lows[j] <= lows[i]) isLow = false;
    }
    isSwingHigh[i] = isHigh;
    isSwingLow[i] = isLow;
  }

  let lastSwingHighPrice: number | null = null;
  let lastSwingLowPrice: number | null = null;
  let trend: StructureTrend = "ranging";

  for (let i = 0; i < n; i++) {
    if (isSwingHigh[i]) {
      if (lastSwingHighPrice !== null) {
        swingType[i] = highs[i] > lastSwingHighPrice ? "HH" : "LH";
      }
      lastSwingHighPrice = highs[i];
    } else if (isSwingLow[i]) {
      if (lastSwingLowPrice !== null) {
        swingType[i] = lows[i] > lastSwingLowPrice ? "HL" : "LL";
      }
      lastSwingLowPrice = lows[i];
    }

    if (swingType[i] === "HH" || swingType[i] === "HL") trend = "bullish";
    else if (swingType[i] === "LH" || swingType[i] === "LL") trend = "bearish";

    structureTrend[i] = trend;
  }

  return { swingType, isSwingHigh, isSwingLow, structureTrend };
}

export interface PivotPoint {
  index: number;
  kind: "high" | "low";
  value: number;
}

// Generischer Einzelserien-Pivot-Detektor (Pine Script ta.pivothigh()/
// ta.pivotlow()-Aequivalent): der Wert bei Index i ist ein Pivot-Hoch, wenn
// er strikt groesser ist als jeder andere Wert im symmetrischen Fenster
// [i-lookback, i+lookback], analog fuer Pivot-Tief. Anders als
// detectFractalSwings() (das getrennte High-/Low-Serien braucht) arbeitet
// dies auf EINER Werteserie -- fuer CVD-Divergenz wird dieselbe Funktion
// sowohl auf Preis-Closes als auch auf dem kumulativen CVD aufgerufen.
export function findPivots(values: number[], lookback: number): PivotPoint[] {
  const n = values.length;
  const pivots: PivotPoint[] = [];

  for (let i = lookback; i < n - lookback; i++) {
    let isHigh = true;
    let isLow = true;
    for (let j = i - lookback; j <= i + lookback; j++) {
      if (j === i) continue;
      if (values[j] >= values[i]) isHigh = false;
      if (values[j] <= values[i]) isLow = false;
    }
    if (isHigh) pivots.push({ index: i, kind: "high", value: values[i] });
    else if (isLow) pivots.push({ index: i, kind: "low", value: values[i] });
  }

  return pivots;
}

// Voller EMA-Verlauf (nicht nur der Endwert wie computeEma() in
// meinSystemContext.ts) -- SMA-geseedet, Standard-Multiplikator 2/(period+1).
// Direkter Port von emaSeries() aus collect-candles. Wird u.a. fuer GUSS'
// Wick-Touch-Pruefung gebraucht: der EMA-Wert bewegt sich waehrend eines
// mehrere Kerzen umfassenden Pullbacks, ein einzelner Endwert (computeEma())
// wuerde die Pruefung an frueheren Kerzen des Segments verfaelschen.
export function emaSeries(values: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let ema: number | null = null;
  const seedBuffer: number[] = [];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (ema === null) {
      seedBuffer.push(v);
      if (seedBuffer.length === period) {
        ema = seedBuffer.reduce((a, b) => a + b, 0) / period;
        out[i] = ema;
      }
    } else {
      ema = v * k + ema * (1 - k);
      out[i] = ema;
    }
  }
  return out;
}
