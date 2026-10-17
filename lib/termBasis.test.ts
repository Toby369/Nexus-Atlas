import { describe, expect, it } from "vitest";
import { classifyTermBasis, summarizeTermBasis, valueDaysAgo } from "./termBasis";

const DAY = 24 * 60 * 60 * 1000;

describe("classifyTermBasis", () => {
  it.each([
    [-1, "backwardation"],
    [0, "weak"],
    [4.9, "weak"],
    [5, "normal"],
    [9.9, "normal"],
    [10, "elevated"],
    [15, "hot"],
    [25, "hot"],
  ])("%s %% p.a. -> %s", (pct, id) => {
    expect(classifyTermBasis(pct).id).toBe(id);
  });
});

describe("valueDaysAgo", () => {
  it("nimmt den letzten Punkt vor dem Stichtag", () => {
    const pts = [
      { t: 0, annualizedPct: 9 },
      { t: 2 * DAY, annualizedPct: 8 },
      { t: 9 * DAY, annualizedPct: 6 },
    ];
    expect(valueDaysAgo(pts, 7)).toBe(8);
  });
  it("ohne ausreichend Historie null", () => {
    expect(valueDaysAgo([{ t: 0, annualizedPct: 5 }], 7)).toBeNull();
  });
});

describe("summarizeTermBasis", () => {
  const falling = [
    { t: 0, annualizedPct: 9 },
    { t: 7 * DAY, annualizedPct: 6.5 },
  ];

  it("fallende Basis plus ETF-Abfluesse -> moeglicher Basis-Trade-Abbau", () => {
    const s = summarizeTermBasis(falling, -350)!;
    expect(s.change7dPp).toBeCloseTo(-2.5);
    expect(s.possibleUnwind).toBe(true);
  });

  it("fallende Basis bei ETF-Zufluessen -> kein Abbau-Hinweis", () => {
    expect(summarizeTermBasis(falling, 120)!.possibleUnwind).toBe(false);
  });

  it("ohne Daten null", () => {
    expect(summarizeTermBasis([], null)).toBeNull();
  });
});
