import { describe, it, expect } from "vitest";
import { invertedZoneLogicErrors, kernaussageIndicatorErrors } from "./promptProfiles";

describe("invertedZoneLogicErrors", () => {
  it("erkennt die verdrehte Unterstuetzungs-Logik aus dem Push vom 20.10.2026", () => {
    const text =
      "BTC bleibt unter EMA 200 und dem Tages-VWAP, die Widerstandszone bei 81'535-81'786 USD blockiert Aufwärtsbewegungen; solange die Unterstützung bei 80'855-81'228 USD hält, bleibt das Abwärtsrisiko hoch.";
    expect(invertedZoneLogicErrors(text, "fazit.kernaussage")).toHaveLength(1);
  });

  it("laesst die korrekte Formulierung durch", () => {
    expect(
      invertedZoneLogicErrors(
        "Solange 80'855-81'228 USD halten, ist das Abwärtsrisiko begrenzt; ein Bruch darunter erhöht es deutlich.",
        "k"
      )
    ).toEqual([]);
    expect(invertedZoneLogicErrors("Solange der Widerstand hält, bleibt das Aufwärtspotenzial begrenzt.", "k")).toEqual([]);
  });

  it("erkennt das Spiegelbild beim Widerstand", () => {
    expect(invertedZoneLogicErrors("Solange der Widerstand bei 84'000 USD hält, bleibt die Aufwärtsdynamik intakt.", "k")).toHaveLength(1);
  });
});

describe("Push vom 27.10.2026", () => {
  const text =
    "BTC hält die Unterstützung bei 79'553-79'757 USD und bleibt unter EMA 200 sowie dem Tages-VWAP von 79'867 USD; solange 80'089-80'430 USD nicht klar durchbrochen werden, ist das Abwärtsrisiko begrenzt, doch die aktuelle Preislage deutet auf weiterführenden Abwärtsdruck hin.";

  it("erkennt die verdrehte Logik und den Widerspruch", () => {
    expect(invertedZoneLogicErrors(text, "fazit.kernaussage")).toHaveLength(1);
    expect(
      invertedZoneLogicErrors("Das Abwärtsrisiko ist begrenzt, doch es deutet auf weiteren Abwärtsdruck hin.", "k")
    ).toHaveLength(1);
  });

  it("verbietet Indikatornamen in der Kernaussage", () => {
    expect(kernaussageIndicatorErrors(text, "fazit.kernaussage")).toHaveLength(1);
    expect(
      kernaussageIndicatorErrors("BTC steht zwischen Unterstützung 82'600 USD und Widerstand 83'400 USD.", "k")
    ).toEqual([]);
  });

  it("laesst die korrekte Widerstands-Formulierung durch", () => {
    expect(
      invertedZoneLogicErrors("Solange 83'400 USD nicht überwunden sind, bleibt das Aufwärtspotenzial begrenzt.", "k")
    ).toEqual([]);
  });
});
