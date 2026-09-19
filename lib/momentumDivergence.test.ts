import { describe, it, expect } from "vitest";
import { detectMomentumDivergence } from "./momentumDivergence";
import type { MarketState } from "./types";

function stateWith(
  overallState: MarketState["overall_state"],
  adx: number | null,
  macdHistogram: number | null
): Pick<MarketState, "overall_state" | "factors"> {
  return {
    overall_state: overallState,
    factors: {
      trend_strength: { value: null, basis: adx === null ? {} : { adx_14: adx } },
      momentum: { value: null, basis: macdHistogram === null ? {} : { macd_histogram: macdHistogram } },
    },
  };
}

describe("detectMomentumDivergence", () => {
  it("triggert bei BULLISH + etabliertem Trend + negativem MACD-Histogramm", () => {
    const result = detectMomentumDivergence(stateWith("BULLISH", 57.3, -136.5));
    expect(result.triggered).toBe(true);
    expect(result.adx).toBe(57.3);
    expect(result.macdHistogram).toBe(-136.5);
  });

  it("triggert bei BEARISH + etabliertem Trend + positivem MACD-Histogramm", () => {
    const result = detectMomentumDivergence(stateWith("BEARISH", 30, 10));
    expect(result.triggered).toBe(true);
  });

  it("triggert NICHT bei BULLISH + bestaetigendem (positivem) Momentum", () => {
    const result = detectMomentumDivergence(stateWith("BULLISH", 58.2, 66));
    expect(result.triggered).toBe(false);
  });

  it("triggert NICHT bei fruehem/keinem Trend (ADX unter Schwelle), auch wenn Momentum widerspricht", () => {
    const result = detectMomentumDivergence(stateWith("BULLISH", 13.7, -29.6));
    expect(result.triggered).toBe(false);
  });

  it("triggert NICHT bei ADX exakt auf der Schwelle mit widersprechendem Momentum (Grenzfall, inklusive)", () => {
    const result = detectMomentumDivergence(stateWith("BULLISH", 25, -1));
    expect(result.triggered).toBe(true);
  });

  it("triggert NICHT bei NEUTRAL/MIXED/INSUFFICIENT_DATA (keine Richtung, der widersprochen werden koennte)", () => {
    expect(detectMomentumDivergence(stateWith("NEUTRAL", 40, -50)).triggered).toBe(false);
    expect(detectMomentumDivergence(stateWith("MIXED", 40, -50)).triggered).toBe(false);
    expect(detectMomentumDivergence(stateWith("INSUFFICIENT_DATA", 40, -50)).triggered).toBe(false);
  });

  it("triggert NICHT, wenn ADX oder MACD-Histogramm fehlen (keine erfundenen Werte)", () => {
    expect(detectMomentumDivergence(stateWith("BULLISH", null, -50)).triggered).toBe(false);
    expect(detectMomentumDivergence(stateWith("BULLISH", 40, null)).triggered).toBe(false);
  });
});
