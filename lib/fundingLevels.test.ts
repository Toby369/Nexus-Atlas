import { describe, expect, it } from "vitest";
import {
  classifyFunding,
  classifyFundingPct,
  fundingAnnualizedPct,
  fundingBaselineStatus,
  fundingPctPer8h,
  isFundingBaseline,
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

describe("fundingBaselineStatus", () => {
  const H = 3_600_000;
  const now = 1_000 * H;

  it("im Grundwert: seit dem letzten Ausreisser, mit beiden Richtungen", () => {
    const s = fundingBaselineStatus(0.0091, { t: now - 6 * H, pct: -0.0018 }, null, null, now);
    expect(s.inBaseline).toBe(true);
    expect(s.lines[0]).toBe("Seit 6 Std. im Grundwert.");
    expect(s.lines[1]).toMatch(/vor 6 Std\., −0[.,]0018 %/);
    expect(s.lines[2]).toBe("Über 0,01 %: nicht in den letzten 30 Tagen.");
  });

  it("ohne Ausreisser in 30 Tagen", () => {
    expect(fundingBaselineStatus(0.01, null, null, null, now).lines[0]).toBe("Seit über 30 Tagen im Grundwert.");
  });

  it("ausserhalb: seit dem letzten Grundwert", () => {
    const s = fundingBaselineStatus(0.025, null, { t: now - 5 * 60_000, pct: 0.025 }, { t: now - 3 * 24 * H, pct: 0.01 }, now);
    expect(s.inBaseline).toBe(false);
    expect(s.lines[0]).toBe("Seit 3 Tagen ausserhalb des Grundwerts.");
    expect(s.lines[2]).toMatch(/vor 5 Min\., \+0[.,]0250 %/);
  });

  it("Grundwert-Grenzen", () => {
    expect(isFundingBaseline(0)).toBe(true);
    expect(isFundingBaseline(0.01)).toBe(true);
    expect(isFundingBaseline(-0.0001)).toBe(false);
    expect(isFundingBaseline(0.0101)).toBe(false);
  });
});
