import { describe, expect, it } from "vitest";
import { TIMEFRAMES } from "./timeframes";
import { REGIME_INTERVAL_LABEL, regimeIntervalFor } from "./regimeTimeframe";

describe("regimeIntervalFor", () => {
  it("ordnet jedem Zeitraum ein Kerzen-Intervall zu", () => {
    expect(TIMEFRAMES.map((t) => regimeIntervalFor(t.id))).toEqual(["1h", "1h", "4h", "1d", "1w", "1w"]);
  });

  it("hat fuer jedes Intervall eine Beschriftung", () => {
    for (const t of TIMEFRAMES) expect(REGIME_INTERVAL_LABEL[regimeIntervalFor(t.id)]).toBeTruthy();
  });
});
