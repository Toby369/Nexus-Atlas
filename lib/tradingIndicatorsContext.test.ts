import { describe, expect, it } from "vitest";
import {
  bucketMinuteDeltas,
  classifyCvdTrend,
  detectCvdDivergence,
  evaluateGussPullback,
} from "./tradingIndicatorsContext";

describe("evaluateGussPullback", () => {
  it("liefert null/null bei leerem Segment", () => {
    expect(evaluateGussPullback([], [], "up")).toEqual({ touched: null, clean: null });
  });

  it("erkennt einen sauberen, EMA-beruehrenden Pullback im Aufwaertstrend", () => {
    // Swing-Hoch bei 100, dann drei baerische Kerzen abwaerts, deren Docht
    // schliesslich die EMA (97) beruehrt.
    const segment = [
      { open: 96, high: 100, low: 94, close: 97 }, // Ursprungs-Swing-Kerze (ausgenommen)
      { open: 97, high: 97, low: 93, close: 94 },
      { open: 94, high: 94, low: 90, close: 91 },
      { open: 91, high: 92, low: 89, close: 90 },
    ];
    const ema = [99, 98, 96, 95];
    expect(evaluateGussPullback(segment, ema, "up")).toEqual({ touched: true, clean: true });
  });

  it("markiert einen Pullback als nicht 'clean', wenn eine Kerze entgegen der Richtung schliesst", () => {
    const segment = [
      { open: 96, high: 100, low: 94, close: 97 },
      { open: 97, high: 98, low: 93, close: 94 },
      { open: 94, high: 99, low: 93, close: 98 }, // bullische Kerze im Aufwaertstrend-Pullback -> nicht clean
      { open: 98, high: 98, low: 89, close: 90 },
    ];
    const ema = [99, 98, 96, 95];
    expect(evaluateGussPullback(segment, ema, "up").clean).toBe(false);
  });

  it("liefert touched=null, wenn im ganzen Segment kein EMA-Wert bekannt ist", () => {
    const segment = [
      { open: 90, high: 100, low: 90, close: 95 },
      { open: 95, high: 95, low: 92, close: 93 },
    ];
    const ema = [null, null];
    expect(evaluateGussPullback(segment, ema, "up").touched).toBeNull();
  });

  it("erkennt Beruehrung im Abwaertstrend ueber den oberen Docht", () => {
    const segment = [
      { open: 100, high: 100, low: 90, close: 92 }, // Ursprungs-Swing-Tief (ausgenommen)
      { open: 92, high: 96, low: 91, close: 95 },
      { open: 95, high: 99, low: 94, close: 98 },
    ];
    const ema = [90, 94, 98];
    expect(evaluateGussPullback(segment, ema, "down")).toEqual({ touched: true, clean: true });
  });

  it("ist deterministisch fuer denselben Input", () => {
    const segment = [
      { open: 90, high: 100, low: 90, close: 95 },
      { open: 95, high: 95, low: 92, close: 93 },
    ];
    const ema = [98, 97];
    expect(evaluateGussPullback(segment, ema, "up")).toEqual(evaluateGussPullback(segment, ema, "up"));
  });
});

describe("bucketMinuteDeltas", () => {
  const candles1h = [
    { openTime: "2026-01-01T00:00:00.000Z", open: 0, high: 0, low: 0, close: 0 },
    { openTime: "2026-01-01T01:00:00.000Z", open: 0, high: 0, low: 0, close: 0 },
    { openTime: "2026-01-01T02:00:00.000Z", open: 0, high: 0, low: 0, close: 0 },
  ];

  it("summiert 2*taker_buy-volume je 1m-Zeile innerhalb der richtigen 1H-Bucket", () => {
    const minuteRows = [
      { open_time: "2026-01-01T00:05:00.000Z", volume: 10, taker_buy_base_vol: 6 }, // 2*6-10=2
      { open_time: "2026-01-01T00:45:00.000Z", volume: 5, taker_buy_base_vol: 1 }, // 2*1-5=-3
      { open_time: "2026-01-01T01:10:00.000Z", volume: 8, taker_buy_base_vol: 8 }, // 2*8-8=8
      { open_time: "2025-12-31T23:50:00.000Z", volume: 100, taker_buy_base_vol: 0 }, // ausserhalb Fenster
    ];
    expect(bucketMinuteDeltas(candles1h, minuteRows)).toEqual([-1, 8, 0]);
  });

  it("behandelt taker_buy_base_vol=null als 0 (volles Verkaufsdelta)", () => {
    const minuteRows = [{ open_time: "2026-01-01T00:05:00.000Z", volume: 10, taker_buy_base_vol: null }];
    expect(bucketMinuteDeltas(candles1h, minuteRows)).toEqual([-10, 0, 0]);
  });
});

describe("classifyCvdTrend", () => {
  it("liefert null, wenn zu wenig Historie fuer den Lookback vorliegt", () => {
    expect(classifyCvdTrend([1, 2, 3], [1, 3, 6], 5)).toBeNull();
  });

  it("erkennt 'rising' bei deutlichem positiven Nettozuwachs relativ zum Rauschen", () => {
    const delta = [0, 0, 0, 0, 0, 10, 10, 10, 10, 10];
    const cumulative = [0, 0, 0, 0, 0, 10, 20, 30, 40, 50];
    expect(classifyCvdTrend(delta, cumulative, 5)).toBe("rising");
  });

  it("erkennt 'falling' bei deutlichem negativen Nettozuwachs", () => {
    const delta = [0, 0, 0, 0, 0, -10, -10, -10, -10, -10];
    const cumulative = [0, 0, 0, 0, 0, -10, -20, -30, -40, -50];
    expect(classifyCvdTrend(delta, cumulative, 5)).toBe("falling");
  });

  it("erkennt 'flat', wenn sich Ausschlaege innerhalb des Lookback-Fensters aufheben", () => {
    const delta = [0, 0, 0, 0, 0, 100, -100, 100, -100, 0];
    const cumulative = [0, 0, 0, 0, 0, 100, 0, 100, 0, 0];
    expect(classifyCvdTrend(delta, cumulative, 5)).toBe("flat");
  });
});

describe("detectCvdDivergence", () => {
  it("erkennt eine baerische Divergenz (hoeheres Preis-Pivot-Hoch, tieferer CVD-Wert)", () => {
    const closeValues = [1, 2, 9, 2, 1, 2, 3, 2, 10, 2, 1];
    const candles = closeValues.map((close, i) => ({
      openTime: `2026-01-01T${String(i).padStart(2, "0")}:00:00.000Z`,
      open: close,
      high: close,
      low: close,
      close,
    }));
    const cumulative = [0, 0, 50, 0, 0, 0, 0, 0, 20, 0, 0];
    expect(detectCvdDivergence(candles, cumulative, 2)).toEqual({
      type: "bearish",
      atOpenTime: "2026-01-01T08:00:00.000Z",
    });
  });

  it("erkennt eine bullische Divergenz (tieferes Preis-Pivot-Tief, hoeherer CVD-Wert)", () => {
    const closeValues = [10, 9, 1, 9, 10, 9, 8, 9, 0, 9, 10];
    const candles = closeValues.map((close, i) => ({
      openTime: `2026-01-01T${String(i).padStart(2, "0")}:00:00.000Z`,
      open: close,
      high: close,
      low: close,
      close,
    }));
    const cumulative = [0, 0, 10, 0, 0, 0, 0, 0, 40, 0, 0];
    expect(detectCvdDivergence(candles, cumulative, 2)).toEqual({
      type: "bullish",
      atOpenTime: "2026-01-01T08:00:00.000Z",
    });
  });

  it("liefert null ohne erkennbare Pivots (monoton steigende Serie)", () => {
    const closeValues = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
    const candles = closeValues.map((close, i) => ({
      openTime: `2026-01-01T${String(i).padStart(2, "0")}:00:00.000Z`,
      open: close,
      high: close,
      low: close,
      close,
    }));
    const cumulative = closeValues.map((_, i) => i);
    expect(detectCvdDivergence(candles, cumulative, 2)).toBeNull();
  });
});
