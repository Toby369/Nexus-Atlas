import { describe, expect, it } from "vitest";
import { simulateMarketOrder, SIM_START_PRICE } from "./orderbook";
import { readScenario } from "./scenario";
import { computePosition } from "./positionSizing";

describe("simulateMarketOrder", () => {
  it("kleine Kauforder fuellt nur die erste Stufe", () => {
    const r = simulateMarketOrder(2, "buy");
    expect(r.lastPrice).toBe(SIM_START_PRICE + 50);
    expect(r.levels[0].filled).toBe(2);
    expect(r.levels[1].filled).toBe(0);
    expect(r.exhausted).toBe(false);
  });

  it("duennes Buch bewegt den Preis bei gleicher Order weiter", () => {
    const normal = simulateMarketOrder(20, "buy");
    const thin = simulateMarketOrder(20, "buy", true);
    expect(thin.movePct).toBeGreaterThan(normal.movePct);
  });

  it("Verkauf bewegt den Preis nach unten", () => {
    const r = simulateMarketOrder(10, "sell");
    expect(r.movePct).toBeLessThan(0);
  });

  it("zu grosse Order leert das Buch", () => {
    expect(simulateMarketOrder(1000, "buy").exhausted).toBe(true);
  });

  it("ohne Order keine Bewegung", () => {
    const r = simulateMarketOrder(0, "buy");
    expect(r.movePct).toBe(0);
    expect(r.avgFillPrice).toBeNull();
  });
});

describe("readScenario", () => {
  it("Preis hoch, OI runter, Funding negativ -> laufender Short-Squeeze", () => {
    const r = readScenario("up", "down", "neg");
    expect(r.name).toBe("Short-Covering");
    expect(r.fundingTag).toBe("Short-Squeeze läuft");
  });
  it("Preis seitwaerts, OI hoch -> Spannung", () => {
    expect(readScenario("flat", "up", "neutral").name).toBe("Spannung baut sich auf");
  });
  it("Preis faellt bei stark positivem Funding -> bearish", () => {
    expect(readScenario("down", "up", "pos").fundingTone).toBe("bearish");
  });
});

describe("computePosition", () => {
  const base = { account: 10_000, riskPct: 1, entry: 60_000, stop: 59_000, target: 62_000, winRatePct: 40, leverage: 1 };

  it("Positionsgroesse folgt aus Risiko und Stop-Abstand", () => {
    const r = computePosition(base)!;
    expect(r.side).toBe("long");
    expect(r.riskAmount).toBe(100);
    expect(r.sizeBtc).toBeCloseTo(0.1, 10);
    expect(r.effectiveLeverage).toBeCloseTo(0.6, 10);
  });

  it("CRV 1:2 -> Break-even bei 33 %, bei 40 % Treffern positiver Erwartungswert", () => {
    const r = computePosition(base)!;
    expect(r.rewardRisk).toBe(2);
    expect(r.breakEvenWinRatePct).toBeCloseTo(33.33, 1);
    expect(r.expectancyR).toBeCloseTo(0.2, 10);
  });

  it("20x isoliert mit weitem Stop -> Liquidation vor dem Stop", () => {
    const r = computePosition({ ...base, stop: 56_500, leverage: 20 })!;
    expect(r.liquidationPrice).toBeCloseTo(57_300, 6);
    expect(r.liquidationBeforeStop).toBe(true);
  });

  it("Short: Stop ueber Entry, Ziel darunter", () => {
    const r = computePosition({ ...base, stop: 61_000, target: 58_000 })!;
    expect(r.side).toBe("short");
    expect(r.rewardRisk).toBe(2);
  });

  it("Ziel auf der falschen Seite -> kein CRV", () => {
    expect(computePosition({ ...base, target: 59_500 })!.rewardRisk).toBeNull();
  });

  it("Stop gleich Entry -> keine Berechnung", () => {
    expect(computePosition({ ...base, stop: 60_000 })).toBeNull();
  });
});
