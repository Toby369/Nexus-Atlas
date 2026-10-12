import { describe, expect, it } from "vitest";
import { findTechnicalIdentifiers, getPromptProfile } from "./promptProfiles";

describe("findTechnicalIdentifiers", () => {
  it("laesst Marktbericht-Klartext durch", () => {
    const texte = [
      "BTC hat sich über das Wochenende schrittweise nach oben gearbeitet und konsolidiert seit gestern direkt unter dem Monats-VWAP.",
      "Genau hier liegt die entscheidende Widerstandszone bei 84'300-84'500 USD (+1.2 % in 24 Stunden).",
      "Unmittelbar über dem Kurs verdichtet sich ein helles Short-Liquidationsband (Intensität bis 286 Mio. USD je Band).",
      "Der RSI auf 4H liegt bei 56.5 nach 45.4, auf 1D bei 54.6 -- neutral, mit Luft nach oben.",
      "Kurs über EMA 13 und EMA 50, aber noch unter EMA 200 auf BTC/USDT.",
    ];
    for (const t of texte) expect(findTechnicalIdentifiers(t)).toEqual([]);
  });

  it("findet die Feldnamen aus dem fehlerhaften Lauf vom 12.10.2026", () => {
    expect(findTechnicalIdentifiers("wenn mein_system_checklist.closePrice > mein_system_checklist.ema13")).toEqual(
      expect.arrayContaining(["mein_system_checklist", "closePrice"])
    );
    expect(findTechnicalIdentifiers("wenn trading_indicators.guss.regime = 'TREND_FORMING_BULLISH'")).toContain(
      "TREND_FORMING_BULLISH"
    );
    expect(findTechnicalIdentifiers("Kurs über dayVwap")).toEqual(["dayVwap"]);
  });
});

describe("system-briefing-trigger validate", () => {
  const validate = getPromptProfile("system-briefing-trigger").validate!;
  const scenario = (text: string, bedingungen: string[]) => ({ text, bedingungen, kursziel: 84440 });

  it("akzeptiert Klartext-Szenarien", () => {
    expect(
      validate({
        bullish: scenario("Überwindet BTC die Zone 84'300-84'500 USD nachhaltig, rückt 85'000 USD in den Fokus.", ["Tagesschluss über dem EMA 200"]),
        bearish: scenario("Scheitert BTC an der Zone, werden 83'200 USD wichtig.", []),
        invalidierung: "Ein Tagesschluss unter 82'300 USD kippt das Bild.",
      })
    ).toEqual([]);
  });

  it("verlangt beide Szenarien", () => {
    const errors = validate({
      bullish: scenario("Überwindet BTC die Zone, rückt 85'000 USD in den Fokus.", []),
      bearish: scenario("", []),
      invalidierung: "Unter 82'300 USD.",
    });
    expect(errors.join(" ")).toContain("bearish.text");
  });

  it("weist Feldnamen in den Bedingungen ab", () => {
    const errors = validate({
      bullish: scenario("Ausbruch möglich.", ["wenn mein_system_checklist.closePrice > mein_system_checklist.ema13"]),
      bearish: scenario("", []),
      invalidierung: "Unter 82'300 USD.",
    });
    expect(errors.join(" ")).toContain("interne Feldnamen");
  });
});
