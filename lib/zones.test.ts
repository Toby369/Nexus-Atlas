import { describe, it, expect, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import { nearestZones, planSentence } from "./zones";

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
