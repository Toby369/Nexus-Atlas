import { describe, expect, it } from "vitest";
import {
  HOUR_MS,
  anchoredVwapSeries,
  buildLageSeries,
  computeSince,
  fundingAt,
  mergeCandleRows,
  monthStartMs,
  onlyClosed,
  weekStartMs,
  type LageInputCandle,
  type LageKey,
  type LageState,
} from "./lageChart";

const utc = (y: number, m: number, d: number, h = 0) => Date.UTC(y, m - 1, d, h);

describe("Anker", () => {
  it("Woche beginnt am Montag 00:00 UTC", () => {
    // Mittwoch 11.11.2026 14:00 -> Montag 9.11.2026
    expect(weekStartMs(utc(2026, 11, 11, 14))).toBe(utc(2026, 11, 9));
    // Montag selbst
    expect(weekStartMs(utc(2026, 11, 9, 0))).toBe(utc(2026, 11, 9));
    // Sonntag 23:00 gehoert noch zur alten Woche
    expect(weekStartMs(utc(2026, 11, 8, 23))).toBe(utc(2026, 11, 2));
  });

  it("Monat beginnt am 1. 00:00 UTC", () => {
    expect(monthStartMs(utc(2026, 11, 11, 14))).toBe(utc(2026, 11, 1));
    expect(monthStartMs(utc(2026, 12, 31, 23))).toBe(utc(2026, 12, 1));
  });
});

describe("anchoredVwapSeries", () => {
  const c = (t: number, price: number, volume: number) => ({ t, high: price, low: price, close: price, volume });

  it("rechnet kumulativ ab dem Anker und setzt am Montag neu an", () => {
    const rows = anchoredVwapSeries([
      c(utc(2026, 11, 8, 22), 100, 1), // Sonntag
      c(utc(2026, 11, 8, 23), 200, 1), // Sonntag
      c(utc(2026, 11, 9, 0), 300, 1), // Montag: neue Woche
      c(utc(2026, 11, 9, 1), 500, 3),
    ]);
    expect(rows[1].week).toBe(150);
    expect(rows[2].week).toBe(300);
    expect(rows[3].week).toBe((300 * 1 + 500 * 3) / 4);
    expect(rows[2].weekAnchor).not.toBe(rows[1].weekAnchor);
    // Monatsanker bleibt im November gleich
    expect(rows[3].month).toBe((100 + 200 + 300 + 1500) / 6);
  });

  it("setzt den Monats-VWAP am 1. neu an", () => {
    const rows = anchoredVwapSeries([c(utc(2026, 10, 31, 23), 100, 1), c(utc(2026, 11, 1, 0), 400, 2)]);
    expect(rows[1].month).toBe(400);
    expect(rows[1].monthAnchor).toBe(utc(2026, 11, 1));
  });

  it("liefert null ohne Volumen", () => {
    expect(anchoredVwapSeries([c(utc(2026, 11, 9, 0), 100, 0)])[0].week).toBeNull();
  });
});

describe("fundingAt", () => {
  const samples = [
    { t: 1000, rate: 0.0001 },
    { t: 2000, rate: 0.0002 },
  ];
  it("nimmt den letzten Wert bis zum Zeitpunkt und rechnet in Prozent um", () => {
    expect(fundingAt(samples, 1500)).toBeCloseTo(0.01, 10);
    expect(fundingAt(samples, 5000)).toBeCloseTo(0.02, 10);
  });
  it("gibt null vor dem ersten Wert zurueck", () => {
    expect(fundingAt(samples, 500)).toBeNull();
  });
});

describe("computeSince", () => {
  const st = (label: string): Record<LageKey, LageState> => {
    const s: LageState = { kind: "flat", label, why: "" };
    return { trend: s, flow: s, fund: s, risk: s };
  };
  it("zaehlt gleiche Zustaende und merkt sich den vorherigen", () => {
    const since = computeSince([st("Range"), st("Range"), st("Bullisch"), st("Bullisch"), st("Bullisch")]);
    expect(since[1].trend).toEqual({ candles: 2, prev: null });
    expect(since[2].trend).toEqual({ candles: 1, prev: "Range" });
    expect(since[4].trend).toEqual({ candles: 3, prev: "Range" });
  });
});

describe("mergeCandleRows / onlyClosed", () => {
  it("fuehrt Features ueber die Kerzenzeit zusammen und erkennt CHoCH vor BOS", () => {
    const merged = mergeCandleRows(
      [{ open_time: "2026-11-11T09:00:00+00:00", open: "1", high: "3", low: "0.5", close: "2", volume: "10" }],
      [
        {
          candle_open_time: "2026-11-11T09:00:00+00:00",
          ema_20: "1.5",
          ema_50: null,
          ema_200: null,
          rsi_14: null,
          adx_14: 25,
          atr_14: null,
          cvd_delta: -5,
          cvd_cumulative: -100,
          oi_delta_pct: 0.1,
          basis_pct: null,
          bos: true,
          bos_direction: "bullish",
          choch: true,
          choch_direction: "bearish",
        },
      ]
    );
    expect(merged[0].ema20).toBe(1.5);
    expect(merged[0].ema50).toBeNull();
    expect(merged[0].structure).toEqual({ type: "CHoCH", dir: -1 });
  });

  it("verwirft die noch laufende Kerze", () => {
    const now = utc(2026, 11, 11, 10) + 30 * 60 * 1000;
    const rows = [{ t: utc(2026, 11, 11, 9) }, { t: utc(2026, 11, 11, 10) }];
    expect(onlyClosed(rows, 1, now)).toEqual([rows[0]]);
  });
});

describe("buildLageSeries", () => {
  const candle = (i: number, over: Partial<LageInputCandle> = {}): LageInputCandle => ({
    t: utc(2026, 11, 9, 0) + i * HOUR_MS,
    open: 100,
    high: 101,
    low: 99,
    close: 100,
    volume: 10,
    ema20: 101,
    ema50: 99.5,
    ema200: 95,
    rsi: 55,
    adx: 30,
    atr: 1,
    cvdDelta: 1,
    cvdCum: i,
    oiDeltaPct: 0.1,
    basisPct: 0.02,
    funding: null,
    structure: null,
    ...over,
  });

  it("liefert Zustand, Funding und VWAP je Kerze und kuerzt auf keep", () => {
    const candles = Array.from({ length: 30 }, (_, i) => candle(i, { cvdCum: i * 10, cvdDelta: 10 }));
    const hourly = candles.map((c) => ({ t: c.t, high: c.high, low: c.low, close: c.close, volume: c.volume }));
    const s = buildLageSeries({
      interval: "1h",
      candles,
      hourly,
      funding: [{ t: candles[0].t, rate: 0.0006 }],
      events: [],
      keep: 10,
    });
    expect(s.points).toHaveLength(10);
    const last = s.points[s.points.length - 1];
    expect(last.states.trend.kind).toBe("bull");
    expect(last.states.flow.kind).toBe("bull");
    expect(last.states.fund.label).toBe("Überhitzt (Long)"); // 0.06 % > 0.045 %
    expect(last.wvwap).toBeCloseTo(100, 6);
    expect(last.mvwap).toBeCloseTo(100, 6);
  });

  it("markiert Funding ueber 0.045 % als ueberhitzt und ueber 0.025 % als long-lastig", () => {
    const candles = Array.from({ length: 10 }, (_, i) => candle(i));
    const hourly = candles.map((c) => ({ t: c.t, high: c.high, low: c.low, close: c.close, volume: c.volume }));
    const hot = buildLageSeries({ interval: "1h", candles, hourly, funding: [{ t: 0, rate: 0.0006 }], events: [], keep: 10 });
    expect(hot.points[9].states.fund.kind).toBe("hot");
    const warn = buildLageSeries({ interval: "1h", candles, hourly, funding: [{ t: 0, rate: 0.0003 }], events: [], keep: 10 });
    expect(warn.points[9].states.fund.label).toBe("Long-lastig");
  });

  it("zeigt Range bei ADX unter 20 und Vorsicht vor einem Termin", () => {
    const candles = Array.from({ length: 10 }, (_, i) => candle(i, { adx: 15 }));
    const hourly = candles.map((c) => ({ t: c.t, high: c.high, low: c.low, close: c.close, volume: c.volume }));
    const eventT = candles[9].t + 3 * HOUR_MS;
    const s = buildLageSeries({
      interval: "1h",
      candles,
      hourly,
      funding: [],
      events: [{ t: eventT, label: "FOMC" }],
      keep: 10,
    });
    const last = s.points[9];
    expect(last.states.trend.label).toBe("Range");
    expect(last.states.fund.label).toBe("Keine Daten");
    expect(last.states.risk.kind).toBe("warn");
    expect(last.states.risk.why).toContain("FOMC in 2 h");
  });

  it("unterbricht die VWAP-Linie am Wochenwechsel", () => {
    const start = utc(2026, 11, 8, 22);
    const candles = Array.from({ length: 6 }, (_, i) => ({ ...candle(0), t: start + i * HOUR_MS }));
    const hourly = candles.map((c) => ({ t: c.t, high: c.high, low: c.low, close: c.close, volume: c.volume }));
    const s = buildLageSeries({ interval: "1h", candles, hourly, funding: [], events: [], keep: 6 });
    expect(s.points.map((p) => p.wBreak)).toEqual([false, false, true, false, false, false]);
    expect(s.points.every((p) => !p.mBreak)).toBe(true);
  });

  it("nimmt bei 4h die VWAP der letzten enthaltenen Stunde", () => {
    const t0 = utc(2026, 11, 9, 0);
    const hourly = Array.from({ length: 8 }, (_, i) => ({
      t: t0 + i * HOUR_MS,
      high: 100 + i,
      low: 100 + i,
      close: 100 + i,
      volume: 1,
    }));
    const candles = [candle(0, { t: t0 }), candle(0, { t: t0 + 4 * HOUR_MS })];
    const s = buildLageSeries({ interval: "4h", candles, hourly, funding: [], events: [], keep: 2 });
    // Erste 4h-Kerze: Mittel aus 100..103 = 101.5, zweite: Mittel aus 100..107 = 103.5
    expect(s.points[0].wvwap).toBeCloseTo(101.5, 6);
    expect(s.points[1].wvwap).toBeCloseTo(103.5, 6);
  });
});
