import { describe, it, expect } from "vitest";
import { buildCompactMarketStateSummary } from "./marketStateSummary";
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
});
