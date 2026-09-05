import { describe, expect, it } from "vitest";
import { computePiCycleTop } from "./piCycleTop";

describe("computePiCycleTop", () => {
  it("gibt null zurueck bei weniger als 350 Werten", () => {
    const closes = Array.from({ length: 349 }, () => 100);
    expect(computePiCycleTop(closes)).toBeNull();
  });

  it("bei konstantem Preis liegt ratioPct bei 50% (ma111 = const, ma350x2 = 2*const)", () => {
    const closes = Array.from({ length: 400 }, () => 100);
    const result = computePiCycleTop(closes);
    expect(result).not.toBeNull();
    expect(result!.ratioPct).toBeCloseTo(50, 6);
    expect(result!.triggered).toBe(false);
  });

  it("erkennt eine Kreuzung bei starkem, anhaltendem Kursanstieg der letzten 111 Tage", () => {
    // Erste 289 Tage flach bei 100, dann ein steiler Anstieg in den letzten
    // 111 Tagen -- der kurze MA (111) zieht deutlich vor dem langen (350) an.
    const flat = Array.from({ length: 289 }, () => 100);
    const rising = Array.from({ length: 111 }, (_, i) => 100 + i * 20);
    const closes = [...flat, ...rising];
    const result = computePiCycleTop(closes);
    expect(result).not.toBeNull();
    expect(result!.ratioPct).toBeGreaterThan(100);
    expect(result!.triggered).toBe(true);
  });

  it("nutzt ausschliesslich die letzten 350 Werte (aeltere Historie darf das Ergebnis nicht veraendern)", () => {
    const tail = Array.from({ length: 350 }, (_, i) => 100 + i);
    const a = computePiCycleTop(tail);
    const withExtraHistory = computePiCycleTop([...Array.from({ length: 500 }, () => 1), ...tail]);
    expect(withExtraHistory!.ratioPct).toBeCloseTo(a!.ratioPct, 6);
  });
});
