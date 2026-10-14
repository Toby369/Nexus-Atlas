import { describe, it, expect, vi } from "vitest";

vi.mock("./supabase", () => ({ supabase: {} }));

import { detectOscillatorDivergences, formatDivergence } from "./oscillatorDivergence";

// Baut eine Serie mit zwei klaren Hochs (Index 10 und 30) bzw. Tiefs; ausserhalb
// davon flach, damit findPivots (Lookback 5) genau diese Punkte findet.
function series(
  closes: Record<number, number>,
  rsi: Record<number, number>,
  base: number,
  length = 40
) {
  return Array.from({ length }, (_, i) => ({
    openTime: `t${i}`,
    close: closes[i] ?? base + (i % 2) * 0.01,
    rsi: rsi[i] ?? 50,
    macdHist: null,
  }));
}

describe("detectOscillatorDivergences", () => {
  it("erkennt eine klassische bärische RSI-Divergenz (Preis HH, RSI LH)", () => {
    const s = series({ 10: 110, 30: 120 }, { 10: 70, 30: 60 }, 100);
    const [d] = detectOscillatorDivergences("4h", s);
    expect(d).toMatchObject({ oscillator: "RSI", direction: "bearish", kind: "klassisch", atOpenTime: "t30" });
    expect(formatDivergence(d)).toBe("4H RSI klassisch bärisch");
  });

  it("erkennt eine versteckte bullische Divergenz (Preis HL, RSI LL)", () => {
    const s = series({ 10: 90, 30: 95 }, { 10: 35, 30: 30 }, 100);
    const [d] = detectOscillatorDivergences("1d", s);
    expect(d).toMatchObject({ direction: "bullish", kind: "versteckt" });
  });

  it("meldet nichts, wenn Preis und RSI gleich laufen", () => {
    const s = series({ 10: 110, 30: 120 }, { 10: 60, 30: 70 }, 100);
    expect(detectOscillatorDivergences("1h", s)).toEqual([]);
  });

  it("ignoriert alte Divergenzen (juengeres Pivot mehr als 15 Kerzen her)", () => {
    const s = series({ 5: 110, 15: 120 }, { 5: 70, 15: 60 }, 100, 40);
    expect(detectOscillatorDivergences("1h", s)).toEqual([]);
  });
});
