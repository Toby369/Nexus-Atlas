import { describe, expect, it } from "vitest";
import { computePriceChanges } from "./priceChanges";

describe("computePriceChanges", () => {
  it("berechnet Differenz in USD und Prozent", () => {
    const changes = computePriceChanges(82_439, [
      { label: "1 Std", price: 82_000 },
      { label: "1 Woche", price: 85_000 },
    ]);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ label: "1 Std", abs: 439 });
    expect(changes[0].pct).toBeCloseTo(0.535, 3);
    expect(changes[1]).toMatchObject({ label: "1 Woche", abs: -2_561 });
    expect(changes[1].pct).toBeCloseTo(-3.013, 3);
  });

  it("laesst fehlende Referenzen weg", () => {
    expect(computePriceChanges(82_439, [{ label: "4 Std", price: null }])).toEqual([]);
  });

  it("liefert nichts ohne Live-Preis", () => {
    expect(computePriceChanges(null, [{ label: "1 Tag", price: 80_000 }])).toEqual([]);
  });
});
