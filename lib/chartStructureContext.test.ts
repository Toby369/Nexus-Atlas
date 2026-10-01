import { describe, expect, it } from "vitest";
import {
  aggregateToWeekly,
  buildKeyLevelZones,
  classifyChannel,
  computeAvwapPivotLevels,
  computeSwingFormations,
  computeTimeframePivots,
  computeTrendlines,
  detectCandlestickPatterns,
  detectContinuationFormation,
  detectTriangle,
  fitTrendline,
  withConfirmationLevels,
  type ChartStructureData,
  type KeyLevel,
  type OhlcvCandle,
  type TrendlineLevel,
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

describe("computeSwingFormations", () => {
  const highPoints = [
    { index: 5, value: 100 },
    { index: 20, value: 101 },
  ];
  const lowPointBetween = [{ index: 12, value: 90 }];

  function candlesWithTailClose(tailClose: number): OhlcvCandle[] {
    return Array.from({ length: 25 }, (_, i) =>
      i >= 21 ? { ...flatCandle(`c${i}`, 100), close: tailClose } : flatCandle(`c${i}`, 100)
    );
  }

  it("erkennt ein bestaetigtes Double Top bei Nackenlinien-Bruch", () => {
    const candles = candlesWithTailClose(85); // unter der Nackenlinie (90)
    const formations = computeSwingFormations(candles, { lowPoints: lowPointBetween, highPoints });
    const doubleTop = formations.find((f) => f.type === "double_top");
    expect(doubleTop).toBeDefined();
    expect(doubleTop!.direction).toBe("BEARISH");
    expect(doubleTop!.necklineValue).toBe(90);
    expect(doubleTop!.confirmed).toBe(true);
  });

  it("markiert ein Double Top als unbestaetigt ohne Nackenlinien-Bruch", () => {
    const candles = candlesWithTailClose(95); // ueber der Nackenlinie
    const formations = computeSwingFormations(candles, { lowPoints: lowPointBetween, highPoints });
    const doubleTop = formations.find((f) => f.type === "double_top");
    expect(doubleTop).toBeDefined();
    expect(doubleTop!.confirmed).toBe(false);
  });

  it("erkennt kein Double Top, wenn die zwei Hochs zu unterschiedlich sind", () => {
    const candles = candlesWithTailClose(100);
    const farApartHighs = [
      { index: 5, value: 100 },
      { index: 20, value: 130 }, // 30% auseinander, ueber FORMATION_PEAK_TOLERANCE_PCT
    ];
    const formations = computeSwingFormations(candles, { lowPoints: lowPointBetween, highPoints: farApartHighs });
    expect(formations.find((f) => f.type === "double_top")).toBeUndefined();
  });

  it("erkennt ein bestaetigtes Kopf-Schulter-Muster bei Nackenlinien-Bruch", () => {
    const shoulderHighs = [
      { index: 5, value: 100 }, // linke Schulter
      { index: 15, value: 110 }, // Kopf, hoeher als beide Schultern
      { index: 25, value: 101 }, // rechte Schulter, aehnliche Hoehe wie links
    ];
    const necklines = [
      { index: 10, value: 95 }, // zwischen linker Schulter und Kopf
      { index: 20, value: 96 }, // zwischen Kopf und rechter Schulter
    ];
    const candles = Array.from({ length: 30 }, (_, i) =>
      i >= 26 ? { ...flatCandle(`h${i}`, 100), close: 90 } : flatCandle(`h${i}`, 100)
    );
    const formations = computeSwingFormations(candles, { lowPoints: necklines, highPoints: shoulderHighs });
    const hns = formations.find((f) => f.type === "head_and_shoulders");
    expect(hns).toBeDefined();
    expect(hns!.direction).toBe("BEARISH");
    expect(hns!.necklineValue).toBeCloseTo(95.5, 6);
    expect(hns!.confirmed).toBe(true);
  });
});

describe("detectTriangle", () => {
  const candles = Array.from({ length: 10 }, (_, i) => flatCandle(`t${i}`, 100));

  function line(direction: TrendlineLevel["direction"], v1: number, v2: number): TrendlineLevel {
    return {
      direction,
      touchCount: 2,
      confirmed: false,
      currentValue: 100,
      points: [
        { openTime: "t1", value: v1 },
        { openTime: "t5", value: v2 },
      ],
    };
  }

  it("erkennt ein symmetrisches Dreieck bei konvergierenden Linien", () => {
    const up = line("up", 90, 98); // steigt klar
    const down = line("down", 110, 102); // faellt klar
    const triangle = detectTriangle([up, down], candles);
    expect(triangle).not.toBeNull();
    expect(triangle!.type).toBe("symmetric");
  });

  it("erkennt ein steigendes Dreieck bei flacher Widerstandslinie", () => {
    const up = line("up", 90, 98); // steigt klar
    const down = line("down", 100, 100); // flach
    const triangle = detectTriangle([up, down], candles);
    expect(triangle).not.toBeNull();
    expect(triangle!.type).toBe("ascending");
  });

  it("liefert null ohne beide Linien", () => {
    expect(detectTriangle([line("up", 90, 98)], candles)).toBeNull();
    expect(detectTriangle([], candles)).toBeNull();
  });
});

describe("classifyChannel", () => {
  // 15 Kerzen (Index 0-14), Linien werden ueber Punkte bei Index 0 und 14
  // definiert -- currentValue entspricht dem Wert bei Index 14.
  const segment = Array.from({ length: 15 }, (_, i) => flatCandle(`s${i}`, 100));

  function channelLine(direction: TrendlineLevel["direction"], v0: number, v14: number): TrendlineLevel {
    return {
      direction,
      touchCount: 2,
      confirmed: false,
      currentValue: v14,
      points: [
        { openTime: "s0", value: v0 },
        { openTime: "s14", value: v14 },
      ],
    };
  }

  it("erkennt eine Flagge bei etwa gleichbleibender Kanalbreite", () => {
    const upper = channelLine("down", 132, 129);
    const lower = channelLine("up", 128, 125);
    expect(classifyChannel(upper, lower, segment)).toBe("flag");
  });

  it("erkennt einen Keil, wenn beide Linien gleichgerichtet konvergieren", () => {
    const upper = channelLine("down", 120, 135); // steigt
    const lower = channelLine("up", 100, 130); // steigt staerker -> Konvergenz
    expect(classifyChannel(upper, lower, segment)).toBe("wedge");
  });

  it("erkennt einen Wimpel, wenn die Linien gegenlaeufig konvergieren", () => {
    const upper = channelLine("down", 140, 128); // faellt
    const lower = channelLine("up", 110, 122); // steigt
    expect(classifyChannel(upper, lower, segment)).toBe("pennant");
  });

  it("liefert null bei einem sich weitenden (divergierenden) Kanal", () => {
    const upper = channelLine("down", 120, 140);
    const lower = channelLine("up", 110, 100);
    expect(classifyChannel(upper, lower, segment)).toBeNull();
  });
});

describe("detectContinuationFormation", () => {
  it("liefert null ohne einen ausreichend scharfen Flaggenmast", () => {
    // 75 Kerzen, durchgehend flach (kein Kursimpuls) -- Mindestbewegung des
    // Mastes (POLE_MIN_MOVE_RANGE_MULT * Durchschnittsspanne) wird nie erreicht.
    const candles = Array.from({ length: 75 }, (_, i) => ({
      openTime: `f${i}`,
      open: 100,
      high: 100.5,
      low: 99.5,
      close: 100,
      volume: 1,
    }));
    expect(detectContinuationFormation(candles)).toBeNull();
  });

  it("liefert null bei zu kurzer Kerzenserie", () => {
    const candles = Array.from({ length: 10 }, (_, i) => flatCandle(`k${i}`, 100));
    expect(detectContinuationFormation(candles)).toBeNull();
  });
});

describe("computeTimeframePivots", () => {
  it("erkennt ein bestaetigtes Pivot-Hoch/-Tief und taggt den Zeitrahmen", () => {
    const candles: OhlcvCandle[] = [
      { openTime: "c0", open: 100, high: 100, low: 95, close: 100, volume: 1 },
      { openTime: "c1", open: 100, high: 101, low: 96, close: 100, volume: 1 },
      { openTime: "c2", open: 100, high: 102, low: 97, close: 100, volume: 1 },
      { openTime: "c3", open: 100, high: 110, low: 90, close: 100, volume: 1 },
      { openTime: "c4", open: 100, high: 103, low: 98, close: 100, volume: 1 },
      { openTime: "c5", open: 100, high: 102, low: 97, close: 100, volume: 1 },
      { openTime: "c6", open: 100, high: 101, low: 96, close: 100, volume: 1 },
    ];
    const points = computeTimeframePivots(candles, "4h");
    expect(points).toHaveLength(2);
    expect(points.find((p) => p.kind === "high")).toEqual({
      timeframe: "4h",
      kind: "high",
      price: 110,
      openTime: "c3",
    });
    expect(points.find((p) => p.kind === "low")).toEqual({
      timeframe: "4h",
      kind: "low",
      price: 90,
      openTime: "c3",
    });
  });

  it("liefert leeres Array bei zu kurzer Kerzenserie", () => {
    const candles = Array.from({ length: 5 }, (_, i) => flatCandle(`k${i}`, 100));
    expect(computeTimeframePivots(candles, "1h")).toEqual([]);
  });
});

describe("aggregateToWeekly", () => {
  function dailyCandle(
    date: string,
    open: number,
    high: number,
    low: number,
    close: number,
    volume: number
  ): OhlcvCandle {
    return { openTime: `${date}T00:00:00.000Z`, open, high, low, close, volume };
  }

  it("gruppiert Tageskerzen zu Wochenkerzen (Montag als Wochenbeginn)", () => {
    const daily = [
      dailyCandle("2026-09-21", 100, 105, 95, 102, 10), // Montag Woche 1
      dailyCandle("2026-09-22", 102, 106, 101, 103, 10),
      dailyCandle("2026-09-23", 103, 108, 102, 107, 10),
      dailyCandle("2026-09-27", 107, 112, 100, 110, 10), // Sonntag Woche 1
      dailyCandle("2026-09-28", 110, 111, 108, 109, 10), // Montag Woche 2
      dailyCandle("2026-09-29", 109, 115, 107, 113, 10),
    ];
    const weekly = aggregateToWeekly(daily);
    expect(weekly).toHaveLength(2);

    expect(weekly[0].openTime).toBe("2026-09-21T00:00:00.000Z");
    expect(weekly[0].open).toBe(100);
    expect(weekly[0].high).toBe(112);
    expect(weekly[0].low).toBe(95);
    expect(weekly[0].close).toBe(110);
    expect(weekly[0].volume).toBe(40);

    expect(weekly[1].openTime).toBe("2026-09-28T00:00:00.000Z");
    expect(weekly[1].high).toBe(115);
    expect(weekly[1].low).toBe(107);
    expect(weekly[1].close).toBe(113);
    expect(weekly[1].volume).toBe(20);
  });
});

describe("buildKeyLevelZones", () => {
  it("erzeugt eine Zone aus einem einzelnen Pivot ohne nahe Liquidation", () => {
    const zones = buildKeyLevelZones(
      [{ timeframe: "1d", kind: "high", price: 1050, openTime: "d1" }],
      [],
      [],
      1000
    );
    expect(zones).toEqual([
      {
        price: 1050,
        side: "resistance",
        timeframes: ["1d"],
        confirmedBy: [],
        liquidationNotionalUsd: null,
        spotVolume: null,
      },
    ]);
  });

  it("buendelt Pivots aus unterschiedlichen Zeitrahmen innerhalb der Toleranz zu EINER Zone", () => {
    const zones = buildKeyLevelZones(
      [
        { timeframe: "1d", kind: "high", price: 1050, openTime: "d1" },
        { timeframe: "4h", kind: "high", price: 1052, openTime: "h1" }, // ~0.19% entfernt -> innerhalb 0.3%
      ],
      [],
      [],
      1000
    );
    expect(zones).toHaveLength(1);
    expect(zones[0].price).toBe(1051);
    expect(zones[0].timeframes.sort()).toEqual(["1d", "4h"]);
  });

  it("bestaetigt eine Pivot-Zone zusaetzlich durch einen nahen Liquidations-Cluster", () => {
    const zones = buildKeyLevelZones(
      [{ timeframe: "1w", kind: "low", price: 950, openTime: "w1" }],
      [{ price: 951, notionalUsd: 50_000, eventCount: 3 }], // ~0.1% entfernt
      [],
      1000
    );
    expect(zones).toHaveLength(1);
    expect(zones[0].side).toBe("support");
    expect(zones[0].timeframes).toEqual(["1w"]);
    expect(zones[0].confirmedBy).toEqual(["liquidation"]);
    expect(zones[0].liquidationNotionalUsd).toBe(50_000);
  });

  it("erzeugt eine reine Liquidations-Zone ohne nahen Pivot", () => {
    const zones = buildKeyLevelZones([], [{ price: 900, notionalUsd: 20_000, eventCount: 2 }], [], 1000);
    expect(zones).toEqual([
      {
        price: 900,
        side: "support",
        timeframes: [],
        confirmedBy: ["liquidation"],
        liquidationNotionalUsd: 20_000,
        spotVolume: null,
      },
    ]);
  });

  it("buendelt NICHT, wenn zwei Pivots ausserhalb der Toleranz liegen", () => {
    const zones = buildKeyLevelZones(
      [
        { timeframe: "1d", kind: "high", price: 1010, openTime: "d1" },
        { timeframe: "4h", kind: "high", price: 1050, openTime: "h1" }, // ~3,96% entfernt
      ],
      [],
      [],
      1000
    );
    expect(zones).toHaveLength(2);
    expect(zones.map((z) => z.price).sort((a, b) => a - b)).toEqual([1010, 1050]);
  });

  it("bestaetigt eine Zone durch einen nahen Spot-Volume-Knoten (Kauf-Uebergewicht -> Support-Hinweis)", () => {
    const zones = buildKeyLevelZones(
      [{ timeframe: "1h", kind: "low", price: 950, openTime: "h1" }],
      [],
      [{ price: 951, buyVolumeBtc: 3.2, sellVolumeBtc: 0.9 }], // ~0.1% entfernt
      1000
    );
    expect(zones).toHaveLength(1);
    expect(zones[0].confirmedBy).toEqual(["spot_volume"]);
    expect(zones[0].spotVolume).toEqual({ buyVolumeBtc: 3.2, sellVolumeBtc: 0.9 });
  });

  it("erzeugt eine reine Spot-Volume-Zone ohne nahen Pivot/Liquidation", () => {
    const zones = buildKeyLevelZones([], [], [{ price: 1100, buyVolumeBtc: 0.4, sellVolumeBtc: 2.1 }], 1000);
    expect(zones).toEqual([
      {
        price: 1100,
        side: "resistance",
        timeframes: [],
        confirmedBy: ["spot_volume"],
        liquidationNotionalUsd: null,
        spotVolume: { buyVolumeBtc: 0.4, sellVolumeBtc: 2.1 },
      },
    ]);
  });
});

describe("withConfirmationLevels", () => {
  function baseStructureData(keyLevels: KeyLevel[]): ChartStructureData {
    return {
      interval: "1h",
      candlestickPatterns: [],
      avwapPivotLevels: [],
      trendlines: [],
      swingFormations: [],
      triangle: null,
      continuationFormation: null,
      keyLevels,
      currentPrice: 1000,
      dataAsOf: null,
    };
  }

  it("taggt eine Zone mit EMA/VWAP, wenn der Wert innerhalb der Toleranz liegt", () => {
    const data = baseStructureData([
      {
        price: 1000,
        side: "resistance",
        timeframes: ["1d"],
        confirmedBy: [],
        liquidationNotionalUsd: null,
        spotVolume: null,
      },
    ]);
    const result = withConfirmationLevels(data, [
      { label: "ema50", price: 1001 }, // ~0,1% entfernt -> innerhalb 0,3%
      { label: "vwap_daily", price: 1100 }, // weit entfernt -> nicht getaggt
    ]);
    expect(result.keyLevels[0].confirmedBy).toEqual(["ema50"]);
  });

  it("dupliziert keinen bereits vorhandenen Tag", () => {
    const data = baseStructureData([
      {
        price: 1000,
        side: "resistance",
        timeframes: [],
        confirmedBy: ["ema50"],
        liquidationNotionalUsd: null,
        spotVolume: null,
      },
    ]);
    const result = withConfirmationLevels(data, [{ label: "ema50", price: 1000 }]);
    expect(result.keyLevels[0].confirmedBy).toEqual(["ema50"]);
  });

  it("ignoriert null-Werte", () => {
    const data = baseStructureData([
      {
        price: 1000,
        side: "resistance",
        timeframes: [],
        confirmedBy: [],
        liquidationNotionalUsd: null,
        spotVolume: null,
      },
    ]);
    const result = withConfirmationLevels(data, [{ label: "vwap_weekly", price: null }]);
    expect(result.keyLevels[0].confirmedBy).toEqual([]);
  });
});
