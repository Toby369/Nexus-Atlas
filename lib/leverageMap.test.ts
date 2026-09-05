import { describe, expect, it } from "vitest";
import {
  buildLeverageClusters,
  leverageSustainable,
  liqPriceLong,
  liqPriceShort,
  longSharePct,
  type OiCandlePoint,
} from "./leverageMap";

describe("liqPriceLong / liqPriceShort", () => {
  it("liegt fuer Long unterhalb, fuer Short oberhalb des Einstiegs", () => {
    expect(liqPriceLong(100, 10, 0.004)).toBeLessThan(100);
    expect(liqPriceShort(100, 10, 0.004)).toBeGreaterThan(100);
  });

  it("rechnet die Boersenformel exakt (E*(1-1/L)/(1-m))", () => {
    // 100 * (1 - 1/10) / (1 - 0.004) = 90 / 0.996
    expect(liqPriceLong(100, 10, 0.004)).toBeCloseTo(90 / 0.996, 6);
    expect(liqPriceShort(100, 10, 0.004)).toBeCloseTo(110 / 1.004, 6);
  });

  it("hoeherer Hebel liegt naeher am Einstieg (engerer Puffer)", () => {
    const liq10x = liqPriceLong(100, 10, 0.004);
    const liq100x = liqPriceLong(100, 100, 0.004);
    expect(liq100x).toBeGreaterThan(liq10x); // naeher an 100 = groesser (Long-Liq liegt unten)
  });
});

describe("leverageSustainable", () => {
  it("100x ist bei 0.4% Wartungsmarge haltbar (1/100=0.01 > 0.004)", () => {
    expect(leverageSustainable(100, 0.004)).toBe(true);
  });

  it("100x ist bei 2% Wartungsmarge NICHT haltbar (1/100=0.01, nicht > 0.02)", () => {
    expect(leverageSustainable(100, 0.02)).toBe(false);
  });
});

describe("longSharePct", () => {
  function point(overrides: Partial<OiCandlePoint> = {}): OiCandlePoint {
    return { t: "2026-09-05T00:00:00Z", oi: 1000, o: 100, h: 101, l: 99, c: 100, v: 100, tb: 50, ...overrides };
  }

  it("liegt nahe 0.9 bei starkem Taker-Buy-Ueberhang und gruener Kerze", () => {
    const share = longSharePct(point({ tb: 95, v: 100, o: 99, c: 101, h: 101, l: 99 }));
    expect(share).toBeGreaterThan(0.8);
  });

  it("liegt nahe 0.1 bei starkem Taker-Sell-Ueberhang und roter Kerze", () => {
    const share = longSharePct(point({ tb: 5, v: 100, o: 101, c: 99, h: 101, l: 99 }));
    expect(share).toBeLessThan(0.2);
  });

  it("liegt bei 0.5 ohne jedes Signal (kein Volumen, Doji)", () => {
    const share = longSharePct(point({ v: 0, tb: 0, o: 100, c: 100, h: 100, l: 100 }));
    expect(share).toBeCloseTo(0.5, 6);
  });
});

describe("buildLeverageClusters", () => {
  const basePoints: OiCandlePoint[] = [
    { t: "2026-09-05T00:00:00Z", oi: 1000, o: 100, h: 100.5, l: 99.5, c: 100, v: 200, tb: 160 },
    { t: "2026-09-05T01:00:00Z", oi: 1100, o: 100, h: 100.6, l: 99.6, c: 100.2, v: 200, tb: 160 },
    { t: "2026-09-05T02:00:00Z", oi: 1200, o: 100.2, h: 100.8, l: 99.8, c: 100.4, v: 200, tb: 160 },
    { t: "2026-09-05T03:00:00Z", oi: 1300, o: 100.4, h: 101.0, l: 100.0, c: 100.6, v: 200, tb: 160 },
    { t: "2026-09-05T04:00:00Z", oi: 1400, o: 100.6, h: 101.2, l: 100.2, c: 100.8, v: 200, tb: 160 },
  ];

  it("liefert leeres Ergebnis ohne Datenpunkte", () => {
    const result = buildLeverageClusters([], { mid: 100, bucketSize: 0.5 });
    expect(result.clusters).toHaveLength(0);
    expect(result.attributedCoins).toBe(0);
  });

  it("legt Long-Cluster unterhalb und Short-Cluster oberhalb des Mid an", () => {
    const result = buildLeverageClusters(basePoints, { mid: 100.8, bucketSize: 0.25, spanPct: 15 });
    const longClusters = result.clusters.filter((c) => c.side === "long");
    const shortClusters = result.clusters.filter((c) => c.side === "short");
    expect(longClusters.length).toBeGreaterThan(0);
    for (const c of longClusters) expect(c.price).toBeLessThan(100.8);
    for (const c of shortClusters) expect(c.price).toBeGreaterThan(100.8);
  });

  it("attribuiert bei dominant long-gerichtetem Taker-Flow mehr Masse in Long- als Short-Cluster", () => {
    const result = buildLeverageClusters(basePoints, { mid: 100.8, bucketSize: 0.25, spanPct: 15 });
    const longMass = result.clusters.filter((c) => c.side === "long").reduce((s, c) => s + c.massCoins, 0);
    const shortMass = result.clusters.filter((c) => c.side === "short").reduce((s, c) => s + c.massCoins, 0);
    expect(longMass).toBeGreaterThan(shortMass);
  });

  it("verwirft Hebelstufen, die die Wartungsmarge nicht haltbar machen", () => {
    const result = buildLeverageClusters(basePoints, {
      mid: 100.8,
      bucketSize: 0.25,
      mmr: 0.02,
      tiers: [10, 25, 50, 100],
    });
    expect(result.droppedTiers).toContain(50);
    expect(result.droppedTiers).toContain(100);
    expect(result.droppedTiers).not.toContain(10);
  });

  it("erste Periode (seed=false) traegt nichts bei -- nur WAEHREND des Fensters neu eroeffnetes OI zaehlt", () => {
    const singlePoint: OiCandlePoint[] = [basePoints[0]];
    const result = buildLeverageClusters(singlePoint, { mid: 100, bucketSize: 0.25 });
    expect(result.attributedCoins).toBe(0);
    expect(result.clusters).toHaveLength(0);
  });
});
