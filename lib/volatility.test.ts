import { describe, expect, it } from "vitest";
import {
  classifyDvolPercentile,
  classifyIvRvSpread,
  classifySkew,
  expectedDailyMovePct,
  expectedRange,
  parseOption,
  percentileRank,
  realizedVolPct,
  thirtyDayOptions,
} from "./volatility";

const NOW = Date.UTC(2026, 9, 14, 12); // 14.10.2026 12:00 UTC

function opt(name: string, iv: number, forward = 100000) {
  return { instrument_name: name, mark_iv: iv, underlying_price: forward };
}

describe("parseOption", () => {
  it("liest Verfall (08:00 UTC), Strike und Typ", () => {
    const p = parseOption(opt("BTC-13NOV26-100000-C", 40));
    expect(p).toMatchObject({ expiry: "13NOV26", strike: 100000, type: "C", markIv: 40 });
    expect(p?.expiryMs).toBe(Date.UTC(2026, 10, 13, 8));
  });
  it("verwirft unbrauchbare Zeilen", () => {
    expect(parseOption(opt("BTC-PERPETUAL", 40))).toBeNull();
    expect(parseOption({ instrument_name: "BTC-13NOV26-100000-C", mark_iv: null, underlying_price: 1 })).toBeNull();
    expect(parseOption(opt("BTC-13XYZ26-100000-C", 40))).toBeNull();
  });
});

describe("thirtyDayOptions", () => {
  // 14.10.2026 12:00 UTC: 30OCT26 = 15,8 Tage, 27NOV26 = 43,8 Tage
  const near = [
    opt("BTC-30OCT26-100000-C", 36, 100000),
    opt("BTC-30OCT26-100000-P", 36, 100000),
    opt("BTC-30OCT26-90000-P", 40, 100000),
    opt("BTC-30OCT26-110000-C", 36, 100000),
  ];
  const far = [
    opt("BTC-27NOV26-101000-C", 44, 101000),
    opt("BTC-27NOV26-101000-P", 44, 101000),
    opt("BTC-27NOV26-91000-P", 50, 101000),
    opt("BTC-27NOV26-111000-C", 44, 101000),
  ];
  const tooShort = [opt("BTC-15OCT26-100000-C", 90), opt("BTC-15OCT26-100000-P", 90)];

  it("interpoliert die Gesamtvarianz auf genau 30 Tage", () => {
    const r = thirtyDayOptions([...tooShort, ...far, ...near], NOW)!;
    expect(r.interpolated).toBe(true);
    expect(r.expiries).toEqual(["30OCT26", "27NOV26"]);
    expect(r.daysToExpiry).toBe(30);
    const t1 = (Date.UTC(2026, 9, 30, 8) - NOW) / 86400000;
    const t2 = (Date.UTC(2026, 10, 27, 8) - NOW) / 86400000;
    const w1 = 36 ** 2 * t1;
    const w2 = 44 ** 2 * t2;
    const share = (30 - t1) / (t2 - t1);
    expect(r.atmIv).toBeCloseTo(Math.sqrt((w1 + (w2 - w1) * share) / 30), 10);
    expect(r.atmIv!).toBeGreaterThan(36);
    expect(r.atmIv!).toBeLessThan(44);
    expect(r.skew).toBeCloseTo(4 + (6 - 4) * share, 10);
  });

  it("die Reihenfolge der API-Antwort spielt keine Rolle", () => {
    const a = thirtyDayOptions([...near, ...far], NOW)!;
    const b = thirtyDayOptions([...far, ...near], NOW)!;
    expect(a).toEqual(b);
  });

  it("ohne Verfall auf beiden Seiten gilt der naechstgelegene", () => {
    const r = thirtyDayOptions([...tooShort, ...far], NOW)!;
    expect(r.interpolated).toBe(false);
    expect(r.expiries).toEqual(["27NOV26"]);
    expect(r.atmIv).toBe(44);
    expect(r.skew).toBe(6);
  });

  it("kein Skew, wenn kein Strike nahe genug an +/-10 % liegt", () => {
    const r = thirtyDayOptions(far.filter((o) => !o.instrument_name.includes("91000")), NOW)!;
    expect(r.skew).toBeNull();
    expect(r.atmIv).toBe(44);
  });

  it("null ohne brauchbaren Verfall", () => {
    expect(thirtyDayOptions(tooShort, NOW)).toBeNull();
  });
});

describe("realizedVolPct", () => {
  it("konstanter Preis -> 0", () => {
    expect(realizedVolPct(Array(30).fill(100), 24)).toBe(0);
  });
  it("annualisiert die Stunden-Standardabweichung", () => {
    // abwechselnd +1 % / -1 %: Log-Renditen +-r, Stichproben-Std = r * sqrt(n/(n-1))
    const closes = [100];
    for (let i = 0; i < 24; i++) closes.push(i % 2 === 0 ? closes[i] * 1.01 : closes[i] / 1.01);
    const r = Math.log(1.01);
    const expected = r * Math.sqrt(24 / 23) * Math.sqrt(24 * 365) * 100;
    expect(realizedVolPct(closes, 24)).toBeCloseTo(expected, 6);
  });
  it("zu wenig Daten -> null", () => {
    expect(realizedVolPct([1, 2, 3], 24)).toBeNull();
  });
});

describe("percentileRank", () => {
  it("Anteil kleiner oder gleich", () => {
    expect(percentileRank(30, [10, 20, 30, 40])).toBe(75);
    expect(percentileRank(5, [10, 20])).toBe(0);
    expect(percentileRank(5, [])).toBeNull();
  });
});

describe("expectedDailyMovePct", () => {
  it("DVOL 50 -> rund 2,6 % pro Tag", () => {
    expect(expectedDailyMovePct(50)).toBeCloseTo(2.617, 3);
  });
});

describe("expectedRange", () => {
  it("log-symmetrische 1-Sigma-Spanne", () => {
    const r = expectedRange(100000, 36.5, 365);
    expect(r.movePct).toBeCloseTo(36.5, 10);
    expect(r.low).toBeCloseTo(100000 * Math.exp(-0.365), 6);
    expect(r.high).toBeCloseTo(100000 * Math.exp(0.365), 6);
    expect(r.low * r.high).toBeCloseTo(100000 ** 2, 0); // symmetrisch im Log-Raum
  });
  it("skaliert mit der Wurzel der Zeit", () => {
    const one = expectedRange(80000, 40, 1).movePct;
    expect(expectedRange(80000, 40, 4).movePct).toBeCloseTo(2 * one, 10);
    expect(one).toBeCloseTo(expectedDailyMovePct(40), 10);
  });
});

describe("Einordnungen", () => {
  it.each([
    [10, "watch"],
    [50, "calm"],
    [90, "risk"],
  ])("DVOL-Perzentil %s -> %s", (pct, tone) => {
    expect(classifyDvolPercentile(pct).tone).toBe(tone);
  });
  it.each([
    [15, "watch"],
    [0, "calm"],
    [-8, "risk"],
  ])("IV-RV-Spread %s -> %s", (spread, tone) => {
    expect(classifyIvRvSpread(spread).tone).toBe(tone);
  });
  it.each([
    [8, "Puts", "down"],
    [-3, "Calls", "up"],
    [1, "Ausgeglichen", "flat"],
    [5, "Ausgeglichen", "flat"],
    [-2, "Ausgeglichen", "flat"],
  ])("Skew %s -> %s, Pfeil %s", (skew, word, direction) => {
    const a = classifySkew(skew);
    expect(a.label).toContain(word);
    expect(a.direction).toBe(direction);
  });
});
