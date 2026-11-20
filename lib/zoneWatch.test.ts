import { describe, expect, it, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import { episodeStart, summarizeZoneWatch, zoneWatchLines, type FlowCandle } from "./zoneWatch";

const zone = { price: 100, low: 99, high: 100 };

/** 15m-Kerzen ab 20.11.2026 12:00 UTC aus [open, high, low, close]. */
function c15(rows: [number, number, number, number][], flow = true): FlowCandle[] {
  return rows.map(([open, high, low, close], i) => ({
    openTime: new Date(Date.UTC(2026, 10, 20, 12, 15 * i)).toISOString(),
    open,
    high,
    low,
    close,
    ...(flow ? { volume: 10, takerBuy: close >= open ? 7 : 3 } : {}),
  }));
}

describe("episodeStart", () => {
  it("findet den Beginn des aktuellen Aufenthalts im Retest-Band", () => {
    const c = c15([
      [104, 105, 103, 104],
      [104, 104, 101, 101.5], // Tief 101 > 100,25: noch nicht an der Zone
      [101.5, 101.6, 99.8, 100.1],
      [100.1, 100.4, 99.2, 99.5],
    ]);
    expect(episodeStart(c, zone)).toBe(2);
  });
  it("liefert null, wenn die letzte Kerze nicht an der Zone ist", () => {
    expect(episodeStart(c15([[104, 105, 103, 104]]), zone)).toBeNull();
  });
});

describe("summarizeZoneWatch", () => {
  const c = c15([
    [104, 105, 103, 104],
    [101.5, 101.6, 99.8, 100.1], // Schluss knapp ueber der Zone, kein Docht jenseits
    [100.1, 100.8, 99.5, 99.7], // Docht ueber die Oberkante, Schluss darunter
    [99.7, 99.9, 98.5, 99.2], // Docht unter die Unterkante, Schluss darueber
    [99.2, 99.4, 98.6, 98.8], // Schluss unter der Zone
  ]);

  it("zaehlt Schluesse, Ablehnungsdochte, CVD, OI, Liquidationen, Wand und Zeiteinheits-Schluss", () => {
    const w = summarizeZoneWatch({
      zone,
      c15: c,
      oi: [
        { time: c[0].openTime, oi: 900 },
        { time: c[1].openTime, oi: 1000 },
        { time: c[4].openTime, oi: 1012 },
      ],
      liquidations: [
        { time: c[0].openTime, side: "long" }, // vor dem Eintritt
        { time: c[2].openTime, side: "long" },
        { time: c[3].openTime, side: "short" },
        { time: c[3].openTime, side: "short" },
      ],
      walls: [
        { exchange: "binance", bid_wall_price: 99.1, bid_wall_usd: 1.3e6, ask_wall_price: 103, ask_wall_usd: 5e6 },
        { exchange: "bybit", bid_wall_price: 99.6, bid_wall_usd: 0.8e6, ask_wall_price: null, ask_wall_usd: null },
      ],
      tfCandle: { tf: "1h", candle: c[4] },
    });
    expect(w).not.toBeNull();
    expect(w!.candles).toBe(4);
    expect(w!.closes).toEqual({ above: 1, inside: 2, below: 1 });
    expect(w!.rejects).toEqual({ top: 1, bottom: 1 });
    expect(w!.cvdBtc).toBe(-16); // vier rote Kerzen: je 2*3 - 10 = -4
    expect(w!.oiPct).toBeCloseTo(1.2, 5);
    expect(w!.liquidations).toEqual({ long: 1, short: 2 });
    expect(w!.wall).toEqual({ side: "bid", price: 99.1, usd: 1.3e6, exchange: "binance" });
    expect(w!.tfClose).toEqual({ tf: "1h", where: "unter" });
    expect(zoneWatchLines(w!)).toEqual([
      "seit 13:15 (4× 15m) · Schlüsse 1 über, 2 in, 1 unter",
      "Dochte oben 1×, unten 1× · 1h-Schluss unter Zone",
      "CVD −16 BTC · OI +1.2 % · Liq. L 1 / S 2",
      "Wand Bid 1.3 Mio. $ bei 99 (binance)",
    ]);
  });

  it("laesst CVD, OI und Liquidationen weg, wenn Daten fehlen", () => {
    const w = summarizeZoneWatch({ zone, c15: c15([[101.5, 101.6, 99.8, 100.1]], false) });
    expect(w!.cvdBtc).toBeNull();
    expect(w!.oiPct).toBeNull();
    expect(w!.liquidations).toBeNull();
    expect(zoneWatchLines(w!)).toHaveLength(2);
  });
});
