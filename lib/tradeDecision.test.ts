import { describe, expect, it } from "vitest";
import { calcRisk, clearFrom, STEPS, verdict, walk, type Answers, type RiskInput } from "./tradeDecision";

const ALL_OK: Answers = {
  zDaily: 0, z4h: 0, zStrength: 0, zPlan: 0, trend: 0, breakout: 0, d13: 0, atLevel: 0, confluence: 0,
  h1close: 0, m15: 0, absorption: 0, funding: 0, crowd: 0, macro: 0, rsi: 0, losses: 0,
};

// Retest vom 20.10.2026: Level 82'200, Einstieg 82'300, Stop 82'100, Ziel 83'000.
const RETEST: RiskInput = { level: 82200, entry: 82300, stop: 82100, target: 83000, account: 10000, riskPct: 1, clearPath: true };

describe("calcRisk", () => {
  it("Long: Chance-Risiko, Fortschritt, Positionsgroesse", () => {
    const c = calcRisk("long", RETEST)!;
    expect(c.riskPts).toBe(200);
    expect(c.reward).toBe(700);
    expect(c.crv).toBeCloseTo(3.5);
    expect(c.progress).toBeCloseTo(100 / 800);
    expect(c.stopBehind).toBe(true);
    expect(c.sizeBtc).toBeCloseTo(0.5);
  });

  it("Short spiegelbildlich", () => {
    const c = calcRisk("short", { ...RETEST, level: 83000, entry: 82900, stop: 83100, target: 82200 })!;
    expect(c.crv).toBeCloseTo(3.5);
    expect(c.stopBehind).toBe(true);
  });

  it("unvollstaendige Eingabe -> null", () => {
    expect(calcRisk("long", { ...RETEST, stop: null })).toBeNull();
  });
});

describe("walk und verdict", () => {
  it("alles erfuellt -> Trade", () => {
    const s = walk("long", ALL_OK, RETEST, true);
    expect(s.current).toBeNull();
    expect(verdict("long", s, RETEST).kind).toBe("trade");
  });

  it("gleicher Trade eine Stunde spaeter bei 82'700 -> zu spaet", () => {
    const late = { ...RETEST, entry: 82700 };
    const s = walk("long", ALL_OK, late, true);
    expect(verdict("long", s, late).kind).toBe("late");
  });

  it("nur Docht ueber dem Level -> kein Trade, Pruefung endet sofort", () => {
    const s = walk("long", { zDaily: 0, z4h: 0, zStrength: 0, zPlan: 0, trend: 0, breakout: 1 }, RETEST, false);
    expect(s.current).toBeNull();
    expect(s.log.at(-1)!.stepId).toBe("breakout");
    expect(verdict("long", s, RETEST).kind).toBe("stop");
  });

  it("ohne Zonen -> warten", () => {
    const s = walk("long", { zDaily: 1 }, RETEST, false);
    expect(verdict("long", s, RETEST).kind).toBe("wait");
  });

  it("Range-Pfad fragt nach dem Range-Rand statt nach dem Ausbruch", () => {
    const s = walk("long", { zDaily: 0, z4h: 0, zStrength: 0, zPlan: 0, trend: 1 }, RETEST, false);
    expect(s.current?.id).toBe("rangeEdge");
  });

  it("zwei Warnungen -> grenzwertig", () => {
    const a = { ...ALL_OK, d13: 1, funding: 1 };
    const s = walk("long", a, RETEST, true);
    expect(verdict("long", s, RETEST).kind).toBe("caution");
  });

  it("Risiko-Schritt bleibt offen, bis er bestaetigt ist", () => {
    const s = walk("long", ALL_OK, RETEST, false);
    expect(s.current?.id).toBe("risk");
  });
});

describe("clearFrom", () => {
  it("verwirft den Schritt und alle danach, behaelt die davor", () => {
    const r = clearFrom("d13", ALL_OK);
    expect(r.answers.trend).toBe(0);
    expect(r.answers.d13).toBeUndefined();
    expect(r.answers.funding).toBeUndefined();
    expect(r.resetRisk).toBe(true);
  });

  it("Aenderung im Perp-Check laesst das Risiko stehen", () => {
    expect(clearFrom("macro", ALL_OK).resetRisk).toBe(false);
  });

  it("jede Frage hat mindestens zwei Antworten", () => {
    for (const s of STEPS) if (s.kind === "question") expect(s.options("long").length).toBeGreaterThanOrEqual(2);
  });
});
