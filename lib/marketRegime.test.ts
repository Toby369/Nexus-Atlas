import { describe, it, expect } from "vitest";
import {
  ALL_MARKET_REGIMES,
  isTrendingRegime,
  regimeColorClass,
  regimeDescription,
  regimeLabel,
  shouldSuppressRegimeDirectionalLabel,
} from "./marketRegime";
import { DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD } from "@/lib/marketStateSummary";
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

  // Phase 4, Punkt 2: "Behalte dabei alle in Phase 1 integrierten
  // Sicherheits-Regeln bei (Display-Only Confidence Threshold < 35 ->
  // 'Unklar / kein Zustand')" -- dieselbe Schwelle wie MarketStateCard,
  // hier auf die beiden gerichteten Regimes angewendet.
  describe("shouldSuppressRegimeDirectionalLabel", () => {
    it("sperrt TREND_EXPANSION_BULLISH, wenn Confidence unter der Schwelle liegt", () => {
      expect(
        shouldSuppressRegimeDirectionalLabel(
          "TREND_EXPANSION_BULLISH",
          DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD - 1
        )
      ).toBe(true);
    });

    it("sperrt TREND_EXPANSION_BEARISH, wenn Confidence unter der Schwelle liegt", () => {
      expect(
        shouldSuppressRegimeDirectionalLabel(
          "TREND_EXPANSION_BEARISH",
          DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD - 1
        )
      ).toBe(true);
    });

    it("sperrt NICHT, wenn Confidence genau auf der Schwelle liegt (Grenzwert zählt als ausreichend)", () => {
      expect(
        shouldSuppressRegimeDirectionalLabel(
          "TREND_EXPANSION_BULLISH",
          DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD
        )
      ).toBe(false);
    });

    it("sperrt NICHT, wenn Confidence über der Schwelle liegt", () => {
      expect(shouldSuppressRegimeDirectionalLabel("TREND_EXPANSION_BULLISH", 80)).toBe(false);
    });

    it("sperrt NICHT-gerichtete Regimes nie, unabhängig von der Confidence", () => {
      expect(shouldSuppressRegimeDirectionalLabel("VOLA_SQUEEZE_RANGING", 0)).toBe(false);
      expect(shouldSuppressRegimeDirectionalLabel("HIGH_VOLA_REVERSION", 0)).toBe(false);
      expect(shouldSuppressRegimeDirectionalLabel("UNRESOLVED_NEUTRAL", 0)).toBe(false);
    });

    it("sperrt nicht, wenn noch keine Confidence vorliegt (null) -- defensiv, kein Vergleichswert vorhanden", () => {
      expect(shouldSuppressRegimeDirectionalLabel("TREND_EXPANSION_BULLISH", null)).toBe(false);
    });
  });
});
