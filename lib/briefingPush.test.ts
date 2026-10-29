import { describe, expect, it } from "vitest";
import { buildBriefingPush, withBtcPrefix } from "./briefingPush";

const levels = [{ price: 80_089 }, { price: 80_430 }, { price: 79_553 }, { price: 79_100 }];
const base = { levels, bias: "bearish", schlagzeile: "BTC pendelt bei 79'838 USD", kernaussage: "KI-Text" };

describe("buildBriefingPush", () => {
  it("baut Titel und Text aus Kurs, Zonen und Plan", () => {
    expect(buildBriefingPush({ ...base, kurs: 79_838 })).toEqual({
      title: "BTC 79’838 · bärisch",
      body: "Kurs zwischen Unterstützung 79’553 und Widerstand 80’089. Über 80’089 Long am Retest, unter 79’553 Short. Dazwischen kein Trade.",
    });
  });

  it("faellt ohne Kurs auf Schlagzeile und Kernaussage zurueck, ohne doppeltes BTC", () => {
    expect(buildBriefingPush({ ...base, kurs: null })).toEqual({ title: "BTC pendelt bei 79'838 USD", body: "KI-Text" });
  });
});

describe("withBtcPrefix", () => {
  it("setzt BTC nur einmal", () => {
    expect(withBtcPrefix("Bitcoin fällt")).toBe("BTC · Bitcoin fällt");
    expect(withBtcPrefix("BTC fällt")).toBe("BTC fällt");
  });
});
