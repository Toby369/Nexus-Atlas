import { describe, expect, it } from "vitest";
import { classifyPremium, computePremiumSeries, parseCoinbaseCandles, summarizePremium } from "./coinbasePremium";

describe("parseCoinbaseCandles", () => {
  it("liest Sekunden-Zeitstempel und Close, sortiert aufsteigend", () => {
    const raw = [
      [1700000300, 1, 2, 1, 60100, 5],
      [1700000000, 1, 2, 1, 60000, 5],
      ["kaputt"],
    ];
    expect(parseCoinbaseCandles(raw)).toEqual([
      { t: 1700000000000, close: 60000 },
      { t: 1700000300000, close: 60100 },
    ]);
  });
  it("Nicht-Array ergibt leere Liste", () => {
    expect(parseCoinbaseCandles({ message: "error" })).toEqual([]);
  });
});

describe("computePremiumSeries", () => {
  it("vergleicht nur Kerzen mit gleicher Open-Zeit", () => {
    const series = computePremiumSeries(
      [
        { t: 1, close: 60060 },
        { t: 2, close: 60000 },
      ],
      [
        { t: 1, close: 60000 },
        { t: 3, close: 60000 },
      ]
    );
    expect(series).toHaveLength(1);
    expect(series[0].premiumPct).toBeCloseTo(0.1, 6);
  });
  it("rechnet Binance mit USDT-USD in echte USD um", () => {
    // USDT = 0,9987 USD: roh -0,13 %, korrigiert 0 %.
    const series = computePremiumSeries([{ t: 1, close: 99870 }], [{ t: 1, close: 100000 }], [{ t: 1, close: 0.9987 }]);
    expect(series[0].premiumPct).toBeCloseTo(0, 6);
  });

  it("fehlende USDT-Kerze: letzter Kurs davor, vor dem ersten Kurs kein Punkt", () => {
    const series = computePremiumSeries(
      [
        { t: 1, close: 100000 },
        { t: 3, close: 99900 },
      ],
      [
        { t: 1, close: 100000 },
        { t: 3, close: 100000 },
      ],
      [{ t: 2, close: 0.999 }],
    );
    expect(series).toHaveLength(1);
    expect(series[0].t).toBe(3);
    expect(series[0].premiumPct).toBeCloseTo(0, 6);
  });
});

describe("classifyPremium", () => {
  it.each([
    [0.12, "strong_buying"],
    [0.05, "buying"],
    [0.01, "neutral"],
    [-0.02, "neutral"],
    [-0.05, "selling"],
    [-0.2, "strong_selling"],
  ])("%s %% -> %s", (pct, level) => {
    expect(classifyPremium(pct)).toBe(level);
  });
});

describe("summarizePremium", () => {
  it("aktueller Wert = Mittel der juengsten 6 Punkte", () => {
    const series = [
      ...Array.from({ length: 10 }, (_, i) => ({ t: i, premiumPct: -0.2 })),
      ...Array.from({ length: 6 }, (_, i) => ({ t: 10 + i, premiumPct: 0.06 })),
    ];
    const s = summarizePremium(series);
    expect(s.currentPct).toBeCloseTo(0.06, 6);
    expect(s.level).toBe("buying");
    expect(s.averagePct).toBeCloseTo((-2 + 0.36) / 16, 6);
    expect(s.latestT).toBe(15);
  });
  it("ohne Daten kein Level", () => {
    expect(summarizePremium([]).level).toBeNull();
  });
});
