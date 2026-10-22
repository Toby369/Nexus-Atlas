import { describe, expect, it } from "vitest";
import { classifyRegime, evaluateZone, referenceZones, zoneTips, type Ohlc } from "./zones";

// Flache Vorgeschichte bei 100, letzter Schluss 100.
const flat = (n: number, p = 100): Ohlc[] => Array.from({ length: n }, () => [p, p + 0.2, p - 0.2, p]);

describe("evaluateZone", () => {
  const hist = flat(10);

  it("Widerstand: beruehrt, dann 1,5 % Abprall -> Reaktion", () => {
    const future: Ohlc[] = [[100, 101.5, 99.8, 101], [101, 102.1, 100.5, 100.8], [100.8, 101, 99.5, 99.6]];
    const r = evaluateZone([...hist, ...future], 10, { lo: 102, hi: 102.5 });
    expect(r).toEqual({ kind: "react", touchedAt: 1 });
  });

  it("Widerstand: Schluss ueber der Zone -> durchbrochen", () => {
    const future: Ohlc[] = [[100, 102.2, 99.9, 102.1], [102.1, 103.5, 102, 103.2]];
    expect(evaluateZone([...hist, ...future], 10, { lo: 102, hi: 102.5 }).kind).toBe("break");
  });

  it("Unterstuetzung: beruehrt, Abprall nach oben -> Reaktion", () => {
    const future: Ohlc[] = [[100, 100.1, 97.9, 98.2], [98.2, 99.8, 98.1, 99.7]];
    expect(evaluateZone([...hist, ...future], 10, { lo: 97.5, hi: 98 }).kind).toBe("react");
  });

  it("Unterstuetzung: Schluss darunter -> durchbrochen", () => {
    const future: Ohlc[] = [[100, 100.1, 97.6, 97.0]];
    expect(evaluateZone([...hist, ...future], 10, { lo: 97.5, hi: 98 }).kind).toBe("break");
  });

  it("nicht erreicht", () => {
    expect(evaluateZone([...hist, ...flat(5)], 10, { lo: 110, hi: 111 })).toEqual({ kind: "none", touchedAt: null });
  });

  it("erreicht, aber weder Abprall noch Bruch -> beruehrt", () => {
    const future: Ohlc[] = [[100, 102.1, 99.9, 101.9], [101.9, 102.3, 101.7, 102]];
    expect(evaluateZone([...hist, ...future], 10, { lo: 102, hi: 102.5 }).kind).toBe("weak");
  });
});

describe("referenceZones", () => {
  it("findet Range-Raender ueber und unter dem letzten Schluss", () => {
    // Zick-Zack zwischen 95 und 105, endet bei 100.
    const k: Ohlc[] = [];
    for (let i = 0; i < 120; i++) {
      const phase = i % 24;
      const p = phase < 12 ? 95 + (10 * phase) / 12 : 105 - (10 * (phase - 12)) / 12;
      k.push([p, p + 0.3, p - 0.3, p]);
    }
    k[119] = [100, 100.3, 99.7, 100];
    const zones = referenceZones(k, 120);
    expect(zones.some((z) => z.lo <= 105.3 && z.hi >= 105 && z.touches >= 2)).toBe(true);
    expect(zones.some((z) => z.lo <= 94.7 && z.hi >= 94.7 && z.touches >= 2)).toBe(true);
    for (const z of zones) expect((z.hi - z.lo) / z.lo).toBeLessThan(0.02);
  });
});

describe("classifyRegime und zoneTips", () => {
  it("ordnet nach Veraenderung ein", () => {
    const up: Ohlc[] = [[100, 100, 100, 100], ...flat(8, 105), [110, 110, 110, 110]];
    expect(classifyRegime(up, 10)).toBe("up");
    expect(classifyRegime(flat(10), 10)).toBe("range");
  });

  it("weist auf einseitige und zu breite Zonen hin", () => {
    const k = [...flat(10), ...flat(5)];
    const tips = zoneTips(k, 10, [{ lo: 101, hi: 104 }]);
    expect(tips.some((t) => t.includes("nur Zonen über"))).toBe(true);
    expect(tips.some((t) => t.includes("breiter als 1,5 %"))).toBe(true);
  });
});
