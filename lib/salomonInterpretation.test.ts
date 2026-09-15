import { describe, expect, it } from "vitest";
import { getSalomonInterpretation } from "./salomonInterpretation";
import type { MarketStateMtfAlignment, MarketStatePattern } from "./types";

function mtf(alignmentPct: number): MarketStateMtfAlignment {
  return { alignment_pct: alignmentPct, dominant_direction: "bullish", timeframes: {}, timeframe_count: 3 };
}

describe("getSalomonInterpretation", () => {
  it("mappt Bullish Confirmation auf Markup", () => {
    const patterns: MarketStatePattern[] = [{ name: "Bullish Confirmation", note: "" }];
    expect(getSalomonInterpretation(patterns, null)?.phase).toBe("Markup (gesund)");
  });

  it("mappt Fragile Bullish auf beginnende Distribution", () => {
    const patterns: MarketStatePattern[] = [{ name: "Fragile Bullish", note: "" }];
    expect(getSalomonInterpretation(patterns, null)?.phase).toContain("Distribution");
  });

  it("mappt Capitulation auf Ende Markdown", () => {
    const patterns: MarketStatePattern[] = [{ name: "Capitulation", note: "" }];
    expect(getSalomonInterpretation(patterns, null)?.phase).toContain("Markdown");
  });

  it("bevorzugt Capitulation gegenueber gleichzeitig aktivem Bullish Confirmation", () => {
    const patterns: MarketStatePattern[] = [
      { name: "Bullish Confirmation", note: "" },
      { name: "Capitulation", note: "" },
    ];
    expect(getSalomonInterpretation(patterns, null)?.phase).toContain("Markdown");
  });

  it("faellt auf MTF-Konfluenz zurueck, wenn kein Pattern aktiv ist aber Alignment > 80%", () => {
    expect(getSalomonInterpretation([], mtf(85))?.phase).toBe("Multi-Timeframe-Konfluenz");
  });

  it("gibt null zurueck ohne Pattern und ohne ausreichendes Alignment", () => {
    expect(getSalomonInterpretation([], mtf(60))).toBeNull();
    expect(getSalomonInterpretation([], null)).toBeNull();
  });

  it("ignoriert unbekannte Pattern-Namen", () => {
    const patterns: MarketStatePattern[] = [{ name: "Short Squeeze", note: "" }];
    expect(getSalomonInterpretation(patterns, null)).toBeNull();
  });
});
