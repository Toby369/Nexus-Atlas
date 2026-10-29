import { describe, it, expect, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import { isAtZone, nearestLiquidationTargets, nearestZones, planSentence } from "./zones";

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

describe("nearestLiquidationTargets", () => {
  const zones = [
    { side: "short" as const, priceLow: 82_400, priceHigh: 82_600, massUsd: 1e8 },
    { side: "short" as const, priceLow: 83_500, priceHigh: 83_700, massUsd: 3e8 },
    { side: "long" as const, priceLow: 80_900, priceHigh: 81_100, massUsd: 2e8 },
  ];

  it("nimmt je Seite die naechste Zone jenseits des Kurses", () => {
    const { above, below } = nearestLiquidationTargets(zones, 81_964);
    expect(above).toMatchObject({ low: 82_400, high: 82_600 });
    expect(above?.distancePct).toBeCloseTo(0.53, 2);
    expect(below).toMatchObject({ low: 80_900, high: 81_100 });
  });

  it("ignoriert Zonen auf der falschen Seite", () => {
    expect(nearestLiquidationTargets(zones, 84_000).above).toBeNull();
  });
});

describe("Zonen-Bereiche (AutarkTrade)", () => {
  const zones = [
    { price: 81_150, low: 81_000, high: 81_300, label: "Range-Oberkante" },
    { price: 80_100, low: 80_000, high: 80_200 },
  ];

  it("Retest-Band: Zone plus 0,25 %, Linie genau +-0,25 %", () => {
    expect(isAtZone(zones[0], 81_200)).toBe(true);
    expect(isAtZone(zones[0], 80_800)).toBe(true); // 81'000 * 0,9975 = 80'797,5
    expect(isAtZone(zones[0], 80_790)).toBe(false);
    expect(isAtZone({ price: 80_000 }, 80_199)).toBe(true);
    expect(isAtZone({ price: 80_000 }, 80_201)).toBe(false);
  });

  it("Abstand zur nahen Kante, Bereich und Name bleiben erhalten", () => {
    const { above, below } = nearestZones(zones, 80_600);
    expect(above[0]).toMatchObject({ price: 81_000, low: 81_000, high: 81_300, label: "Range-Oberkante" });
    expect(above[0].distancePct).toBeCloseTo(0.496, 2);
    expect(below[0]).toMatchObject({ price: 80_200 });
  });

  it("Plan-Satz: Long ueber der Oberkante, Short unter der Unterkante", () => {
    expect(planSentence(zones, 80_600)).toBe("Über 81’300 Long am Retest, unter 80’000 Short. Dazwischen kein Trade.");
  });
});

describe("isSyncStale", () => {
  it("veraltet nach 30 Minuten ohne Sync oder ohne Zeitstempel", async () => {
    const { isSyncStale } = await import("./ownZones");
    const now = Date.UTC(2026, 9, 29, 12, 0);
    expect(isSyncStale(new Date(now - 10 * 60_000).toISOString(), now)).toBe(false);
    expect(isSyncStale(new Date(now - 31 * 60_000).toISOString(), now)).toBe(true);
    expect(isSyncStale(null, now)).toBe(true);
  });
});
