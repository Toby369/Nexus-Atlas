import { describe, it, expect } from "vitest";
import {
  buildCompactMarketStateSummary,
  isDirectionalLabelSuppressed,
  DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD,
} from "./marketStateSummary";
import type { MarketState } from "./types";

function baseState(overrides: Partial<MarketState> = {}): MarketState {
  return {
    id: 1,
    timestamp_utc: "2026-08-28T12:00:00Z",
    overall_state: "BULLISH",
    score: 4,
    confidence: 72,
    data_coverage_pct: 92.9,
    factors: {},
    patterns: [],
    mtf_alignment: null,
    risk_level: "LOW",
    risk_factors: [],
    created_at: "2026-08-28T12:00:00Z",
    ...overrides,
  };
}

describe("buildCompactMarketStateSummary", () => {
  it("nennt Zustand, Confidence und Coverage fuer einen normalen BULLISH-Zustand", () => {
    const text = buildCompactMarketStateSummary(baseState());
    expect(text).toContain("bullisch");
    expect(text).toContain("72/100");
    expect(text).toContain("93%");
  });

  it("nennt den Sonderfall INSUFFICIENT_DATA statt eines Zustandslabels", () => {
    const text = buildCompactMarketStateSummary(
      baseState({ overall_state: "INSUFFICIENT_DATA", data_coverage_pct: 30 })
    );
    expect(text).toContain("nicht auswertbar");
    expect(text).toContain("30%");
  });

  it("nennt das erste Muster, wenn Patterns vorhanden sind", () => {
    const text = buildCompactMarketStateSummary(
      baseState({ patterns: [{ name: "Fragile Bullish", note: "..." }] })
    );
    expect(text).toContain("Fragile Bullish");
  });

  it("nennt kein Muster, wenn keine Patterns vorhanden sind", () => {
    const text = buildCompactMarketStateSummary(baseState({ patterns: [] }));
    expect(text).not.toContain("Muster:");
  });

  it("nennt Risk, wenn risk_level gesetzt und nicht UNKNOWN ist", () => {
    const text = buildCompactMarketStateSummary(baseState({ risk_level: "HIGH" }));
    expect(text).toContain("Risk: hoch");
  });

  it("laesst Risk weg, wenn risk_level UNKNOWN ist", () => {
    const text = buildCompactMarketStateSummary(baseState({ risk_level: "UNKNOWN" }));
    expect(text).not.toContain("Risk:");
  });

  it("laesst Risk weg, wenn risk_level null ist", () => {
    const text = buildCompactMarketStateSummary(baseState({ risk_level: null }));
    expect(text).not.toContain("Risk:");
  });

  it("uebersetzt alle nicht-INSUFFICIENT_DATA Zustaende in ein deutsches Label", () => {
    for (const state of ["BULLISH", "BEARISH", "NEUTRAL", "MIXED"] as const) {
      const text = buildCompactMarketStateSummary(baseState({ overall_state: state }));
      expect(text.length).toBeGreaterThan(0);
      expect(text).toContain("Marktzustand");
    }
  });

  describe("Confidence-Gate fuer Bullish/Bearish (Phase 1, Punkt 3.1 -- Anzeige-Ebene)", () => {
    it("zeigt 'unklar' statt 'bullisch', wenn Confidence unter der Schwelle liegt", () => {
      const text = buildCompactMarketStateSummary(
        baseState({ overall_state: "BULLISH", confidence: DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD - 1 })
      );
      expect(text).not.toContain("bullisch");
      expect(text).toContain("unklar");
    });

    it("zeigt 'unklar' statt 'bärisch', wenn Confidence unter der Schwelle liegt", () => {
      const text = buildCompactMarketStateSummary(
        baseState({ overall_state: "BEARISH", confidence: DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD - 1 })
      );
      expect(text).not.toContain("bärisch");
      expect(text).toContain("unklar");
    });

    it("zeigt das echte Label, wenn Confidence exakt der Schwelle entspricht (>= reicht)", () => {
      const text = buildCompactMarketStateSummary(
        baseState({ overall_state: "BULLISH", confidence: DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD })
      );
      expect(text).toContain("bullisch");
    });

    it("gate wirkt NICHT auf NEUTRAL/MIXED -- keine Richtungsaussage, nichts zu unterdruecken", () => {
      const text = buildCompactMarketStateSummary(baseState({ overall_state: "NEUTRAL", confidence: 5 }));
      expect(text).toContain("neutral");
      expect(text).not.toContain("unklar");
    });
  });
});

describe("isDirectionalLabelSuppressed", () => {
  it("true fuer BULLISH mit niedriger Confidence", () => {
    expect(
      isDirectionalLabelSuppressed({ overall_state: "BULLISH", confidence: 10 })
    ).toBe(true);
  });

  it("true fuer BEARISH mit niedriger Confidence", () => {
    expect(
      isDirectionalLabelSuppressed({ overall_state: "BEARISH", confidence: 10 })
    ).toBe(true);
  });

  it("false fuer BULLISH mit ausreichender Confidence", () => {
    expect(
      isDirectionalLabelSuppressed({ overall_state: "BULLISH", confidence: 80 })
    ).toBe(false);
  });

  it("false fuer NEUTRAL/MIXED/INSUFFICIENT_DATA unabhaengig von der Confidence", () => {
    for (const state of ["NEUTRAL", "MIXED", "INSUFFICIENT_DATA"] as const) {
      expect(isDirectionalLabelSuppressed({ overall_state: state, confidence: 0 })).toBe(false);
    }
  });

  it("false exakt an der Schwelle (>=)", () => {
    expect(
      isDirectionalLabelSuppressed({
        overall_state: "BULLISH",
        confidence: DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD,
      })
    ).toBe(false);
  });
});
