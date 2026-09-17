import { describe, expect, it } from "vitest";
import { detectFractalSwings, emaSeries, findPivots } from "./swingDetection";

describe("detectFractalSwings", () => {
  const highs = [1, 2, 3, 4, 5, 10, 5, 4, 3, 2, 1];
  const lows = [10, 9, 8, 7, 6, 1, 6, 7, 8, 9, 10];

  it("erkennt ein eindeutiges Swing-Hoch in der Mitte der Serie", () => {
    const result = detectFractalSwings(highs, lows, 2);
    expect(result.isSwingHigh[5]).toBe(true);
    expect(result.isSwingHigh[3]).toBe(false);
  });

  it("erkennt ein eindeutiges Swing-Tief in der Mitte der Serie", () => {
    const result = detectFractalSwings(highs, lows, 2);
    expect(result.isSwingLow[5]).toBe(true);
    expect(result.isSwingLow[7]).toBe(false);
  });

  it("klassifiziert ein hoeheres zweites Swing-Hoch als HH", () => {
    // Zwei separate Swing-Hoch-Buckel, zweiter hoeher als erster.
    const h = [1, 2, 5, 2, 1, 1, 1, 2, 8, 2, 1];
    const l = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const result = detectFractalSwings(h, l, 2);
    expect(result.swingType[8]).toBe("HH");
  });

  it("ist deterministisch fuer denselben Input", () => {
    const a = detectFractalSwings(highs, lows, 2);
    const b = detectFractalSwings(highs, lows, 2);
    expect(a.swingType).toEqual(b.swingType);
  });
});

describe("findPivots", () => {
  const values = [1, 2, 3, 2, 1, 2, 3, 2, 1];

  it("findet Pivot-Hochs an bekannten Peaks", () => {
    const pivots = findPivots(values, 1);
    const highIndices = pivots.filter((p) => p.kind === "high").map((p) => p.index);
    expect(highIndices).toEqual([2, 6]);
  });

  it("findet Pivot-Tiefs an bekannten Troughs", () => {
    const pivots = findPivots(values, 1);
    const lowIndices = pivots.filter((p) => p.kind === "low").map((p) => p.index);
    expect(lowIndices).toEqual([4]);
  });

  it("liefert keine Pivots bei zu kurzer Serie fuer den Lookback", () => {
    expect(findPivots([1, 2, 3], 5)).toEqual([]);
  });
});

describe("emaSeries", () => {
  it("liefert null, solange der SMA-Seed noch nicht erreicht ist", () => {
    const series = emaSeries([1, 2, 3, 4, 5], 5);
    expect(series.slice(0, 4)).toEqual([null, null, null, null]);
  });

  it("entspricht dem SMA-Seed genau an der Seed-Position", () => {
    const series = emaSeries([1, 2, 3, 4, 5], 5);
    expect(series[4]).toBeCloseTo(3, 6);
  });

  it("bewegt sich nach dem Seed mit neuen Werten weiter", () => {
    const series = emaSeries([100, 100, 100, 100, 100, 200, 200], 5);
    expect(series[6]).toBeGreaterThan(series[4]!);
  });

  it("ist deterministisch fuer denselben Input", () => {
    const values = [10, 11, 12, 13, 14, 15, 16];
    expect(emaSeries(values, 5)).toEqual(emaSeries(values, 5));
  });
});
