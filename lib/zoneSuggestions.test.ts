import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Candle } from "./candles";
import { levelTimeframe, suggestMissingZones, suggestionText } from "./zoneSuggestions";

const fixture = JSON.parse(
  readFileSync(path.join(__dirname, "__fixtures__", "btc_1h_2026-10-28_2026-11-11.json"), "utf8")
) as { kerzen: [string, number, number, number, number][] };
const real1h: Candle[] = fixture.kerzen.map(([openTime, open, high, low, close]) => ({ openTime, open, high, low, close }));
const lastClose = real1h[real1h.length - 1].close; // ~73'800, unter der gruenen Zone

describe("levelTimeframe", () => {
  it("nimmt die hoechste Zeiteinheit, 1W zaehlt als 1D", () => {
    expect(levelTimeframe(["1h", "4h"])).toBe("4h");
    expect(levelTimeframe(["1w", "1h"])).toBe("1d");
    expect(levelTimeframe([])).toBeNull();
  });
});

describe("suggestMissingZones", () => {
  const green = { price: 76_444, timeframes: ["1h"] }; // Pivot-Tief 30.10., gedreht am 05.11.

  it("schlaegt ein gedrehtes Nexus-Level vor, das bei dir fehlt", () => {
    const s = suggestMissingZones([green], [], { "1h": real1h }, lastClose);
    expect(s.above).not.toBeNull();
    expect(s.above!.role).toBe("R");
    expect(s.above!.breakAt.slice(0, 10)).toBe("2026-11-05");
    expect(s.above!.retests).toBeGreaterThan(0);
    expect(suggestionText(s.above!)).toMatch(/^R 76’444 · 1h · Bruch 05\.11\. · \d+× Retest$/);
    expect(s.below).toBeNull();
  });

  it("schweigt, wenn du dort schon eine Zone hast", () => {
    const own = [{ price: 76_533, low: 76_270, high: 76_796 }];
    expect(suggestMissingZones([green], own, { "1h": real1h }, lastClose).above).toBeNull();
  });

  it("schweigt bei Levels ohne Bruch", () => {
    // 70'000 wurde im Fixture nie erreicht: keine Geschichte, kein Vorschlag
    const s = suggestMissingZones([{ price: 70_000, timeframes: ["1h"] }], [], { "1h": real1h }, lastClose);
    expect(s).toEqual({ above: null, below: null });
  });
});
