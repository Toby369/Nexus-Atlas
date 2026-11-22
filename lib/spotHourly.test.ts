import { describe, expect, it } from "vitest";
import { hourlySpotNet, spotTurn } from "./spotHourly";

const H = 3_600_000;
const NOW = Date.parse("2026-11-22T07:01:00Z"); // 08:01 Zuerich
const pt = (iso: string, b: number, s: number) => ({ timestamp_utc: iso, last_price: 1, taker_buy_vol: b, taker_sell_vol: s });

describe("Spot-Druck je Stunde", () => {
  it("summiert je Stunde, letzte Stunde laeuft noch", () => {
    const bars = hourlySpotNet(
      [pt("2026-11-22T05:05:00Z", 100, 120), pt("2026-11-22T05:35:00Z", 200, 210), pt("2026-11-22T07:00:00Z", 10, 5)],
      NOW
    );
    expect(bars).toHaveLength(12);
    expect(bars[11]).toMatchObject({ startMs: Date.parse("2026-11-22T07:00:00Z"), complete: false });
    expect(bars[9].netPct).toBeCloseTo(((300 - 330) / 630) * 100);
    expect(bars[0].netPct).toBeNull();
  });

  it("22.11.: 4H verkauft, 07 und 08 Uhr kaufen -> dreht hoch", () => {
    const bars = [
      { startMs: NOW - 3 * H, netPct: -7.5, complete: true },
      { startMs: NOW - 2 * H, netPct: 8.5, complete: true },
      { startMs: NOW - H, netPct: 10.2, complete: true },
      { startMs: NOW, netPct: 2, complete: false },
    ];
    expect(spotTurn(bars, "down")).toBe("up");
    expect(spotTurn(bars, "up")).toBeNull();
    expect(spotTurn([...bars.slice(0, 2), { ...bars[2], netPct: 3 }, bars[3]], "down")).toBeNull();
  });
});
