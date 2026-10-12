import { describe, expect, it } from "vitest";
import { computePriceChanges } from "./priceChanges";

describe("computePriceChanges", () => {
  it("berechnet Differenz in USD und Prozent", () => {
    const changes = computePriceChanges(82_439, [
      { label: "1H", price: 82_000 },
      { label: "1W", price: 85_000 },
    ]);
    expect(changes).toHaveLength(2);
    expect(changes[0]).toMatchObject({ label: "1H", abs: 439 });
    expect(changes[0].pct).toBeCloseTo(0.535, 3);
    expect(changes[1]).toMatchObject({ label: "1W", abs: -2_561 });
    expect(changes[1].pct).toBeCloseTo(-3.013, 3);
  });

  it("laesst fehlende Referenzen weg", () => {
    expect(computePriceChanges(82_439, [{ label: "4H", price: null }])).toEqual([]);
  });

  it("liefert nichts ohne Live-Preis", () => {
    expect(computePriceChanges(null, [{ label: "1D", price: 80_000 }])).toEqual([]);
  });
});
