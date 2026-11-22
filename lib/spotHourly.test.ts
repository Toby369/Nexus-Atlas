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

  it("22.11.: 07 Uhr geschlossen +9 %, laufende 08-Uhr-Stunde +10 % -> dreht hoch", () => {
    // NOW = 08:01 Zuerich; laufende Stunde beginnt 08:00 (07:00Z)
    const run = Date.parse("2026-11-22T07:00:00Z");
    const bars = [
      { startMs: run - 2 * H, netPct: -7.5, complete: true },
      { startMs: run - H, netPct: 8.5, complete: true },
      { startMs: run, netPct: 10.2, complete: false },
    ];
    // nach 1 Min Laufzeit noch nicht, nach 20 Min schon
    expect(spotTurn(bars, "down", run + 60_000)).toBeNull();
    expect(spotTurn(bars, "down", run + 20 * 60_000)).toBe("up");
    expect(spotTurn(bars, "up", run + 20 * 60_000)).toBeNull();
    // 07:15: letzte geschlossene Stunde (06 Uhr) noch rot -> keine Drehung
    const at0715 = [bars[0], { ...bars[1], complete: false }];
    expect(spotTurn(at0715, "down", run - H + 20 * 60_000)).toBeNull();
  });
});
