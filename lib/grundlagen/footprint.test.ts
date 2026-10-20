import { describe, expect, it } from "vitest";
import {
  FOOTPRINT_SCENARIOS,
  FOOTPRINT_TICK,
  candleDelta,
  candleVolume,
  diagonalImbalances,
  longestStack,
  pocPrice,
  type FootprintCandle,
} from "./footprint";

const simple: FootprintCandle = {
  open: 100,
  close: 150,
  levels: [
    { price: 150, bid: 10, ask: 40 },
    { price: 100, bid: 5, ask: 20 },
    { price: 50, bid: 60, ask: 6 },
  ],
};

describe("Footprint-Kennzahlen", () => {
  it("Delta, Volumen und POC", () => {
    expect(candleDelta(simple)).toBe(40 - 10 + 20 - 5 + 6 - 60);
    expect(candleVolume(simple)).toBe(141);
    expect(pocPrice(simple)).toBe(50);
  });

  it("vergleicht diagonal: Ask mit dem Bid eine Stufe tiefer, Bid mit dem Ask eine Stufe hoeher", () => {
    // 150: Ask 40 >= 3 x Bid(100)=5 -> buy. 100: Ask 20 < 3 x 60, Bid 5 < 3 x 40 -> null.
    // 50: Bid 60 >= 3 x Ask(100)=20 -> sell.
    expect(diagonalImbalances(simple)).toEqual(["buy", null, "sell"]);
  });

  it("zaehlt die laengste gestapelte Folge", () => {
    expect(longestStack(["buy", "buy", null, "buy", "buy", "buy"], "buy")).toBe(3);
    expect(longestStack(["sell", null], "buy")).toBe(0);
  });
});

describe("Szenarien sind in sich stimmig", () => {
  it.each(FOOTPRINT_SCENARIOS.map((s) => [s.id, s] as const))("%s: Raster, Open und Close", (_id, s) => {
    const { levels, open, close } = s.candle;
    levels.forEach((l, i) => {
      if (i > 0) expect(levels[i - 1].price - l.price).toBe(FOOTPRINT_TICK);
    });
    const high = levels[0].price;
    const low = levels[levels.length - 1].price;
    for (const p of [open, close]) {
      expect(p).toBeLessThanOrEqual(high);
      expect(p).toBeGreaterThanOrEqual(low);
    }
  });

  const byId = Object.fromEntries(FOOTPRINT_SCENARIOS.map((s) => [s.id, s.candle]));

  it("Absorption am Hoch: starkes positives Delta, kaum Fortschritt", () => {
    const c = byId["absorption-high"];
    expect(candleDelta(c)).toBeGreaterThan(1000);
    expect(c.close - c.open).toBeLessThanOrEqual(FOOTPRINT_TICK);
  });

  it("Absorption am Tief: starkes negatives Delta, Schluss ueber dem Tief", () => {
    const c = byId["absorption-low"];
    expect(candleDelta(c)).toBeLessThan(-1000);
    expect(c.close).toBeGreaterThan(c.levels[c.levels.length - 1].price + FOOTPRINT_TICK);
  });

  it("Erschoepfung: oberste zwei Stufen unter 10 % des Durchschnittsvolumens", () => {
    const c = byId["exhaustion"];
    const avg = candleVolume(c) / c.levels.length;
    for (const l of c.levels.slice(0, 2)) expect(l.bid + l.ask).toBeLessThan(avg * 0.1);
  });

  it("Echter Ausbruch: mindestens drei gestapelte Kaeufer-Ungleichgewichte, Schluss am Hoch", () => {
    const c = byId["initiative"];
    expect(longestStack(diagonalImbalances(c), "buy")).toBeGreaterThanOrEqual(3);
    expect(c.close).toBe(c.levels[0].price);
  });

  it("Unfertige Auktion: am Tief auf beiden Seiten deutlich Volumen", () => {
    const low = byId["unfinished"].levels.at(-1)!;
    expect(Math.min(low.bid, low.ask)).toBeGreaterThanOrEqual(50);
  });

  it("Gefangene Trader: oben Kaeufer, Schluss am Tief, unten gestapelte Verkaeufer", () => {
    const c = byId["trapped"];
    const top = c.levels.slice(0, 3).reduce((s, l) => s + l.ask - l.bid, 0);
    expect(top).toBeGreaterThan(0);
    expect(c.close).toBe(c.levels.at(-1)!.price);
    expect(longestStack(diagonalImbalances(c), "sell")).toBeGreaterThanOrEqual(3);
  });
});
