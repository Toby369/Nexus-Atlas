import { describe, expect, it } from "vitest";
import { deriveEntryFilter } from "./entryFilter";
import type { MarketState } from "./types";

function baseState(overrides: Partial<MarketState> = {}): MarketState {
  return {
    id: 1,
    timestamp_utc: "2026-09-04T12:00:00Z",
    overall_state: "BULLISH",
    score: 4,
    confidence: 70,
    data_coverage_pct: 100,
    factors: {},
    patterns: [],
    mtf_alignment: null,
    risk_level: "LOW",
    risk_factors: [],
    created_at: "2026-09-04T12:00:00Z",
    ...overrides,
  };
}

describe("deriveEntryFilter", () => {
  it("gibt long_ready, wenn alle 3 Zeitrahmen bullisch uebereinstimmen", () => {
    const state = baseState({
      mtf_alignment: {
        alignment_pct: 100,
        dominant_direction: "bullish",
        timeframes: { "1h": 1, "4h": 1, "1d": 1 },
        timeframe_count: 3,
      },
    });
    expect(deriveEntryFilter(state).status).toBe("long_ready");
  });

  it("gibt short_ready, wenn alle 3 Zeitrahmen baerisch uebereinstimmen", () => {
    const state = baseState({
      mtf_alignment: {
        alignment_pct: 100,
        dominant_direction: "bearish",
        timeframes: { "1h": -1, "4h": -1, "1d": -1 },
        timeframe_count: 3,
      },
    });
    expect(deriveEntryFilter(state).status).toBe("short_ready");
  });

  it("gibt not_aligned, wenn nicht alle Zeitrahmen uebereinstimmen", () => {
    const state = baseState({
      mtf_alignment: {
        alignment_pct: 65,
        dominant_direction: "bullish",
        timeframes: { "1h": 1, "4h": 1, "1d": -1 },
        timeframe_count: 3,
      },
    });
    expect(deriveEntryFilter(state).status).toBe("not_aligned");
  });

  it("gibt unavailable, wenn ein Zeitrahmen fehlt, auch bei 100% der verfuegbaren", () => {
    // Regressionstest fuer den Bug, den der Kommentar in entryFilter.ts
    // beschreibt: alignment_pct bezieht sich nur auf VERFUEGBARE Zeitrahmen.
    const state = baseState({
      mtf_alignment: {
        alignment_pct: 100,
        dominant_direction: "bullish",
        timeframes: { "1h": 1, "4h": 1 },
        timeframe_count: 2,
      },
    });
    expect(deriveEntryFilter(state).status).toBe("unavailable");
  });

  it("gibt unavailable, wenn mtf_alignment null ist", () => {
    expect(deriveEntryFilter(baseState({ mtf_alignment: null })).status).toBe("unavailable");
  });

  it("gibt unavailable, wenn state null ist", () => {
    expect(deriveEntryFilter(null).status).toBe("unavailable");
  });

  it("gibt not_aligned bei ranging trotz timeframe_count 3", () => {
    const state = baseState({
      mtf_alignment: {
        alignment_pct: 100,
        dominant_direction: "ranging",
        timeframes: { "1h": 0, "4h": 0, "1d": 0 },
        timeframe_count: 3,
      },
    });
    expect(deriveEntryFilter(state).status).toBe("not_aligned");
  });
});
