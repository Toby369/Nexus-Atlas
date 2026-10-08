import { describe, expect, it } from "vitest";
import {
  sliceForRegelwerk,
  sliceForChartStruktur,
  sliceForTrigger,
  sliceForSynthese,
  type SystemBriefingContext,
} from "./systemBriefingContext";

// Minimaler Fixture-Kontext (08.10.2026, Teil des strukturellen Umbaus auf
// vier Teil-Aufrufe) -- die sliceFor*-Funktionen sind reine Zuschnitte (nur
// Feld-Auswahl, keine Berechnung), deshalb reicht ein Objekt mit Platzhalter-
// Werten statt einem vollstaendig typisierten Kontext. "as unknown as" ist
// hier bewusst, da jedes Feld ohnehin nur 1:1 durchgereicht wird.
function fixtureContext(overrides: Record<string, unknown> = {}): SystemBriefingContext {
  return {
    generated_at: "2026-10-08T00:00:00.000Z",
    bewegungsvorrat: { today_range_usd: 1000, median_range_10d_usd: 900, ratio_pct: 111 },
    market_state: { overall_state: "BULLISH", score: 5, confidence: 70, data_coverage_pct: 90, risk_level: "LOW", risk_factors: [], patterns: [], mtf_alignment: null, factors: {} },
    confidence_breakdown: { coveragePct: 90, consensusPct: 80, signalStrengthPct: 70 },
    mein_system_checklist: { ema13: 1, ema50: 2, ema200: 3 },
    trading_indicators: { cvd: { trend: "bullish" }, vwapVector: {} },
    liquidations: null,
    regelwerk: [{ module: "welz", section: "s1", title: "t1", content: "c1" }],
    market_context: { label: "L", bias: "bullish", explanation: "E", price_change_pct: 1, oi_change_pct: 1, spot_verdict_label: "V" },
    etf_flows: { cumulative_usd_m: 10, days: 5 },
    positioning: { confidence: 50 },
    news: { count: 2, lookback_hours: 72 },
    triangle: null,
    continuationFormation: null,
    swingFormations: [],
    recentCandlestickPatterns: [],
    keyLevels: [{ price: 90000, side: "resistance", timeframes: ["1d"], confirmedBy: [], liquidationNotionalUsd: null, spotVolume: null, anchorOpenTime: null }],
    levelStruktur: [],
    ...overrides,
  } as unknown as SystemBriefingContext;
}

describe("sliceForRegelwerk", () => {
  it("enthaelt nur regelwerk/bewegungsvorrat/mein_system_checklist/trading_indicators/liquidations", () => {
    const ctx = fixtureContext();
    const slice = sliceForRegelwerk(ctx);
    expect(Object.keys(slice).sort()).toEqual(
      ["bewegungsvorrat", "liquidations", "mein_system_checklist", "regelwerk", "trading_indicators"].sort()
    );
    expect(slice.regelwerk).toBe(ctx.regelwerk);
    expect(slice.bewegungsvorrat).toBe(ctx.bewegungsvorrat);
  });
  it("enthaelt KEINE Chart-Struktur- oder market_state-Felder (eigener Teil-Aufruf)", () => {
    const slice = sliceForRegelwerk(fixtureContext()) as Record<string, unknown>;
    expect(slice.triangle).toBeUndefined();
    expect(slice.market_state).toBeUndefined();
    expect(slice.keyLevels).toBeUndefined();
  });
});

describe("sliceForChartStruktur", () => {
  it("enthaelt nur die Chart-Struktur-Felder", () => {
    const ctx = fixtureContext();
    const slice = sliceForChartStruktur(ctx);
    expect(Object.keys(slice).sort()).toEqual(
      ["continuationFormation", "keyLevels", "levelStruktur", "recentCandlestickPatterns", "swingFormations", "triangle"].sort()
    );
    expect(slice.keyLevels).toBe(ctx.keyLevels);
  });
  it("enthaelt KEIN Regelwerk (eigener Teil-Aufruf)", () => {
    const slice = sliceForChartStruktur(fixtureContext()) as Record<string, unknown>;
    expect(slice.regelwerk).toBeUndefined();
  });
});

describe("sliceForTrigger", () => {
  it("enthaelt nur keyLevels/mein_system_checklist/trading_indicators", () => {
    const ctx = fixtureContext();
    const slice = sliceForTrigger(ctx);
    expect(Object.keys(slice).sort()).toEqual(["keyLevels", "mein_system_checklist", "trading_indicators"].sort());
    expect(slice.keyLevels).toBe(ctx.keyLevels);
  });
});

describe("sliceForSynthese", () => {
  it("kombiniert die drei Teil-Ergebnisse mit dem Abgleichs-Schnitt, keine Rohdaten der anderen Teil-Aufrufe", () => {
    const ctx = fixtureContext();
    const parts = {
      regelwerkCheck: { regelwerkCheck: "Gates: ok", leanBias: "bullish" as const },
      chartStruktur: { chartStruktur: "Dreieck steigend", leanBias: "neutral" as const },
      trigger: { bullish: { bedingungen: [], kursziel: null }, bearish: { bedingungen: [], kursziel: null }, invalidierung: "x" },
    };
    const slice = sliceForSynthese(ctx, parts);
    expect(slice.regelwerkCheck).toBe("Gates: ok");
    expect(slice.regelwerkLeanBias).toBe("bullish");
    expect(slice.chartStruktur).toBe("Dreieck steigend");
    expect(slice.chartLeanBias).toBe("neutral");
    expect(slice.trigger).toBe(parts.trigger);
    expect(slice.market_state).toBe(ctx.market_state);
    expect(slice.bewegungsvorrat_ratio_pct).toBe(ctx.bewegungsvorrat.ratio_pct);
    // keine Chart-Struktur-Rohdaten (triangle etc.) -- Synthese bekommt nur
    // das bereits fertige chartStruktur-Fazit des Teil-Aufrufs, nicht die
    // Formationsdaten dahinter.
    expect((slice as Record<string, unknown>).triangle).toBeUndefined();
    expect((slice as Record<string, unknown>).keyLevels).toBeUndefined();
  });
});
