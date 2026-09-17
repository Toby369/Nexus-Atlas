import { describe, expect, it } from "vitest";
import { evaluateGussPullback } from "./tradingIndicatorsContext";

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
