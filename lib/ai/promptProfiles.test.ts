import { describe, it, expect } from "vitest";
import { invertedZoneLogicErrors } from "./promptProfiles";

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
