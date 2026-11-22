import { describe, expect, it } from "vitest";
import { driverRow, etfDateText, isUsWeekend, leverageRow, macroRow, overallSentence, usInvestorsRow } from "./lageOverview";

describe("Lage: vier Fragen", () => {
  it("Wer treibt: Spot entscheidet, nur Perp ist Hebel", () => {
    const base = { verdictLabel: "x", oiChangePct: 2.1, scenarioLabel: "Long-Aufbau" };
    expect(driverRow({ ...base, spot: "up", perp: "flat" }).light).toBe("up");
    expect(driverRow({ ...base, spot: "flat", perp: "up" })).toMatchObject({ light: "warn", chip: "nur Hebel" });
    expect(driverRow({ ...base, spot: "down", perp: "down" }).light).toBe("down");
  });

  it("Hebel: Funding ab 0,03 % oder Masse ab 65 % gilt als ueberfuellt", () => {
    const base = { liqAbove: null, liqBelow: null };
    expect(leverageRow({ ...base, fundingPct: 0.01, crowdLongPct: 58 }).light).toBe("neutral");
    expect(leverageRow({ ...base, fundingPct: 0.035, crowdLongPct: 58 }).chip).toBe("Longs überfüllt");
    expect(leverageRow({ ...base, fundingPct: 0.0, crowdLongPct: 45 }).chip).toBe("Shorts überfüllt");
  });

  it("US-Anleger: ETF und Coinbase-Praemie zaehlen, Fear & Greed nicht", () => {
    const base = { etfLastUsdM: 10, etfDays: 5, premiumLabel: null, fearGreedLabel: null };
    expect(usInvestorsRow({ ...base, etfSumUsdM: 300, premiumPct: 0.05, fearGreed: 10 }).light).toBe("up");
    expect(usInvestorsRow({ ...base, etfSumUsdM: -300, premiumPct: -0.05, fearGreed: 90 }).light).toBe("down");
    expect(usInvestorsRow({ ...base, etfSumUsdM: 300, premiumPct: -0.05, fearGreed: 50 }).light).toBe("neutral");
  });

  it("Wer treibt: Drehung schlaegt die 4H-Richtung (22.11.)", () => {
    const base = { spot: "down" as const, perp: "flat" as const, verdictLabel: "x", oiChangePct: 1.8, scenarioLabel: "y" };
    expect(driverRow({ ...base, turn: "up" })).toMatchObject({ light: "warn", chip: "Spot dreht: kauft seit 2 h" });
    expect(driverRow(base)).toMatchObject({ light: "down", chip: "Spot verkauft" });
  });

  it("US-Anleger am Wochenende grau, mit Datum", () => {
    const r = usInvestorsRow({ etfLastUsdM: -582, etfSumUsdM: -1306, etfDays: 5, premiumPct: -0.05, premiumLabel: null, fearGreed: 30, fearGreedLabel: null, etfDateText: "Do 19.11.", usClosed: true });
    expect(r).toMatchObject({ light: "neutral", chip: "US geschlossen" });
    expect(r.line).toContain("Stand Do 19.11.");
    expect(isUsWeekend(Date.parse("2026-11-22T06:20:00Z"))).toBe(true);
    expect(isUsWeekend(Date.parse("2026-11-23T15:00:00Z"))).toBe(false);
    expect(etfDateText("2026-11-19")).toBe("Do 19.11.");
  });

  it("US-Makro: Termin in 24 h ist gelb", () => {
    const r = macroRow({ next: { label: "FOMC", whenText: "morgen 20:00", hoursAway: 20 }, lastResult: null, regime: "Mixed" });
    expect(r).toMatchObject({ light: "warn", chip: "FOMC bald" });
    expect(macroRow({ next: null, lastResult: null, regime: "Risk-Off" }).light).toBe("down");
  });

  it("US-Makro: Zinskurs als Hintergrund, Widerspruch zum Regime = neutral", () => {
    const rate = { short: "Erhöhungen", light: "down" as const };
    expect(macroRow({ next: null, lastResult: null, regime: null, rate })).toMatchObject({ light: "down" });
    expect(macroRow({ next: null, lastResult: null, regime: null, rate }).line).toContain("Zinskurs Erhöhungen");
    expect(macroRow({ next: null, lastResult: null, regime: "Risk-On", rate }).light).toBe("neutral");
  });

  it("Gesamtlage in einem Satz", () => {
    const rows = [
      driverRow({ spot: "flat", perp: "up", verdictLabel: "x", oiChangePct: 1, scenarioLabel: "y" }),
      leverageRow({ fundingPct: 0.035, crowdLongPct: 66, liqAbove: null, liqBelow: null }),
      usInvestorsRow({ etfLastUsdM: -50, etfSumUsdM: -400, etfDays: 5, premiumPct: -0.06, premiumLabel: null, fearGreed: 38, fearGreedLabel: null }),
      macroRow({ next: { label: "FOMC", whenText: "9.12.", hoursAway: 72 }, lastResult: null, regime: null }),
    ];
    expect(overallSentence(rows)).toEqual({
      light: "warn",
      text: "Gegenwind: nur der Hebel treibt, US-Anleger ziehen ab. Longs überfüllt, Gegenbewegung möglich.",
    });
  });
});
