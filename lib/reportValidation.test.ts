import { describe, it, expect } from "vitest";
import { validateReportAgainstData } from "./reportValidation";

function positioningContext(longRatios: {
  binance?: number | null;
  bybit?: number | null;
  okx?: number | null;
  topTraderBinance?: number | null;
}) {
  return {
    positioning: {
      binance: {
        global_long_account_ratio: longRatios.binance ?? null,
        top_trader_long_account_ratio: longRatios.topTraderBinance ?? null,
      },
      bybit: { global_long_account_ratio: longRatios.bybit ?? null, top_trader_long_account_ratio: null },
      okx: { global_long_account_ratio: longRatios.okx ?? null, top_trader_long_account_ratio: null },
      signal: null,
    },
  };
}

describe("validateReportAgainstData", () => {
  it("ok, wenn der Text keine ueberprueften Aussagen enthaelt", () => {
    const result = validateReportAgainstData(
      { bias: "neutral", confidence: 50, summary: "Der Markt bewegt sich seitwaerts." },
      positioningContext({ binance: 0.6 })
    );
    expect(result.status).toBe("ok");
    expect(result.contradictions).toEqual([]);
  });

  it("ok, wenn Retail-Behauptung mit den Rohdaten uebereinstimmt", () => {
    const result = validateReportAgainstData(
      { summary: "Retail ist aktuell klar short positioniert." },
      positioningContext({ binance: 0.3, bybit: 0.35 })
    );
    expect(result.status).toBe("ok");
  });

  it("flaggt einen Widerspruch: Text behauptet Retail short, Rohdaten zeigen long", () => {
    const result = validateReportAgainstData(
      { summary: "Retail ist überwiegend short positioniert, während Top Trader long bleiben." },
      positioningContext({ binance: 0.65, bybit: 0.7 })
    );
    expect(result.status).toBe("flagged_contradiction");
    expect(result.contradictions.length).toBeGreaterThan(0);
    expect(result.contradictions[0]).toContain("Retail short");
    expect(result.contradictions[0]).toContain("67.5%");
  });

  it("flaggt einen Widerspruch bei Top-Trader-Behauptung gegen die Rohdaten", () => {
    const result = validateReportAgainstData(
      { summary: "Top Trader sind aktuell short unterwegs." },
      positioningContext({ topTraderBinance: 0.8 })
    );
    expect(result.status).toBe("flagged_contradiction");
    expect(result.contradictions[0]).toContain("Top Trader short");
  });

  it("prueft keyFactors zusaetzlich zur summary", () => {
    const result = validateReportAgainstData(
      { summary: "Neutral.", keyFactors: ["Retail eindeutig short trotz steigendem Preis"] },
      positioningContext({ binance: 0.75 })
    );
    expect(result.status).toBe("flagged_contradiction");
  });

  it("ok, wenn kein Rohdaten-Feld fuer die Behauptung vorhanden ist (kein Fehlalarm)", () => {
    const result = validateReportAgainstData({ summary: "Retail ist short positioniert." }, {});
    expect(result.status).toBe("ok");
  });

  it("ok, wenn positioning-Feld vorhanden aber alle Ratios null sind", () => {
    const result = validateReportAgainstData(
      { summary: "Retail ist short positioniert." },
      positioningContext({})
    );
    expect(result.status).toBe("ok");
  });

  it("flaggt einen Funding-Widerspruch", () => {
    const result = validateReportAgainstData(
      { summary: "Die Funding Rate ist aktuell deutlich negativ." },
      { funding: { avg_current_rate: 0.0006 } }
    );
    expect(result.status).toBe("flagged_contradiction");
    expect(result.contradictions[0]).toContain("Funding");
  });

  it("ok bei uebereinstimmender Funding-Aussage", () => {
    const result = validateReportAgainstData(
      { summary: "Die Funding Rate ist aktuell positiv." },
      { funding: { avg_current_rate: 0.0003 } }
    );
    expect(result.status).toBe("ok");
  });

  it("sammelt mehrere Widersprueche gleichzeitig", () => {
    const result = validateReportAgainstData(
      { summary: "Retail short, Top Trader short, Funding negativ." },
      {
        ...positioningContext({ binance: 0.7, topTraderBinance: 0.7 }),
        funding: { avg_current_rate: 0.0005 },
      }
    );
    expect(result.status).toBe("flagged_contradiction");
    expect(result.contradictions.length).toBe(3);
  });

  it("ok bei leerem/nicht-textuellem data-Objekt", () => {
    expect(validateReportAgainstData(null, {}).status).toBe("ok");
    expect(validateReportAgainstData({}, {}).status).toBe("ok");
    expect(validateReportAgainstData(undefined, {}).status).toBe("ok");
  });

  it("liest conflicts/componentBiases (Master-Report-Schema) und items (News-Schema)", () => {
    const masterResult = validateReportAgainstData(
      { conflicts: ["Retail short trotz bullischer Struktur"], componentBiases: {} },
      positioningContext({ binance: 0.8 })
    );
    expect(masterResult.status).toBe("flagged_contradiction");

    const newsResult = validateReportAgainstData(
      { items: [{ headline: "X", reasoning: "Retail short trotz Rally" }], summary: "..." },
      positioningContext({ binance: 0.8 })
    );
    expect(newsResult.status).toBe("flagged_contradiction");
  });
});
