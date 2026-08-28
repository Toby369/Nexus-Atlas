import { describe, it, expect } from "vitest";
import {
  classifyMarketContext,
  getMarketContextThresholds,
  COVERAGE_GATE_MIN_MINUTES,
  MIN_HISTORY_COVERAGE_PCT,
} from "./marketContext";

// Erste automatisierte Tests fuer dieses Projekt (Audit-Befund: kein
// Test-Framework vorhanden). classifyMarketContext ist reine, deterministische
// Logik -- ideal fuer Unit-Tests, deckt genau die Szenarien ab, die den
// urspruenglichen "Keine klare Struktur"-Bug (siehe Kommentare in
// marketContext.ts) verursacht hatten.

describe("getMarketContextThresholds", () => {
  it("liefert die Basis-Schwellenwerte unveraendert bei 60 Minuten (Kalibrierungspunkt)", () => {
    const { priceFlatThresholdPct, oiFlatThresholdPct } = getMarketContextThresholds(60);
    expect(priceFlatThresholdPct).toBeCloseTo(0.4, 5);
    expect(oiFlatThresholdPct).toBeCloseTo(0.4, 5);
  });

  it("skaliert kuerzere Zeitraeume auf kleinere Schwellenwerte (Wurzel-Zeit)", () => {
    const short = getMarketContextThresholds(15);
    const base = getMarketContextThresholds(60);
    expect(short.priceFlatThresholdPct).toBeLessThan(base.priceFlatThresholdPct);
    // sqrt(15/60) = 0.5
    expect(short.priceFlatThresholdPct).toBeCloseTo(0.4 * 0.5, 5);
  });

  it("skaliert laengere Zeitraeume auf groessere Schwellenwerte", () => {
    const long = getMarketContextThresholds(240);
    const base = getMarketContextThresholds(60);
    expect(long.priceFlatThresholdPct).toBeGreaterThan(base.priceFlatThresholdPct);
  });
});

describe("classifyMarketContext", () => {
  const baseInput = {
    hasFullOiHistory: true,
    spotDataQuality: "OK" as const,
    timeframeMinutes: 60,
    // Neutral: volle Abdeckung, konsistente Boersen-Menge -- die neuen
    // LOCKED-Gates werden in eigenen Tests unten gezielt geprueft, hier
    // sollen sie fuer alle bestehenden Szenarien inaktiv bleiben.
    historyCoveragePct: 100,
    earliestDataAgeDays: 0,
    oiExchangeSetConsistent: true as boolean | null,
  };

  it("liefert INSUFFICIENT_DATA, wenn Preis oder OI fehlen", () => {
    const result = classifyMarketContext({
      ...baseInput,
      priceChangePct: null,
      oiChangePct: 1,
      spotNetFlowPct: 0,
    });
    expect(result.scenario).toBeNull();
    expect(result.dataQuality).toBe("INSUFFICIENT_DATA");
    expect(result.bias).toBe("neutral");
  });

  it("erkennt Long-Aufbau bei steigendem Preis und steigendem OI, spot-bestaetigt", () => {
    const result = classifyMarketContext({
      ...baseInput,
      priceChangePct: 1.5,
      oiChangePct: 1.5,
      spotNetFlowPct: 10,
    });
    expect(result.scenario).toBe("long_buildup");
    expect(result.bias).toBe("bullish");
    expect(result.confirmed).toBe(true);
  });

  it("erkennt Long-Aufbau ohne Spot-Bestaetigung, wenn Spot-Flow gegenlaeufig ist", () => {
    const result = classifyMarketContext({
      ...baseInput,
      priceChangePct: 1.5,
      oiChangePct: 1.5,
      spotNetFlowPct: -10,
    });
    expect(result.scenario).toBe("long_buildup");
    expect(result.confirmed).toBe(false);
  });

  it("erkennt Short-Covering bei steigendem Preis und fallendem OI", () => {
    const result = classifyMarketContext({
      ...baseInput,
      priceChangePct: 1.5,
      oiChangePct: -1.5,
      spotNetFlowPct: 0,
    });
    expect(result.scenario).toBe("short_covering");
    expect(result.bias).toBe("bullish");
    // spotNetFlowPct=0 ist ein bekannter Wert (nicht null) unterhalb der
    // Kaufschwelle -> "nicht bestaetigt" (false), nicht "unbekannt" (null).
    expect(result.confirmed).toBe(false);
  });

  it("erkennt Short-Aufbau bei fallendem Preis und steigendem OI", () => {
    const result = classifyMarketContext({
      ...baseInput,
      priceChangePct: -1.5,
      oiChangePct: 1.5,
      spotNetFlowPct: -10,
    });
    expect(result.scenario).toBe("short_buildup");
    expect(result.bias).toBe("bearish");
    expect(result.confirmed).toBe(true);
  });

  it("erkennt Long-Abbau bei fallendem Preis und fallendem OI", () => {
    const result = classifyMarketContext({
      ...baseInput,
      priceChangePct: -1.5,
      oiChangePct: -1.5,
      spotNetFlowPct: -10,
    });
    expect(result.scenario).toBe("long_unwind");
    expect(result.bias).toBe("bearish");
  });

  it("liefert 'Keine klare Struktur' (neutral), wenn Preis/OI innerhalb der Flat-Schwelle bleiben", () => {
    const result = classifyMarketContext({
      ...baseInput,
      priceChangePct: 0.05,
      oiChangePct: 0.05,
      spotNetFlowPct: 0,
    });
    expect(result.scenario).toBe("neutral");
    expect(result.label).toBe("Keine klare Struktur");
    expect(result.bias).toBe("neutral");
  });

  it("markiert das Ergebnis als PRELIMINARY, wenn die OI-Historie den Zeitraum nicht voll abdeckt", () => {
    const result = classifyMarketContext({
      ...baseInput,
      hasFullOiHistory: false,
      priceChangePct: 1.5,
      oiChangePct: 1.5,
      spotNetFlowPct: 10,
    });
    expect(result.dataQuality).toBe("PRELIMINARY");
  });

  it("markiert das Ergebnis als PRELIMINARY, wenn die Spot-Datenqualitaet nicht OK ist", () => {
    const result = classifyMarketContext({
      ...baseInput,
      spotDataQuality: "PRELIMINARY",
      priceChangePct: 1.5,
      oiChangePct: 1.5,
      spotNetFlowPct: 10,
    });
    expect(result.dataQuality).toBe("PRELIMINARY");
  });

  it("liefert 'unknown'-Erklaerung statt confirmed/unconfirmed, wenn Spot-Flow null ist", () => {
    const result = classifyMarketContext({
      ...baseInput,
      priceChangePct: 1.5,
      oiChangePct: 1.5,
      spotNetFlowPct: null,
    });
    expect(result.confirmed).toBeNull();
    expect(result.explanation).toContain("nicht verfügbar");
  });

  describe("Coverage-Sperre (1W/1M, < 80% Abdeckung)", () => {
    it("sperrt die Interpretation bei langem Zeitraum und Abdeckung unter der Schwelle", () => {
      const result = classifyMarketContext({
        ...baseInput,
        timeframeMinutes: COVERAGE_GATE_MIN_MINUTES,
        historyCoveragePct: MIN_HISTORY_COVERAGE_PCT - 1,
        earliestDataAgeDays: 5,
        priceChangePct: 1.5,
        oiChangePct: 1.5,
        spotNetFlowPct: 10,
      });
      expect(result.scenario).toBeNull();
      expect(result.dataQuality).toBe("LOCKED");
      expect(result.label).toBe("Auskunft gesperrt");
      expect(result.explanation).toContain("5 Tage");
      expect(result.explanation).toContain(`${MIN_HISTORY_COVERAGE_PCT}%`);
    });

    it("sperrt NICHT bei exakt der Schwelle (>= ist ausreichend)", () => {
      const result = classifyMarketContext({
        ...baseInput,
        timeframeMinutes: COVERAGE_GATE_MIN_MINUTES,
        historyCoveragePct: MIN_HISTORY_COVERAGE_PCT,
        earliestDataAgeDays: 7,
        priceChangePct: 1.5,
        oiChangePct: 1.5,
        spotNetFlowPct: 10,
      });
      expect(result.dataQuality).not.toBe("LOCKED");
    });

    it("sperrt NICHT bei kurzen Zeitraeumen, selbst bei niedriger Abdeckung", () => {
      const result = classifyMarketContext({
        ...baseInput,
        timeframeMinutes: 60,
        historyCoveragePct: 10,
        earliestDataAgeDays: 0.02,
        priceChangePct: 1.5,
        oiChangePct: 1.5,
        spotNetFlowPct: 10,
      });
      expect(result.dataQuality).not.toBe("LOCKED");
    });

    it("sperrt NICHT, wenn historyCoveragePct nicht berechenbar ist (null)", () => {
      const result = classifyMarketContext({
        ...baseInput,
        timeframeMinutes: COVERAGE_GATE_MIN_MINUTES,
        historyCoveragePct: null,
        earliestDataAgeDays: null,
        priceChangePct: 1.5,
        oiChangePct: 1.5,
        spotNetFlowPct: 10,
      });
      expect(result.dataQuality).not.toBe("LOCKED");
    });
  });

  describe("Boersen-Onboarding-Sperre (OI-Delta ueber inkonsistente Boersen-Menge)", () => {
    it("sperrt die Interpretation, wenn die Boersen-Menge nicht konstant war", () => {
      const result = classifyMarketContext({
        ...baseInput,
        oiExchangeSetConsistent: false,
        priceChangePct: 1.5,
        oiChangePct: 1.5,
        spotNetFlowPct: 10,
      });
      expect(result.scenario).toBeNull();
      expect(result.dataQuality).toBe("LOCKED");
      expect(result.explanation).toContain("Börsen-Onboarding-Artefakt");
    });

    it("sperrt NICHT, wenn die Konsistenz nicht geprueft werden konnte (null)", () => {
      const result = classifyMarketContext({
        ...baseInput,
        oiExchangeSetConsistent: null,
        priceChangePct: 1.5,
        oiChangePct: 1.5,
        spotNetFlowPct: 10,
      });
      expect(result.dataQuality).not.toBe("LOCKED");
    });

    it("sperrt NICHT bei bestaetigt konsistenter Boersen-Menge", () => {
      const result = classifyMarketContext({
        ...baseInput,
        oiExchangeSetConsistent: true,
        priceChangePct: 1.5,
        oiChangePct: 1.5,
        spotNetFlowPct: 10,
      });
      expect(result.dataQuality).not.toBe("LOCKED");
    });
  });
});
