import { describe, expect, it } from "vitest";
import {
  interpretLevelStructure,
  confluenceTier,
  confluenceLabel,
  computeSignalTally,
  type LevelStructureCandle,
} from "./levelStructureContext";

function candle(openTime: string, high: number, low: number, close: number): LevelStructureCandle {
  return { openTime, high, low, close };
}

describe("interpretLevelStructure", () => {
  it("meldet 'respecting', solange kein Schlusskurs die Resistance ueberschreitet", () => {
    const candles = [
      candle("c1", 980, 950, 970),
      candle("c2", 995, 960, 990), // Annaeherung, aber kein Schluss drueber
      candle("c3", 985, 970, 975),
    ];
    const result = interpretLevelStructure({ price: 1000, side: "resistance", anchorOpenTime: "anchor" }, candles, []);
    expect(result.phase).toBe("respecting");
    expect(result.breakOpenTime).toBeNull();
    expect(result.closestApproach?.openTime).toBe("c2");
    expect(result.closestApproach?.price).toBe(995);
    expect(result.narrative).toContain("intakt");
  });

  it("erkennt den Bruch einer Resistance am ersten Schlusskurs darueber", () => {
    const candles = [candle("c1", 990, 970, 980), candle("c2", 1010, 995, 1005)];
    const result = interpretLevelStructure({ price: 1000, side: "resistance", anchorOpenTime: "anchor" }, candles, []);
    expect(result.phase).toBe("broken");
    expect(result.breakOpenTime).toBe("c2");
    expect(result.sinceOpenTime).toBe("c2");
    expect(result.counterEvent).toBeNull();
  });

  it("findet das juengste Gegen-Ereignis (LL) nach einem Bruch nach oben und setzt sinceOpenTime darauf", () => {
    const candles = [
      candle("break", 1010, 995, 1005), // Bruch
      candle("retest1", 1005, 998, 1002), // erster Retest, Tief 998
      candle("dip", 1003, 990, 995), // tieferer Dip, Tief 990 -- echtes Gegen-Ereignis
      candle("recover", 1020, 991, 1015),
    ];
    const swingRows = [
      { candleOpenTime: "retest1", swingType: "HL" as const },
      { candleOpenTime: "dip", swingType: "LL" as const },
      { candleOpenTime: "recover", swingType: "HL" as const },
    ];
    const result = interpretLevelStructure(
      { price: 1000, side: "resistance", anchorOpenTime: "anchor" },
      candles,
      swingRows
    );
    expect(result.phase).toBe("broken");
    expect(result.breakOpenTime).toBe("break");
    expect(result.counterEvent).toEqual({ openTime: "dip", price: 990 });
    expect(result.sinceOpenTime).toBe("dip");
    expect(result.narrative).toContain("Erneut getestet");
    expect(result.narrative).toContain("keine tieferen Tiefs mehr");
  });

  it("verhaelt sich symmetrisch fuer eine gebrochene Unterstuetzung (Gegen-Ereignis HH)", () => {
    const candles = [candle("c1", 1005, 985, 990), candle("c2", 1012, 991, 1008)];
    const swingRows = [{ candleOpenTime: "c2", swingType: "HH" as const }];
    const result = interpretLevelStructure(
      { price: 1000, side: "support", anchorOpenTime: "anchor" },
      candles,
      swingRows
    );
    expect(result.phase).toBe("broken");
    expect(result.counterEvent).toEqual({ openTime: "c2", price: 1012 });
    expect(result.narrative).toContain("keine höheren Hochs mehr");
  });

  it("ignoriert Swing-Zeilen vor dem Bruch", () => {
    const candles = [candle("c1", 990, 970, 980), candle("c2", 1010, 995, 1005)];
    const swingRows = [{ candleOpenTime: "c1", swingType: "LL" as const }];
    const result = interpretLevelStructure(
      { price: 1000, side: "resistance", anchorOpenTime: "anchor" },
      candles,
      swingRows
    );
    expect(result.counterEvent).toBeNull();
    expect(result.sinceOpenTime).toBe("c2");
  });
});

describe("confluenceTier / confluenceLabel", () => {
  it("Stufe 1 ohne EMA50/Swing-VWAP", () => {
    expect(confluenceTier([])).toBe(1);
    expect(confluenceLabel([])).toBe("Key-Level");
  });

  it("Stufe 2 mit genau einer Bestaetigung", () => {
    expect(confluenceTier(["ema50"])).toBe(2);
    expect(confluenceLabel(["ema50"])).toBe("Key-Level + EMA50");
  });

  it("Stufe 3 mit EMA50 UND Swing-VWAP", () => {
    expect(confluenceTier(["ema50", "vwap_swing_high"])).toBe(3);
    expect(confluenceLabel(["ema50", "vwap_swing_high"])).toBe("Key-Level + EMA50 + Swing-VWAP");
  });

  it("ignoriert nicht-relevante Bestaetigungen (liquidation/spot_volume) fuer die Stufe", () => {
    expect(confluenceTier(["liquidation", "spot_volume"])).toBe(1);
  });
});

describe("computeSignalTally", () => {
  it("zaehlt CVD, Warn-Muster und MTF-Ampel ungewichtet", () => {
    const tally = computeSignalTally(
      "falling",
      [{ name: "Fragile Bullish" }, { name: "Short Squeeze" }],
      [
        { status: "bearish_confirmed" },
        { status: "bearish_forming" },
        { status: "bullish_confirmed" },
        { status: "neutral" },
        { status: "no_data" },
      ]
    );
    // CVD fallend=baerisch, Fragile Bullish=baerisch, Short Squeeze=bullisch,
    // MTF-Ampel 1 bullisch/2 baerisch -> baerisch.
    expect(tally.bearish).toBe(3);
    expect(tally.bullish).toBe(1);
    expect(tally.neutral).toBe(0);
    expect(tally.entries).toHaveLength(4);
  });

  it("liefert ein leeres Tally ohne Signale", () => {
    const tally = computeSignalTally(null, [], []);
    expect(tally).toEqual({ bearish: 0, bullish: 0, neutral: 0, entries: [] });
  });
});
