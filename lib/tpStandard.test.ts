import { describe, it, expect } from "vitest";
import { computeTpSuggestions, formatTpSuggestion, suggestTpStandard } from "./tpStandard";

describe("suggestTpStandard", () => {
  it("nimmt den groessten Standard, dessen TP vor dem Level liegt", () => {
    expect(suggestTpStandard(2.0)?.id).toBe(1);
    expect(suggestTpStandard(1.75)?.id).toBe(1);
    expect(suggestTpStandard(1.6)?.id).toBe(2);
    expect(suggestTpStandard(1.3)?.id).toBe(3);
    expect(suggestTpStandard(1.0)?.id).toBe(4);
  });

  it("liefert null (kein Trade) unter 1 %", () => {
    expect(suggestTpStandard(0.8)).toBeNull();
  });
});

describe("computeTpSuggestions", () => {
  const levels = [
    { price: 83_500, side: "resistance" as const },
    { price: 84_500, side: "resistance" as const },
    { price: 81_000, side: "support" as const },
    { price: 82_700, side: "support" as const }, // inzwischen ueber dem Kurs -> zaehlt als Widerstand
  ];

  it("nutzt das naechste Level ueber bzw. unter dem Live-Preis", () => {
    const [long, short] = computeTpSuggestions(levels, 82_400);
    expect(long.levelPrice).toBe(82_700);
    expect(long.standard).toBeNull(); // 0,36 % -> kein Trade
    expect(short.levelPrice).toBe(81_000);
    expect(short.distancePct).toBeCloseTo(1.699, 2);
    expect(short.standard?.id).toBe(2);
  });

  it("ueberspringt das Level, an dem der Kurs gerade steht (Retest-Toleranz 0,25 %)", () => {
    const [, short] = computeTpSuggestions(
      [
        { price: 81_933, side: "support" },
        { price: 80_300, side: "support" },
      ],
      81_964
    );
    expect(short.levelPrice).toBe(80_300);
    expect(short.standard?.id).toBe(1); // 2,03 % Abstand
  });

  it("meldet fehlende Levels", () => {
    const [long] = computeTpSuggestions([{ price: 80_000, side: "support" }], 82_000);
    expect(long.levelPrice).toBeNull();
    expect(formatTpSuggestion(long)).toBe("Long → kein Widerstand bekannt");
  });

  it("formatiert den Vorschlag", () => {
    const [, short] = computeTpSuggestions(levels, 82_400);
    expect(formatTpSuggestion(short)).toBe("Short → Unterstützung 81’000 (−1.7 %) → Standard 2 (TP 30 %)");
  });
});
