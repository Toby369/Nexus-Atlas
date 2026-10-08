import { describe, expect, it } from "vitest";
import { extractJson } from "./extractJson";

describe("extractJson", () => {
  it("parst reines JSON direkt", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });

  it("entfernt einen ```json-Codeblock", () => {
    expect(extractJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("entfernt einen ```-Codeblock ohne json-Label", () => {
    expect(extractJson('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("schneidet eine vorangestellte Praeambel heraus (Live-Vorfall: Sicherheits-Einstufung vor dem JSON)", () => {
    expect(extractJson('User Safety: safe\n{"a":1,"b":"x"}')).toEqual({ a: 1, b: "x" });
  });

  it("schneidet einen nachgestellten Erklaertext heraus", () => {
    expect(extractJson('{"a":1}\n\nDas war die Antwort.')).toEqual({ a: 1 });
  });

  it("funktioniert auch mit einem Array als Top-Level-Wert", () => {
    expect(extractJson('Hinweis: \n[1,2,3]\nEnde.')).toEqual([1, 2, 3]);
  });

  it("wirft einen Fehler mit gekuerztem Rohtext, wenn ueberhaupt kein JSON enthalten ist", () => {
    expect(() => extractJson("Nur Text, kein JSON.")).toThrow(/kein valides JSON/);
  });
});
