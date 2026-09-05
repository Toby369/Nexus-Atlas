import { describe, expect, it } from "vitest";
import {
  computeOptionsVsSentimentDivergence,
  computeSpotVsFuturesDivergence,
  computeCycleVsMomentumDivergence,
  computeHandelslageVsStateDivergence,
  computeOnchainVsPriceDivergence,
  computeWallPersistence,
  findCorroboratingLiquidation,
} from "./divergenceRadar";
import type { MarketState, MarketStateFactor } from "./types";

function factors(values: Record<string, -1 | 0 | 1 | null>): Pick<MarketState, "factors"> {
  const out: Record<string, MarketStateFactor> = {};
  for (const [k, v] of Object.entries(values)) out[k] = { value: v, basis: {} };
  return { factors: out };
}

describe("computeOptionsVsSentimentDivergence", () => {
  it("AGREEMENT wenn beide gleich gerichtet", () => {
    expect(computeOptionsVsSentimentDivergence(factors({ options: 1, sentiment: 1 }))).toBe(
      "AGREEMENT"
    );
  });
  it("DIVERGENCE wenn entgegengesetzt", () => {
    expect(computeOptionsVsSentimentDivergence(factors({ options: 1, sentiment: -1 }))).toBe(
      "DIVERGENCE"
    );
  });
  it("NOT_COMPARABLE wenn einer neutral oder fehlt", () => {
    expect(computeOptionsVsSentimentDivergence(factors({ options: 0, sentiment: 1 }))).toBe(
      "NOT_COMPARABLE"
    );
    expect(computeOptionsVsSentimentDivergence(factors({ options: 1, sentiment: null }))).toBe(
      "NOT_COMPARABLE"
    );
  });
});

describe("computeSpotVsFuturesDivergence", () => {
  it("AGREEMENT bei BUYING_PRESSURE + cvd bullisch", () => {
    expect(computeSpotVsFuturesDivergence("BUYING_PRESSURE", factors({ cvd: 1 }))).toBe(
      "AGREEMENT"
    );
  });
  it("DIVERGENCE bei SELLING_PRESSURE + cvd bullisch", () => {
    expect(computeSpotVsFuturesDivergence("SELLING_PRESSURE", factors({ cvd: 1 }))).toBe(
      "DIVERGENCE"
    );
  });
  it("NOT_COMPARABLE bei NEUTRAL/INSUFFICIENT_DATA", () => {
    expect(computeSpotVsFuturesDivergence("NEUTRAL", factors({ cvd: 1 }))).toBe("NOT_COMPARABLE");
    expect(computeSpotVsFuturesDivergence("INSUFFICIENT_DATA", factors({ cvd: 1 }))).toBe(
      "NOT_COMPARABLE"
    );
  });
});

describe("computeCycleVsMomentumDivergence", () => {
  it("NOT_COMPARABLE ausserhalb der Extrem-Baender", () => {
    expect(computeCycleVsMomentumDivergence("Auf Trendkanal", factors({ momentum: 1 }))).toBe(
      "NOT_COMPARABLE"
    );
  });
  it("DIVERGENCE wenn deutlich ueber Trendkanal aber Momentum baerisch", () => {
    expect(
      computeCycleVsMomentumDivergence("Deutlich über Trendkanal", factors({ momentum: -1 }))
    ).toBe("DIVERGENCE");
  });
  it("AGREEMENT wenn deutlich unter Trendkanal und Momentum ebenfalls baerisch", () => {
    expect(
      computeCycleVsMomentumDivergence("Deutlich unter Trendkanal", factors({ momentum: -1 }))
    ).toBe("AGREEMENT");
  });
});

describe("computeHandelslageVsStateDivergence", () => {
  it("AGREEMENT bei gleicher Richtung", () => {
    expect(computeHandelslageVsStateDivergence("bullish", "BULLISH")).toBe("AGREEMENT");
  });
  it("DIVERGENCE bei entgegengesetzter Richtung", () => {
    expect(computeHandelslageVsStateDivergence("bearish", "BULLISH")).toBe("DIVERGENCE");
  });
  it("NOT_COMPARABLE ohne bias (alte Snapshots) oder bei MIXED/neutral", () => {
    expect(computeHandelslageVsStateDivergence(undefined, "BULLISH")).toBe("NOT_COMPARABLE");
    expect(computeHandelslageVsStateDivergence("neutral", "BULLISH")).toBe("NOT_COMPARABLE");
    expect(computeHandelslageVsStateDivergence("bullish", "MIXED")).toBe("NOT_COMPARABLE");
  });
});

describe("computeOnchainVsPriceDivergence", () => {
  it("PRICE_HIGH_SOPR_LOSS wenn nahe 30T-Hoch aber SOPR<1", () => {
    expect(computeOnchainVsPriceDivergence(0.98, -1, null)).toBe("PRICE_HIGH_SOPR_LOSS");
  });
  it("PRICE_LOW_SOPR_PROFIT wenn nahe 30T-Tief aber SOPR>=1", () => {
    expect(computeOnchainVsPriceDivergence(1.01, null, 1)).toBe("PRICE_LOW_SOPR_PROFIT");
  });
  it("NOT_COMPARABLE ohne SOPR oder ohne Naehe zu Hoch/Tief", () => {
    expect(computeOnchainVsPriceDivergence(null, -1, null)).toBe("NOT_COMPARABLE");
    expect(computeOnchainVsPriceDivergence(0.98, -10, 10)).toBe("NOT_COMPARABLE");
  });
});

describe("computeWallPersistence", () => {
  it("NEU wenn vorher keine Wand da war", () => {
    expect(computeWallPersistence(80000, null)).toBe("NEU");
  });
  it("VERSCHWUNDEN wenn jetzt keine Wand mehr da ist", () => {
    expect(computeWallPersistence(null, 80000)).toBe("VERSCHWUNDEN");
  });
  it("GEHALTEN innerhalb der Toleranz", () => {
    expect(computeWallPersistence(80005, 80000)).toBe("GEHALTEN");
  });
  it("NEU (andere Wand) ausserhalb der Toleranz", () => {
    expect(computeWallPersistence(81000, 80000)).toBe("NEU");
  });
  it("KEINE_DATEN wenn beide fehlen", () => {
    expect(computeWallPersistence(null, null)).toBe("KEINE_DATEN");
  });
});

describe("findCorroboratingLiquidation", () => {
  it("findet ein Ereignis innerhalb der Toleranz", () => {
    const events = [{ price: 79500 }, { price: 70000 }];
    expect(findCorroboratingLiquidation(79600, events)).toEqual({ price: 79500 });
  });
  it("null wenn nichts in der Naehe liegt", () => {
    expect(findCorroboratingLiquidation(79600, [{ price: 70000 }])).toBeNull();
  });
  it("ignoriert Ereignisse ohne Preis", () => {
    expect(findCorroboratingLiquidation(79600, [{ price: null }])).toBeNull();
  });
});
