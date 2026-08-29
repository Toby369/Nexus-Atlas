import { describe, it, expect } from "vitest";
import {
  ALL_MARKET_REGIMES,
  isTrendingRegime,
  regimeColorClass,
  regimeDescription,
  regimeLabel,
} from "./marketRegime";
import type { MarketRegime } from "@/lib/types";

describe("marketRegime", () => {
  it("deckt jedes MarketRegime in ALL_MARKET_REGIMES ab", () => {
    const expected: MarketRegime[] = [
      "HIGH_VOLA_REVERSION",
      "TREND_EXPANSION_BULLISH",
      "TREND_EXPANSION_BEARISH",
      "VOLA_SQUEEZE_RANGING",
      "UNRESOLVED_NEUTRAL",
    ];
    expect([...ALL_MARKET_REGIMES].sort()).toEqual([...expected].sort());
  });

  it("liefert für jedes Regime ein nicht-leeres Label", () => {
    for (const regime of ALL_MARKET_REGIMES) {
      expect(regimeLabel(regime).length).toBeGreaterThan(0);
    }
  });

  it("liefert für jedes Regime eine nicht-leere Beschreibung", () => {
    for (const regime of ALL_MARKET_REGIMES) {
      expect(regimeDescription(regime).length).toBeGreaterThan(0);
    }
  });

  it("liefert für jedes Regime eine Tailwind-Textfarbklasse", () => {
    for (const regime of ALL_MARKET_REGIMES) {
      expect(regimeColorClass(regime)).toMatch(/^text-/);
    }
  });

  it("ordnet den beiden Trend-Regimes unterschiedliche Farben zu (bullisch vs. bärisch)", () => {
    expect(regimeColorClass("TREND_EXPANSION_BULLISH")).not.toBe(
      regimeColorClass("TREND_EXPANSION_BEARISH")
    );
  });

  describe("isTrendingRegime", () => {
    it("ist true für TREND_EXPANSION_BULLISH", () => {
      expect(isTrendingRegime("TREND_EXPANSION_BULLISH")).toBe(true);
    });

    it("ist true für TREND_EXPANSION_BEARISH", () => {
      expect(isTrendingRegime("TREND_EXPANSION_BEARISH")).toBe(true);
    });

    it("ist false für HIGH_VOLA_REVERSION", () => {
      expect(isTrendingRegime("HIGH_VOLA_REVERSION")).toBe(false);
    });

    it("ist false für VOLA_SQUEEZE_RANGING", () => {
      expect(isTrendingRegime("VOLA_SQUEEZE_RANGING")).toBe(false);
    });

    it("ist false für UNRESOLVED_NEUTRAL", () => {
      expect(isTrendingRegime("UNRESOLVED_NEUTRAL")).toBe(false);
    });
  });
});
