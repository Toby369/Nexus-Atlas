import { describe, it, expect } from "vitest";
import {
  regimeDirection,
  spotPressureDirection,
  summarizeConfirmation,
  regimeArrowDirection,
  spotPressureArrowDirection,
  marketContextArrowDirection,
  signArrowDirection,
  type ConfirmationSignal,
} from "./heroSummary";

describe("regimeDirection", () => {
  it("TREND_EXPANSION_BULLISH -> bullish", () => {
    expect(regimeDirection("TREND_EXPANSION_BULLISH")).toBe("bullish");
  });

  it("TREND_EXPANSION_BEARISH -> bearish", () => {
    expect(regimeDirection("TREND_EXPANSION_BEARISH")).toBe("bearish");
  });

  it("nicht-gerichtete Regimes -> not_comparable", () => {
    expect(regimeDirection("VOLA_SQUEEZE_RANGING")).toBe("not_comparable");
    expect(regimeDirection("HIGH_VOLA_REVERSION")).toBe("not_comparable");
    expect(regimeDirection("UNRESOLVED_NEUTRAL")).toBe("not_comparable");
  });

  it("null -> not_comparable", () => {
    expect(regimeDirection(null)).toBe("not_comparable");
  });
});

describe("spotPressureDirection", () => {
  it("BUYING_PRESSURE -> bullish", () => {
    expect(spotPressureDirection("BUYING_PRESSURE")).toBe("bullish");
  });

  it("SELLING_PRESSURE -> bearish", () => {
    expect(spotPressureDirection("SELLING_PRESSURE")).toBe("bearish");
  });

  it("NEUTRAL/INSUFFICIENT_DATA/null -> not_comparable", () => {
    expect(spotPressureDirection("NEUTRAL")).toBe("not_comparable");
    expect(spotPressureDirection("INSUFFICIENT_DATA")).toBe("not_comparable");
    expect(spotPressureDirection(null)).toBe("not_comparable");
  });
});

describe("summarizeConfirmation", () => {
  const bothBullish: ConfirmationSignal[] = [
    { name: "Marktphase", direction: "bullish" },
    { name: "Spot Pressure", direction: "bullish" },
  ];

  it("beide Signale bestaetigen Bullish", () => {
    const result = summarizeConfirmation("BULLISH", 78, bothBullish);
    expect(result).toEqual({
      primaryDirection: "bullish",
      confirmingCount: 2,
      totalComparable: 2,
      confirming: ["Marktphase", "Spot Pressure"],
      contradicting: [],
    });
  });

  it("ein Signal widerspricht", () => {
    const mixed: ConfirmationSignal[] = [
      { name: "Marktphase", direction: "bullish" },
      { name: "Spot Pressure", direction: "bearish" },
    ];
    const result = summarizeConfirmation("BULLISH", 78, mixed);
    expect(result.confirmingCount).toBe(1);
    expect(result.totalComparable).toBe(2);
    expect(result.confirming).toEqual(["Marktphase"]);
    expect(result.contradicting).toEqual(["Spot Pressure"]);
  });

  it("not_comparable-Signale zaehlen weder als Bestaetigung noch als Widerspruch", () => {
    const withNotComparable: ConfirmationSignal[] = [
      { name: "Marktphase", direction: "not_comparable" },
      { name: "Spot Pressure", direction: "bullish" },
    ];
    const result = summarizeConfirmation("BULLISH", 78, withNotComparable);
    expect(result.totalComparable).toBe(1);
    expect(result.confirmingCount).toBe(1);
  });

  it("primaryDirection ist null unter der Confidence-Schwelle (35/100)", () => {
    const result = summarizeConfirmation("BULLISH", 34, bothBullish);
    expect(result.primaryDirection).toBeNull();
    expect(result.confirmingCount).toBe(0);
    expect(result.contradicting).toEqual([]);
  });

  it("primaryDirection ist null bei NEUTRAL/MIXED/INSUFFICIENT_DATA", () => {
    expect(summarizeConfirmation("NEUTRAL", 90, bothBullish).primaryDirection).toBeNull();
    expect(summarizeConfirmation("MIXED", 90, bothBullish).primaryDirection).toBeNull();
    expect(
      summarizeConfirmation("INSUFFICIENT_DATA", 90, bothBullish).primaryDirection
    ).toBeNull();
  });

  it("leere Signal-Liste -> 0 von 0", () => {
    const result = summarizeConfirmation("BEARISH", 90, []);
    expect(result.primaryDirection).toBe("bearish");
    expect(result.confirmingCount).toBe(0);
    expect(result.totalComparable).toBe(0);
  });
});

describe("regimeArrowDirection", () => {
  it("TREND_EXPANSION_BULLISH -> up (unterdrueckt=false)", () => {
    expect(regimeArrowDirection("TREND_EXPANSION_BULLISH", false)).toBe("up");
  });

  it("TREND_EXPANSION_BEARISH -> down (unterdrueckt=false)", () => {
    expect(regimeArrowDirection("TREND_EXPANSION_BEARISH", false)).toBe("down");
  });

  it("VOLA_SQUEEZE_RANGING/HIGH_VOLA_REVERSION -> neutral (echtes, nicht gerichtetes Regime)", () => {
    expect(regimeArrowDirection("VOLA_SQUEEZE_RANGING", false)).toBe("neutral");
    expect(regimeArrowDirection("HIGH_VOLA_REVERSION", false)).toBe("neutral");
  });

  it("UNRESOLVED_NEUTRAL -> not_available (keine belastbare Aussage moeglich)", () => {
    expect(regimeArrowDirection("UNRESOLVED_NEUTRAL", false)).toBe("not_available");
  });

  it("null -> not_available", () => {
    expect(regimeArrowDirection(null, false)).toBe("not_available");
  });

  it("Confidence-Sperre ueberschreibt auch ein gerichtetes Regime -> not_available", () => {
    expect(regimeArrowDirection("TREND_EXPANSION_BULLISH", true)).toBe("not_available");
  });
});

describe("spotPressureArrowDirection", () => {
  it("BUYING_PRESSURE -> up", () => {
    expect(spotPressureArrowDirection("BUYING_PRESSURE")).toBe("up");
  });

  it("SELLING_PRESSURE -> down", () => {
    expect(spotPressureArrowDirection("SELLING_PRESSURE")).toBe("down");
  });

  it("NEUTRAL -> neutral", () => {
    expect(spotPressureArrowDirection("NEUTRAL")).toBe("neutral");
  });

  it("INSUFFICIENT_DATA/null -> not_available", () => {
    expect(spotPressureArrowDirection("INSUFFICIENT_DATA")).toBe("not_available");
    expect(spotPressureArrowDirection(null)).toBe("not_available");
  });
});

describe("marketContextArrowDirection", () => {
  it("scenario null (INSUFFICIENT_DATA/LOCKED) -> not_available, auch bei bias neutral", () => {
    expect(marketContextArrowDirection(null, "neutral")).toBe("not_available");
  });

  it("echtes neutrales Szenario -> neutral", () => {
    expect(marketContextArrowDirection("neutral", "neutral")).toBe("neutral");
  });

  it("bullisches Szenario -> up", () => {
    expect(marketContextArrowDirection("long_buildup", "bullish")).toBe("up");
  });

  it("baerisches Szenario -> down", () => {
    expect(marketContextArrowDirection("short_buildup", "bearish")).toBe("down");
  });
});

describe("signArrowDirection", () => {
  it("positiv -> up, negativ -> down, 0 -> neutral, null -> not_available", () => {
    expect(signArrowDirection(1.2)).toBe("up");
    expect(signArrowDirection(-0.5)).toBe("down");
    expect(signArrowDirection(0)).toBe("neutral");
    expect(signArrowDirection(null)).toBe("not_available");
  });
});
