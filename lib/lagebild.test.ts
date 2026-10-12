import { describe, expect, it } from "vitest";
import type { MtfDotStatus, MtfTimeframeDot } from "./mtfSignal";
import type { ConfluenceScoreRow } from "./confluenceScoreContext";
import type { RegimeScoreRow } from "./regimeScoreContext";
import {
  buildLagebildSentence,
  countMtfDirections,
  detectMtfStateConflict,
  regimeLean,
  setupLead,
} from "./lagebild";

function dots(...statuses: MtfDotStatus[]): MtfTimeframeDot[] {
  return ["15M", "1H", "4H", "1D", "1W"].map((timeframe, i) => ({ timeframe, status: statuses[i], detail: "" }));
}

function setupRow(direction: "LONG" | "SHORT", probability: number, tier: "Niedrig" | "Mittel" | "Hoch"): ConfluenceScoreRow {
  return {
    direction, probability, tier, trendCount: 0, trendSignals: [], fearGreedActive: false, fearGreedValue: null,
    fearGreedClassification: null, makroActive: false, makroRegime: null, orderbuchActive: false,
    orderbuchImbalance: null, dataAsof: "",
  };
}

function regimeRow(direction: "UP" | "DOWN", probability: number): RegimeScoreRow {
  return {
    direction, probability, tier: "Mittel", trendKonsens: 0, cvdZActive: false, momentumActive: null,
    bollingerPctbActive: null, dxyActive: null, cciActive: null, fragileBullishActive: null, dataAsof: "",
  } as RegimeScoreRow;
}

// Live-Stand 11.10.2026 16:00 (Entwurf "Nexus Lagebild")
const LIVE_DOTS = dots("bullish_forming", "bullish_forming", "bearish_forming", "bearish_confirmed", "bullish_confirmed");
// Beobachtung Toby 10.10.2026: Bullish bei 36/100, nur 1 von 5 gruen
const CONFLICT_DOTS = dots("bullish_confirmed", "bearish_forming", "bearish_forming", "bearish_confirmed", "neutral");

describe("countMtfDirections", () => {
  it("zaehlt bestaetigt und Trendbildung gleichermassen", () => {
    expect(countMtfDirections(LIVE_DOTS)).toEqual({
      bullish: 3, bearish: 2, neutral: 0, bullishForming: 2, bearishForming: 1,
    });
  });
  it("wertet fehlende Daten als neutral", () => {
    expect(countMtfDirections(dots("no_data", "neutral", "bullish_confirmed", "no_data", "no_data"))).toEqual({
      bullish: 1, bearish: 0, neutral: 4, bullishForming: 0, bearishForming: 0,
    });
  });
});

describe("detectMtfStateConflict", () => {
  it("warnt bei Bullish und 3 baerischen Zeitrahmen", () => {
    expect(detectMtfStateConflict("BULLISH", false, CONFLICT_DOTS)).toEqual({ direction: "bullish", opposing: 3, total: 5 });
  });
  it("warnt nicht, wenn nur 2 Zeitrahmen widersprechen", () => {
    expect(detectMtfStateConflict("BULLISH", false, LIVE_DOTS)).toBeNull();
  });
  it("warnt nicht bei unterdrueckter Richtung", () => {
    expect(detectMtfStateConflict("BULLISH", true, CONFLICT_DOTS)).toBeNull();
  });
  it("warnt nicht ohne Richtung", () => {
    expect(detectMtfStateConflict("NEUTRAL", false, CONFLICT_DOTS)).toBeNull();
  });
  it("warnt auch bei Bearish gegen bullische Zeitrahmen", () => {
    const bullish = dots("bullish_confirmed", "bullish_forming", "bullish_forming", "neutral", "bearish_confirmed");
    expect(detectMtfStateConflict("BEARISH", false, bullish)?.opposing).toBe(3);
  });
});

describe("setupLead / regimeLean", () => {
  it("waehlt die Seite mit hoeherer Wahrscheinlichkeit", () => {
    const lead = setupLead({ long: setupRow("LONG", 13.2, "Niedrig"), short: setupRow("SHORT", 20.9, "Mittel") });
    expect(lead).toMatchObject({ side: "Short", probability: 20.9, tier: "Mittel", otherProbability: 13.2 });
  });
  it("liefert null ohne Daten", () => {
    expect(setupLead({ long: null, short: null })).toBeNull();
  });
  it("gilt bei weniger als 2 Prozentpunkten Abstand als ausgeglichen", () => {
    expect(regimeLean({ up: regimeRow("UP", 29.7), down: regimeRow("DOWN", 29.6) })).toBe("ausgeglichen");
    expect(regimeLean({ up: regimeRow("UP", 35), down: regimeRow("DOWN", 29.6) })).toBe("aufwärts");
    expect(regimeLean({ up: null, down: regimeRow("DOWN", 29.6) })).toBeNull();
  });
});

describe("buildLagebildSentence", () => {
  const setup = setupLead({ long: setupRow("LONG", 13.2, "Niedrig"), short: setupRow("SHORT", 20.9, "Mittel") });

  it("Live-Stand 11.10.: unklar, gemischte Zeitrahmen", () => {
    expect(
      buildLagebildSentence({ overallState: "BULLISH", directionSuppressed: true, conflict: null, dots: LIVE_DOTS, setup, regime: "ausgeglichen" })
    ).toBe(
      "Keine klare Richtung. Kurzfristig (15M/1H) bullisch, übergeordnet (4H/1D) bärisch. Setup-Score bevorzugt Short (20.9 %, Mittel), Regime-Score ausgeglichen."
    );
  });

  it("Widerspruch: leicht bullisch, nicht bestaetigt", () => {
    const conflict = detectMtfStateConflict("BULLISH", false, CONFLICT_DOTS);
    expect(
      buildLagebildSentence({ overallState: "BULLISH", directionSuppressed: false, conflict, dots: CONFLICT_DOTS, setup: null, regime: null })
    ).toBe("Leicht bullisch, aber übergeordnet nicht bestätigt.");
  });

  it("zu wenige Daten", () => {
    expect(
      buildLagebildSentence({ overallState: "INSUFFICIENT_DATA", directionSuppressed: false, conflict: null, dots: [], setup: null, regime: null })
    ).toBe("Zu wenige Daten für eine Einschätzung.");
  });
});
