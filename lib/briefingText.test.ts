import { describe, expect, it } from "vitest";
import { splitLeadSentence } from "./briefingText";

describe("splitLeadSentence", () => {
  it("trennt den ersten Satz vom Rest", () => {
    expect(splitLeadSentence("Das Tagesbild ist grün. BTC steigt um +1.2 % auf 84'300 USD.")).toEqual({
      lead: "Das Tagesbild ist grün.",
      rest: "BTC steigt um +1.2 % auf 84'300 USD.",
    });
  });
  it("bricht nicht an Dezimalpunkten", () => {
    expect(splitLeadSentence("BTC steigt um +1.2 % in 24 Stunden.").rest).toBe("");
  });
  it("überspringt Abkürzungen wie Mio. und z.B.", () => {
    expect(splitLeadSentence("Ein Band bei 84'400 USD (286 Mio. USD) bremst. Darunter liegt Support.")).toEqual({
      lead: "Ein Band bei 84'400 USD (286 Mio. USD) bremst.",
      rest: "Darunter liegt Support.",
    });
    expect(splitLeadSentence("Wichtig sind z.B. 83'200 USD. Rest.").lead).toBe("Wichtig sind z.B. 83'200 USD.");
  });
  it("entfernt Markdown-Sternchen", () => {
    expect(splitLeadSentence("**BTC konsolidiert über dem VWAP.** Die Zone hält.")).toEqual({
      lead: "BTC konsolidiert über dem VWAP.",
      rest: "Die Zone hält.",
    });
  });
  it("gibt einen Text ohne Satzende ganz als Kernsatz zurück", () => {
    expect(splitLeadSentence("BTC erholt sich")).toEqual({ lead: "BTC erholt sich", rest: "" });
  });
});
