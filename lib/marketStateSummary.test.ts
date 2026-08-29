import { describe, it, expect } from "vitest";
import {
  buildCompactMarketStateSummary,
  isDirectionalLabelSuppressed,
  DIRECTIONAL_LABEL_CONFIDENCE_THRESHOLD,
  computeConfidenceBreakdown,
  computeEngineDivergence,
  engineDivergenceStatusLabel,
  ENGINE_DIVERGENCE_HIGH_LABEL,
} from "./marketStateSummary";
import type { MarketRegime, MarketState, MarketStateFactor } from "./types";

function factor(value: -1 | 0 | 1 | null): MarketStateFactor {
  return { value, basis: {} };
}

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

describe("computeConfidenceBreakdown", () => {
  it("rekonstruiert exakt die reale Fallstudie vom 2026-08-29 (Confidence 14)", () => {
    // 12 verfuegbare Faktoren (2 fehlend): 4 positiv, 2 negativ, 6 neutral.
    // Coverage 85.7%, Confidence 14 -- Live-Werte aus market_states.
    const breakdown = computeConfidenceBreakdown({
      data_coverage_pct: 85.7,
      factors: {
        structure: factor(1),
        cvd: factor(1),
        positioning: factor(1),
        options: factor(1),
        orderbook: factor(-1),
        trend_strength: factor(-1),
        momentum: factor(0),
        macro: factor(0),
        funding: factor(0),
        sentiment: factor(0),
        trend_regime: factor(0),
        vwap_position: factor(0),
        oi_price: factor(null),
        basis: factor(null),
      },
    });
    expect(breakdown.coveragePct).toBe(85.7);
    expect(breakdown.signalStrengthPct).toBeCloseTo((6 / 12) * 100, 5);
    expect(breakdown.consensusPct).toBeCloseTo((4 / 6) * 100, 5);
    // Coverage * SignalStrength * |2*Consensus-1| muss die reale
    // gespeicherte Confidence (14) reproduzieren -- keine neu erfundene
    // Kennzahl, nur eine Zerlegung derselben Formel.
    const reconstructed =
      (breakdown.coveragePct / 100) *
      (breakdown.signalStrengthPct / 100) *
      Math.abs(2 * (breakdown.consensusPct! / 100) - 1) *
      100;
    expect(Math.round(reconstructed)).toBe(14);
  });

  it("Consensus ist 100%, wenn alle gerichteten Faktoren einig sind", () => {
    const breakdown = computeConfidenceBreakdown({
      data_coverage_pct: 100,
      factors: { a: factor(1), b: factor(1), c: factor(0) },
    });
    expect(breakdown.consensusPct).toBe(100);
    expect(breakdown.signalStrengthPct).toBeCloseTo((2 / 3) * 100, 5);
  });

  it("Consensus ist null (kein erfundener Wert), wenn kein Faktor eine Richtung zeigt", () => {
    const breakdown = computeConfidenceBreakdown({
      data_coverage_pct: 50,
      factors: { a: factor(0), b: factor(0) },
    });
    expect(breakdown.consensusPct).toBeNull();
    expect(breakdown.signalStrengthPct).toBe(0);
  });

  it("Consensus ist null, wenn kein einziger Faktor Daten hat", () => {
    const breakdown = computeConfidenceBreakdown({
      data_coverage_pct: 0,
      factors: { a: factor(null), b: factor(null) },
    });
    expect(breakdown.consensusPct).toBeNull();
    expect(breakdown.signalStrengthPct).toBe(0);
    expect(breakdown.coveragePct).toBe(0);
  });
});

describe("computeEngineDivergence", () => {
  it("meldet AGREEMENT, wenn beide Engines dieselbe Richtung zeigen (bullisch)", () => {
    expect(computeEngineDivergence("BULLISH", "TREND_EXPANSION_BULLISH")).toBe("AGREEMENT");
  });

  it("meldet AGREEMENT, wenn beide Engines dieselbe Richtung zeigen (bärisch)", () => {
    expect(computeEngineDivergence("BEARISH", "TREND_EXPANSION_BEARISH")).toBe("AGREEMENT");
  });

  it("meldet DIVERGENCE, wenn die Engines entgegengesetzte Richtungen zeigen", () => {
    expect(computeEngineDivergence("BULLISH", "TREND_EXPANSION_BEARISH")).toBe("DIVERGENCE");
    expect(computeEngineDivergence("BEARISH", "TREND_EXPANSION_BULLISH")).toBe("DIVERGENCE");
  });

  it("meldet NOT_COMPARABLE, wenn Market State keine gerichtete Aussage liefert", () => {
    const nonDirectional: MarketState["overall_state"][] = ["NEUTRAL", "MIXED", "INSUFFICIENT_DATA"];
    for (const state of nonDirectional) {
      expect(computeEngineDivergence(state, "TREND_EXPANSION_BULLISH")).toBe("NOT_COMPARABLE");
    }
  });

  it("meldet NOT_COMPARABLE, wenn das Regime nicht gerichtet ist", () => {
    const nonDirectional: MarketRegime[] = [
      "HIGH_VOLA_REVERSION",
      "VOLA_SQUEEZE_RANGING",
      "UNRESOLVED_NEUTRAL",
    ];
    for (const regime of nonDirectional) {
      expect(computeEngineDivergence("BULLISH", regime)).toBe("NOT_COMPARABLE");
    }
  });

  it("meldet NOT_COMPARABLE, wenn eine der beiden Engines noch keinen Wert hat (null)", () => {
    expect(computeEngineDivergence(null, "TREND_EXPANSION_BULLISH")).toBe("NOT_COMPARABLE");
    expect(computeEngineDivergence("BULLISH", null)).toBe("NOT_COMPARABLE");
    expect(computeEngineDivergence(null, null)).toBe("NOT_COMPARABLE");
  });

  it("bildet die reale Fallstudie vom 2026-08-29 korrekt ab (MIXED -> NOT_COMPARABLE)", () => {
    // Market State war an dem Tag MIXED (kein BULLISH/BEARISH), Regime
    // Matrix TREND_EXPANSION_BEARISH -- ein binaerer Richtungsvergleich
    // greift hier bewusst nicht, siehe docs/research/
    // METHODIC_DIVERGENCE_2026-08-29.md fuer die vollstaendige Einordnung.
    expect(computeEngineDivergence("MIXED", "TREND_EXPANSION_BEARISH")).toBe("NOT_COMPARABLE");
  });
});

describe("engineDivergenceStatusLabel", () => {
  it("liefert den festen High-Severity-Status nur bei DIVERGENCE", () => {
    expect(engineDivergenceStatusLabel("DIVERGENCE")).toBe(ENGINE_DIVERGENCE_HIGH_LABEL);
  });

  it("liefert null bei AGREEMENT und NOT_COMPARABLE -- nichts zu warnen", () => {
    expect(engineDivergenceStatusLabel("AGREEMENT")).toBeNull();
    expect(engineDivergenceStatusLabel("NOT_COMPARABLE")).toBeNull();
  });
});
