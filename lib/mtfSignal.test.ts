import { describe, it, expect } from "vitest";
import { classifyMtfDot, buildMtfDots, MTF_TIMEFRAMES, type MtfDotStatus } from "./mtfSignal";
import type { MarketFeaturesMtfRow } from "./types";

const ONE_HOUR_MS = 60 * 60 * 1000;

// candle_open_time liegt bei einer echten, gerade abgeschlossenen 1H-Kerze
// ca. eine Stunde in der Vergangenheit (Schlusszeit ≈ jetzt) -- open_time =
// jetzt waere eine noch gar nicht geschlossene Kerze und wuerde von
// isFreshCandle() als "Schlusszeit in der Zukunft" verworfen.
function row(overrides: Partial<MarketFeaturesMtfRow> = {}): MarketFeaturesMtfRow {
  return {
    interval: "1h",
    candle_open_time: new Date(Date.now() - ONE_HOUR_MS).toISOString(),
    structure_trend: "bullish",
    adx_14: 30,
    ...overrides,
  };
}

describe("classifyMtfDot", () => {
  it("meldet bullish_confirmed bei bullischer Struktur und ADX >= 25", () => {
    const dot = classifyMtfDot("1H", row({ structure_trend: "bullish", adx_14: 30 }));
    expect(dot.status).toBe("bullish_confirmed");
  });

  it("meldet bullish_forming bei bullischer Struktur und ADX < 25", () => {
    const dot = classifyMtfDot("1H", row({ structure_trend: "bullish", adx_14: 22 }));
    expect(dot.status).toBe("bullish_forming");
  });

  it("meldet bearish_confirmed bei bärischer Struktur und ADX >= 25", () => {
    const dot = classifyMtfDot("1H", row({ structure_trend: "bearish", adx_14: 40 }));
    expect(dot.status).toBe("bearish_confirmed");
  });

  it("meldet bearish_forming bei bärischer Struktur und ADX < 25", () => {
    const dot = classifyMtfDot("1H", row({ structure_trend: "bearish", adx_14: 18 }));
    expect(dot.status).toBe("bearish_forming");
  });

  it("meldet neutral bei ranging-Struktur, unabhängig vom ADX", () => {
    const dot = classifyMtfDot("1H", row({ structure_trend: "ranging", adx_14: 40 }));
    expect(dot.status).toBe("neutral");
  });

  it("adx == 25 zählt bereits als bestätigt (>=)", () => {
    const dot = classifyMtfDot("1H", row({ structure_trend: "bullish", adx_14: 25 }));
    expect(dot.status).toBe("bullish_confirmed");
  });

  it("fehlender ADX-Wert bei gerichteter Struktur zählt als forming, nicht als Fehler", () => {
    const dot = classifyMtfDot("1H", row({ structure_trend: "bullish", adx_14: null }));
    expect(dot.status).toBe("bullish_forming");
  });

  it("meldet no_data, wenn keine Zeile vorliegt", () => {
    const dot = classifyMtfDot("1W", null);
    expect(dot.status).toBe("no_data");
  });

  it("meldet no_data, wenn die Kerze zu alt ist (stale)", () => {
    const staleTime = new Date(Date.now() - 10 * 60 * 60 * 1000).toISOString(); // 10h alt
    const dot = classifyMtfDot("1H", row({ interval: "1h", candle_open_time: staleTime }));
    expect(dot.status).toBe("no_data");
  });

  it("akzeptiert eine frische Kerze knapp innerhalb der Toleranz (1H, < 2x Intervall)", () => {
    const freshTime = new Date(Date.now() - 90 * 60 * 1000).toISOString(); // 1.5h alt
    const dot = classifyMtfDot("1H", row({ interval: "1h", candle_open_time: freshTime, structure_trend: "bullish", adx_14: 30 }));
    expect(dot.status).toBe("bullish_confirmed");
  });
});

describe("buildMtfDots", () => {
  it("liefert genau 5 Punkte in der Reihenfolge 15M/1H/4H/1D/1W", () => {
    const dots = buildMtfDots({});
    expect(dots.map((d) => d.timeframe)).toEqual(["15M", "1H", "4H", "1D", "1W"]);
  });

  it("1W ist immer no_data, unabhängig von den übergebenen Zeilen", () => {
    const dots = buildMtfDots({ "1w": row({ interval: "1w", structure_trend: "bullish", adx_14: 30 }) });
    const w = dots.find((d) => d.timeframe === "1W");
    expect(w?.status).toBe("no_data");
  });

  it("übernimmt fehlende Zeitrahmen als no_data statt zu werfen", () => {
    const dots = buildMtfDots({ "1h": row({ interval: "1h", structure_trend: "bearish", adx_14: 30 }) });
    const statuses: Record<string, MtfDotStatus> = Object.fromEntries(dots.map((d) => [d.timeframe, d.status]));
    expect(statuses["15M"]).toBe("no_data");
    expect(statuses["1H"]).toBe("bearish_confirmed");
    expect(statuses["4H"]).toBe("no_data");
    expect(statuses["1D"]).toBe("no_data");
  });

  it("MTF_TIMEFRAMES deckt genau die vier von collect-candles gepflegten Intervalle ab", () => {
    expect(MTF_TIMEFRAMES.map((t) => t.interval)).toEqual(["15m", "1h", "4h", "1d"]);
  });
});
