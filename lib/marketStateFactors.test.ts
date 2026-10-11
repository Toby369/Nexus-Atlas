import { describe, expect, it } from "vitest";
import { factorColor, factorLabel, factorRawValueLabel, riskFactorLabel } from "./marketStateFactors";

describe("marketStateFactors", () => {
  it("formatiert Rohwerte je Faktor", () => {
    expect(factorRawValueLabel("momentum", { rsi_14: 55.81 })).toBe("RSI 55.8");
    expect(factorRawValueLabel("oi_price", { oi_delta_pct: 0.0585 })).toBe("OI-Δ +0.06%");
    expect(factorRawValueLabel("structure", { bos: true, choch: false })).toBe("BOS ja · CHoCH nein");
    expect(factorRawValueLabel("trend_regime", { close_price: 101, ema_50: 100 })).toBe("Preis vs. EMA50 +1.00%");
  });

  it("liefert null bei fehlenden Rohwerten oder unbekanntem Faktor", () => {
    expect(factorRawValueLabel("momentum", {})).toBeNull();
    expect(factorRawValueLabel("unbekannt", { value: 1 })).toBeNull();
  });

  it("beschriftet und faerbt Faktor-Werte", () => {
    expect(factorLabel(1)).toBe("bullisch");
    expect(factorLabel(null)).toBe("keine Daten");
    expect(factorColor(-1)).toBe("text-down");
  });

  it("nennt Warn-Muster samt Richtung", () => {
    expect(riskFactorLabel("warning_pattern", [{ name: "Fragile Bullish" }])).toMatch(/^Warn-Muster: Fragile Bullish \(/);
    expect(riskFactorLabel("funding_crowding", [])).toBe("Funding-Crowding");
  });
});
