import { describe, expect, it } from "vitest";
import { computeEma } from "./meinSystemContext";

describe("computeEma", () => {
  it("gibt null zurueck, wenn zu wenig Kerzen vorliegen", () => {
    expect(computeEma([1, 2, 3], 13)).toBeNull();
  });

  it("entspricht dem einfachen Durchschnitt bei genau period Werten (SMA-Seed)", () => {
    const closes = [1, 2, 3, 4, 5];
    expect(computeEma(closes, 5)).toBeCloseTo(3, 6);
  });

  it("reagiert staerker auf juengere Werte als ein einfacher Durchschnitt", () => {
    // Konstante Basis, dann ein Sprung -- EMA sollte naeher am Sprungwert
    // liegen als der SMA aller Werte.
    const closes = [100, 100, 100, 100, 100, 200, 200, 200, 200, 200];
    const ema = computeEma(closes, 5)!;
    const smaAll = closes.reduce((a, b) => a + b, 0) / closes.length;
    expect(ema).toBeGreaterThan(smaAll);
  });

  it("ist deterministisch fuer denselben Input", () => {
    const closes = [10, 11, 12, 13, 14, 15, 16];
    expect(computeEma(closes, 5)).toBe(computeEma(closes, 5));
  });
});
