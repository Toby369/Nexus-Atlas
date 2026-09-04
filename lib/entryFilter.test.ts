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

function withTimeframes(timeframes: Record<string, -1 | 0 | 1>): MarketState {
  return baseState({
    mtf_alignment: {
      alignment_pct: 0,
      dominant_direction: "ranging",
      timeframes,
      timeframe_count: Object.keys(timeframes).length,
    },
  });
}

describe("deriveEntryFilter", () => {
  it("gibt long_ready, wenn 4h bullisch ist", () => {
    expect(deriveEntryFilter(withTimeframes({ "1h": -1, "4h": 1, "1d": -1 })).status).toBe(
      "long_ready"
    );
  });

  it("gibt short_ready, wenn 4h baerisch ist", () => {
    expect(deriveEntryFilter(withTimeframes({ "1h": 1, "4h": -1, "1d": 1 })).status).toBe(
      "short_ready"
    );
  });

  it("gibt not_aligned, wenn 4h range-gebunden (0) ist", () => {
    expect(deriveEntryFilter(withTimeframes({ "4h": 0 })).status).toBe("not_aligned");
  });

  it("ignoriert 1h/1d -- nur 4h zaehlt", () => {
    // Regressionstest: 1h und 1d sind bullisch, 4h baerisch -- soll trotzdem
    // short_ready sein, weil seit der Umstellung nur noch 4h massgeblich ist.
    expect(deriveEntryFilter(withTimeframes({ "1h": 1, "4h": -1, "1d": 1 })).status).toBe(
      "short_ready"
    );
  });

  it("gibt unavailable, wenn der 4h-Zeitrahmen fehlt (veraltet)", () => {
    expect(deriveEntryFilter(withTimeframes({ "1h": 1, "1d": 1 })).status).toBe("unavailable");
  });

  it("gibt unavailable, wenn mtf_alignment null ist", () => {
    expect(deriveEntryFilter(baseState({ mtf_alignment: null })).status).toBe("unavailable");
  });

  it("gibt unavailable, wenn state null ist", () => {
    expect(deriveEntryFilter(null).status).toBe("unavailable");
  });
});
