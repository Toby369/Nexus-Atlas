import { describe, expect, it } from "vitest";
import { buildCvdComparison, classifyFlow, compareSpotPerpFlow, perpIntervalFor, perpNetFlow } from "./spotPerpFlow";

const rows = (n: number, buyShare: number) =>
  Array.from({ length: n }, () => ({ volume: 100, taker_buy_base_vol: 100 * buyShare }));

describe("perpNetFlow", () => {
  it("rechnet (Kauf − Verkauf) / Volumen", () => {
    expect(perpNetFlow(rows(4, 0.55)).netPct).toBeCloseTo(10, 6);
  });
  it("ignoriert Kerzen ohne Taker-Split", () => {
    const r = perpNetFlow([{ volume: 100, taker_buy_base_vol: null }, { volume: 100, taker_buy_base_vol: 60 }]);
    expect(r.volume).toBe(100);
    expect(r.netPct).toBeCloseTo(20, 6);
  });
  it("ohne Volumen keine Aussage", () => {
    expect(perpNetFlow([]).netPct).toBeNull();
  });
});

describe("classifyFlow", () => {
  it("Schwelle ist exklusiv", () => {
    expect(classifyFlow(2, 2)).toBe("flat");
    expect(classifyFlow(2.1, 2)).toBe("up");
    expect(classifyFlow(-2.1, 2)).toBe("down");
    expect(classifyFlow(null, 2)).toBeNull();
  });
});

describe("perpIntervalFor", () => {
  it("bleibt fuer alle Dashboard-Zeitraeume unter 1000 Kerzen", () => {
    for (const minutes of [15, 60, 240, 1440, 10080, 43200]) {
      const { minutes: step } = perpIntervalFor(minutes);
      expect(minutes / step).toBeLessThanOrEqual(1000);
    }
  });
});

describe("compareSpotPerpFlow", () => {
  it("Spot kauft, Perp flach -> organische Nachfrage", () => {
    const r = compareSpotPerpFlow({ spotBuy: 60, spotSell: 40, perpRows: rows(10, 0.505), expectedPerpCandles: 10 });
    expect(r.spotNetPct).toBeCloseTo(20, 6);
    expect(r.verdict?.label).toBe("Organische Nachfrage");
  });
  it("Spot flach, Perp kauft -> hebelgetrieben", () => {
    const r = compareSpotPerpFlow({ spotBuy: 51, spotSell: 49, perpRows: rows(10, 0.53), expectedPerpCandles: 10 });
    expect(r.verdict?.key).toBe("flat|up");
  });
  it("Spot verkauft, Perp kauft -> Warnsignal bearish", () => {
    const r = compareSpotPerpFlow({ spotBuy: 40, spotSell: 60, perpRows: rows(10, 0.53), expectedPerpCandles: 10 });
    expect(r.verdict?.tone).toBe("bearish");
  });
  it("zu wenige Perp-Kerzen -> kein Verdikt", () => {
    const r = compareSpotPerpFlow({ spotBuy: 60, spotSell: 40, perpRows: rows(3, 0.6), expectedPerpCandles: 10 });
    expect(r.perpNetPct).toBeNull();
    expect(r.verdict).toBeNull();
  });
  it("Volumenverhaeltnis Perp zu Spot", () => {
    const r = compareSpotPerpFlow({ spotBuy: 50, spotSell: 50, perpRows: rows(10, 0.5), expectedPerpCandles: 10 });
    expect(r.perpToSpotVolume).toBe(10);
  });
});

describe("buildCvdComparison", () => {
  const H = 60 * 60 * 1000;
  it("kumuliert und normiert je Markt, Endpunkt = Netto-Flow", () => {
    const spot = [
      { t: 0, buy: 60, sell: 40 },
      { t: H, buy: 30, sell: 70 },
    ];
    const perp = [
      { t: 0, volume: 1000, takerBuy: 500 },
      { t: H, volume: 1000, takerBuy: 600 },
    ];
    const series = buildCvdComparison(spot, perp, H);
    expect(series).toHaveLength(2);
    // Spot: +20 dann -40 bei Gesamtvolumen 200 -> +10 %, -10 %
    expect(series[0].spot).toBeCloseTo(10);
    expect(series[1].spot).toBeCloseTo(-10);
    // Perp: 0 dann +200 bei Gesamtvolumen 2000 -> 0 %, +10 %
    expect(series[1].perp).toBeCloseTo(10);
    expect(series[1].divergence).toBeCloseTo(-20);
  });

  it("startet erst, wenn beide Maerkte Daten haben", () => {
    const spot = [{ t: 2 * H, buy: 10, sell: 0 }];
    const perp = [
      { t: 0, volume: 10, takerBuy: 10 },
      { t: 2 * H, volume: 10, takerBuy: 0 },
    ];
    const series = buildCvdComparison(spot, perp, H);
    expect(series.map((p) => p.t)).toEqual([2 * H]);
    expect(series[0].perp).toBeCloseTo(0);
  });

  it("liefert nichts ohne Daten eines Marktes", () => {
    expect(buildCvdComparison([], [{ t: 0, volume: 1, takerBuy: 1 }], H)).toEqual([]);
    expect(buildCvdComparison([{ t: 0, buy: null, sell: null }], [{ t: 0, volume: 1, takerBuy: 1 }], H)).toEqual([]);
  });
});
