import { describe, expect, it } from "vitest";
import type { MtfDotStatus, MtfTimeframeDot } from "./mtfSignal";
import { buildLagebildSentence, countMtfDirections, detectMtfStateConflict } from "./lagebild";

function dots(...statuses: MtfDotStatus[]): MtfTimeframeDot[] {
  return ["15M", "1H", "4H", "1D", "1W"].map((timeframe, i) => ({ timeframe, status: statuses[i], detail: "" }));
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

describe("buildLagebildSentence", () => {
  it("Live-Stand 11.10.: unklar, gemischte Zeitrahmen", () => {
    expect(
      buildLagebildSentence({ overallState: "BULLISH", directionSuppressed: true, conflict: null, dots: LIVE_DOTS })
    ).toBe(
      "Keine klare Richtung. Kurzfristig (15M/1H) bullisch, übergeordnet (4H/1D) bärisch."
    );
  });

  it("Widerspruch: leicht bullisch, nicht bestaetigt", () => {
    const conflict = detectMtfStateConflict("BULLISH", false, CONFLICT_DOTS);
    expect(
      buildLagebildSentence({ overallState: "BULLISH", directionSuppressed: false, conflict, dots: CONFLICT_DOTS })
    ).toBe("Leicht bullisch, aber übergeordnet nicht bestätigt.");
  });

  it("zu wenige Daten", () => {
    expect(
      buildLagebildSentence({ overallState: "INSUFFICIENT_DATA", directionSuppressed: false, conflict: null, dots: [] })
    ).toBe("Zu wenige Daten für eine Einschätzung.");
  });
});
