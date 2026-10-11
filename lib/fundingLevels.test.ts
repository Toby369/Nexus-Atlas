import { describe, expect, it } from "vitest";
import {
  classifyFunding,
  classifyFundingPct,
  fundingAnnualizedPct,
  fundingPctPer8h,
} from "./fundingLevels";

describe("fundingPctPer8h", () => {
  it("rechnet den DB-Bruch in Prozent um", () => {
    expect(fundingPctPer8h(0.0001)).toBe(0.01);
  });
  it("normalisiert stuendliche Abrechnung auf 8 h", () => {
    expect(fundingPctPer8h(0.0001, 1)).toBe(0.08);
  });
});

describe("fundingAnnualizedPct", () => {
  it("0,01 % pro 8 h sind knapp 11 % pro Jahr", () => {
    expect(fundingAnnualizedPct(0.01)).toBeCloseTo(10.95, 2);
  });
});

describe("classifyFundingPct", () => {
  it.each([
    [-0.08, "extreme_negative"],
    [-0.05, "extreme_negative"],
    [-0.02, "negative"],
    [-0.005, "slightly_negative"],
    [0, "neutral"],
    [0.01, "neutral"],
    [0.02, "elevated"],
    [0.03, "high"],
    [0.049, "high"],
    [0.05, "extreme"],
    [0.1, "euphoria"],
  ])("%s %% -> %s", (pct, id) => {
    expect(classifyFundingPct(pct).id).toBe(id);
  });

  it("Extreme gelten in beide Richtungen als Risiko", () => {
    expect(classifyFundingPct(-0.06).tone).toBe("risk");
    expect(classifyFundingPct(0.06).tone).toBe("risk");
    expect(classifyFundingPct(0.01).tone).toBe("calm");
  });
});

describe("classifyFunding", () => {
  it("Standardwert 0.0001 bleibt trotz Gleitkomma neutral", () => {
    expect(classifyFunding(0.0001)?.id).toBe("neutral");
  });
  it("liefert null ohne Wert", () => {
    expect(classifyFunding(null)).toBeNull();
    expect(classifyFunding(Number.NaN)).toBeNull();
  });
  it("0,01 % pro Stunde ist auf 8 h gerechnet bereits extrem", () => {
    expect(classifyFunding(0.0001, 1)?.id).toBe("extreme");
  });
});
