import { describe, expect, it } from "vitest";
import {
  computeAvwapPivotLevels,
  computeTrendlines,
  detectCandlestickPatterns,
  fitTrendline,
  type OhlcvCandle,
} from "./chartStructureContext";

function flatCandle(openTime: string, price: number, volume = 1): OhlcvCandle {
  return { openTime, open: price, high: price, low: price, close: price, volume };
}

describe("detectCandlestickPatterns", () => {
  // Gemeinsamer Praefix fuer prior_trend='down' (close[i-1] < close[i-7]):
  // 7 Kerzen mit fallenden Closes, danach folgt jeweils die Testkerze.
  const downtrendPrefix: OhlcvCandle[] = [110, 108, 106, 104, 102, 100, 98].map((p, i) =>
    flatCandle(`p${i}`, p)
  );

  it("erkennt einen Hammer nach einem Abwaertstrend als BULLISH", () => {
    const candles = [
      ...downtrendPrefix,
      { openTime: "hammer", open: 98, high: 98.5, low: 90, close: 98.3, volume: 1 },
    ];
    const events = detectCandlestickPatterns(candles);
    expect(events).toContainEqual({ candleOpenTime: "hammer", patternName: "hammer", direction: "BULLISH" });
  });

  it("erkennt einen Doji nach einem Abwaertstrend als BULLISH", () => {
    const candles = [
      ...downtrendPrefix,
      { openTime: "doji", open: 98, high: 99, low: 97, close: 98.05, volume: 1 },
    ];
    const events = detectCandlestickPatterns(candles);
    expect(events).toContainEqual({ candleOpenTime: "doji", patternName: "doji", direction: "BULLISH" });
  });

  it("erkennt ein Bullish Engulfing unabhaengig vom prior_trend", () => {
    const candles: OhlcvCandle[] = [
      { openTime: "c0", open: 110, high: 111, low: 98, close: 100 }, // bearisch
      { openTime: "c1", open: 99, high: 112, low: 98, close: 111 }, // umschliesst c0
    ].map((c) => ({ ...c, volume: 1 }));
    const events = detectCandlestickPatterns(candles);
    expect(events).toContainEqual({ candleOpenTime: "c1", patternName: "bullish_engulfing", direction: "BULLISH" });
  });

  it("erkennt kein Muster in einer vollstaendig flachen Serie", () => {
    const candles = Array.from({ length: 10 }, (_, i) => flatCandle(`f${i}`, 100));
    expect(detectCandlestickPatterns(candles)).toEqual([]);
  });
});

describe("computeAvwapPivotLevels", () => {
  it("haelt eine Support-Linie aktiv, solange der Kurs sie nie unterschreitet", () => {
    // Pivot-Tief bei Index 3 (Close 90, umgeben von jeweils 3 hoeheren
    // Closes) -- bei Pivot-Laenge 3 revealed bei Index 6.
    const prices = [100, 99, 98, 90, 98, 99, 100, 100, 100, 100, 100];
    const candles = prices.map((p, i) => flatCandle(`c${i}`, p));

    const levels = computeAvwapPivotLevels(candles);
    expect(levels).toHaveLength(1);
    expect(levels[0].side).toBe("support");
    expect(levels[0].anchorOpenTime).toBe("c3");
    expect(levels[0].value).toBeCloseTo(98.375, 3);
  });

  it("invalidiert eine Support-Linie, sobald der Schlusskurs sie unterschreitet", () => {
    const prices = [100, 99, 98, 90, 98, 99, 100, 100, 100, 100, 100, 90];
    const candles = prices.map((p, i) => flatCandle(`c${i}`, p));

    expect(computeAvwapPivotLevels(candles)).toEqual([]);
  });

  it("liefert leere Liste bei zu kurzer Kerzenserie", () => {
    const candles = [flatCandle("a", 100), flatCandle("b", 101)];
    expect(computeAvwapPivotLevels(candles)).toEqual([]);
  });
});

describe("fitTrendline", () => {
  const candles = Array.from({ length: 10 }, (_, i) => flatCandle(`t${i}`, 0));

  it("erkennt eine bestaetigte Linie, wenn alle Punkte exakt darauf liegen", () => {
    const points = [
      { index: 1, value: 100 },
      { index: 3, value: 102 },
      { index: 5, value: 104 },
      { index: 7, value: 106 },
    ];
    const line = fitTrendline(points, "up", candles);
    expect(line).not.toBeNull();
    expect(line!.touchCount).toBe(4);
    expect(line!.confirmed).toBe(true);
    expect(line!.currentValue).toBeCloseTo(108, 6); // Index 9 (letzte Kerze), Steigung 1
  });

  it("markiert die Linie als unbestaetigt, wenn weniger als 3 Punkte treffen", () => {
    const points = [
      { index: 1, value: 100 },
      { index: 7, value: 106 }, // definiert die Linie (Steigung 1)
      { index: 4, value: 50 }, // liegt weit daneben
    ];
    const line = fitTrendline(points, "up", candles);
    expect(line).not.toBeNull();
    expect(line!.touchCount).toBe(2);
    expect(line!.confirmed).toBe(false);
  });

  it("liefert null bei weniger als zwei Punkten", () => {
    expect(fitTrendline([{ index: 1, value: 100 }], "up", candles)).toBeNull();
  });
});

describe("computeTrendlines", () => {
  it("liefert leere Liste, wenn die Kerzenserie kuerzer als das Swing-Fenster ist", () => {
    const candles = Array.from({ length: 10 }, (_, i) => flatCandle(`s${i}`, 100));
    expect(computeTrendlines(candles)).toEqual([]);
  });

  it("liefert leere Liste bei nur einem einzelnen Swing-Tief (mind. zwei fuer eine Linie noetig)", () => {
    // Perfektes, isoliertes "V": streng monoton fallend bis Index 30,
    // danach streng monoton steigend -- exakt ein Swing-Tief bei Index 30,
    // kein Swing-Hoch (Lookback 20 bequem erfuellt, keine weiteren
    // Extrempunkte im ausgewerteten Bereich [20, 41)).
    const candles = Array.from({ length: 61 }, (_, i) => flatCandle(`v${i}`, 130 - Math.abs(i - 30)));
    expect(computeTrendlines(candles)).toEqual([]);
  });
});
