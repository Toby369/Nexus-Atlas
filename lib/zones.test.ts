import { describe, it, expect, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import { nearestZones, planSentence } from "./zones";
import { evaluateFourHourBreakout } from "./fourHourBreakout";

const levels = [{ price: 83_115 }, { price: 82_257 }, { price: 81_933 }, { price: 81_557 }, { price: 80_985 }];

describe("nearestZones", () => {
  it("benennt Zonen nach Lage zum Kurs und ueberspringt das Level am Kurs", () => {
    const { above, below } = nearestZones(levels, 81_964);
    expect(above.map((z) => z.price)).toEqual([82_257, 83_115]);
    expect(above[0].role).toBe("Verkäufer-Zone");
    expect(below.map((z) => z.price)).toEqual([81_557, 80_985]); // 81'933 liegt im Retest-Band
    expect(below[0].role).toBe("Käufer-Zone");
    expect(below[0].distancePct).toBeCloseTo(0.497, 2);
  });
});

describe("planSentence", () => {
  it("formuliert den Plan-Satz", () => {
    expect(planSentence(levels, 81_964)).toBe("Über 82’257 Long am Retest, unter 81’557 Short. Dazwischen kein Trade.");
  });
  it("liefert null ohne Kurs", () => {
    expect(planSentence(levels, null)).toBeNull();
  });
});

const c = (open: number, high: number, low: number, close: number) => ({ openTime: "t", open, high, low, close });

describe("evaluateFourHourBreakout", () => {
  it("erkennt einen Koerper-Schluss ueber dem Level", () => {
    const r = evaluateFourHourBreakout([82_257], c(81_900, 82_100, 81_800, 82_000), c(82_000, 82_500, 81_950, 82_400));
    expect(r).toMatchObject({ kind: "body_above", level: 82_257 });
  });
  it("erkennt einen reinen Docht ueber dem Level", () => {
    const r = evaluateFourHourBreakout([82_257], c(81_900, 82_100, 81_800, 82_000), c(82_000, 82_400, 81_950, 82_100));
    expect(r).toMatchObject({ kind: "wick_above", level: 82_257 });
  });
  it("erkennt einen Koerper-Schluss unter dem Level", () => {
    const r = evaluateFourHourBreakout([81_557], c(81_700, 81_800, 81_600, 81_650), c(81_650, 81_700, 81_300, 81_400));
    expect(r).toMatchObject({ kind: "body_below", level: 81_557 });
  });
  it("meldet nichts ohne Bezug zu einem Level", () => {
    expect(evaluateFourHourBreakout([90_000], c(1, 2, 0.5, 1.5), c(1.5, 2, 1, 1.8)).kind).toBe("none");
  });
});
