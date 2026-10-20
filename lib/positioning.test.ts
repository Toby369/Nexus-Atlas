import { describe, expect, it } from "vitest";
import { summarizePositioning } from "./positioning";
import type { PositioningSnapshot } from "./types";

function snap(globalLong: number | string | null, topPos: number | null = null): PositioningSnapshot {
  return {
    global_long_account_ratio: globalLong,
    top_trader_long_position_ratio: topPos,
  } as unknown as PositioningSnapshot;
}

describe("summarizePositioning", () => {
  it("mittelt die Masse ueber alle Boersen mit Daten", () => {
    const binance = snap(0.6, 0.7);
    const s = summarizePositioning([binance, snap("0.62"), null, snap(null)], binance)!;
    expect(s.crowdLongPct).toBeCloseTo(61);
    expect(s.exchangeCount).toBe(2);
    expect(s.topLongPct).toBeCloseTo(70);
    expect(s.divergencePp).toBeCloseTo(10);
    expect(s.label).toBe("Ausgeglichen");
    expect(s.tone).toBe("calm");
  });

  it.each([
    [0.72, "Masse extrem long", "risk"],
    [0.66, "Masse stark long", "watch"],
    [0.48, "Masse mehrheitlich short", "watch"],
  ])("Masse %s -> %s", (crowd, label, tone) => {
    const s = summarizePositioning([snap(crowd)], null)!;
    expect(s.label).toBe(label);
    expect(s.tone).toBe(tone);
    expect(s.divergencePp).toBeNull();
  });

  it("Top-Trader nicht longer als die Masse -> Hinweis und mindestens watch", () => {
    const binance = snap(0.6, 0.58);
    const s = summarizePositioning([binance], binance)!;
    expect(s.divergencePp).toBeCloseTo(-2);
    expect(s.tone).toBe("watch");
    expect(s.hint).toContain("Gegenseite");
  });

  it("ohne Daten null", () => {
    expect(summarizePositioning([null, snap(null)], null)).toBeNull();
  });
});
