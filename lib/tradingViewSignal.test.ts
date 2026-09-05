import { describe, it, expect } from "vitest";
import {
  TRADINGVIEW_SIGNAL_FRESHNESS_HOURS,
  formatSignalType,
  formatSignalBadge,
  isSignalFresh,
  inferSignalDirection,
} from "./tradingViewSignal";

describe("formatSignalType", () => {
  it("formatiert SCREAMING_SNAKE_CASE als Titel-Case mit Leerzeichen", () => {
    expect(formatSignalType("BULLISH_BREAKOUT")).toBe("Bullish Breakout");
  });

  it("funktioniert mit einem einzelnen Wort ohne Unterstrich", () => {
    expect(formatSignalType("BREAKOUT")).toBe("Breakout");
  });

  it("funktioniert mit bereits gemischter Gross-/Kleinschreibung", () => {
    expect(formatSignalType("rsi_Divergence")).toBe("Rsi Divergence");
  });

  it("ignoriert doppelte/fuehrende/folgende Unterstriche statt leere Woerter zu erzeugen", () => {
    expect(formatSignalType("_RSI__DIVERGENCE_")).toBe("Rsi Divergence");
  });
});

describe("formatSignalBadge", () => {
  it("formatiert exakt wie vorgegeben: 'TradingView Context: Bullish Breakout [1H]'", () => {
    expect(formatSignalBadge({ signal_type: "BULLISH_BREAKOUT", timeframe: "1H" })).toBe(
      "TradingView Context: Bullish Breakout [1H]"
    );
  });

  it("laesst die Klammer weg, wenn kein Zeitrahmen vorliegt (kein erfundener Wert)", () => {
    expect(formatSignalBadge({ signal_type: "RSI_DIVERGENCE", timeframe: null })).toBe(
      "TradingView Context: Rsi Divergence"
    );
  });
});

describe("isSignalFresh", () => {
  const now = new Date("2026-08-30T12:00:00.000Z").getTime();

  it("ist frisch direkt beim Empfang", () => {
    expect(isSignalFresh(new Date(now).toISOString(), now)).toBe(true);
  });

  it("ist frisch kurz vor der 24h-Grenze", () => {
    const receivedAt = new Date(now - (TRADINGVIEW_SIGNAL_FRESHNESS_HOURS * 60 * 60 * 1000 - 1)).toISOString();
    expect(isSignalFresh(receivedAt, now)).toBe(true);
  });

  it("ist nicht mehr frisch kurz nach der 24h-Grenze", () => {
    const receivedAt = new Date(now - (TRADINGVIEW_SIGNAL_FRESHNESS_HOURS * 60 * 60 * 1000 + 1)).toISOString();
    expect(isSignalFresh(receivedAt, now)).toBe(false);
  });

  it("ist nicht frisch, wenn der Zeitstempel (Uhr-Versatz) in der Zukunft liegt", () => {
    const receivedAt = new Date(now + 60_000).toISOString();
    expect(isSignalFresh(receivedAt, now)).toBe(false);
  });
});

describe("inferSignalDirection", () => {
  it("erkennt explizite BULLISH/BEARISH-Typen", () => {
    expect(inferSignalDirection("FAIR_VALUE_GAP_BULLISH")).toBe("bullish");
    expect(inferSignalDirection("ORDER_BLOCK_BEARISH")).toBe("bearish");
    expect(inferSignalDirection("RSI_BULLISH_DIVERGENCE")).toBe("bullish");
    expect(inferSignalDirection("MACD_BEARISH_DIVERGENCE")).toBe("bearish");
  });

  it("erkennt die _BULL/_BEAR-Kurzform", () => {
    expect(inferSignalDirection("VOLUME_EXPANSION_BULL")).toBe("bullish");
    expect(inferSignalDirection("VOLUME_EXPANSION_BEAR")).toBe("bearish");
    expect(inferSignalDirection("SQUEEZE_RELEASE_BULL")).toBe("bullish");
    expect(inferSignalDirection("SQUEEZE_RELEASE_BEAR")).toBe("bearish");
  });

  it("liest LIQUIDITY_SWEEP_LOW/HIGH als Reversal-Hinweis (Sweep tief = bullisch, hoch = baerisch)", () => {
    expect(inferSignalDirection("LIQUIDITY_SWEEP_LOW")).toBe("bullish");
    expect(inferSignalDirection("LIQUIDITY_SWEEP_HIGH")).toBe("bearish");
  });

  it("liest VWAP_STRETCH_LO/HI ebenso als Erschoepfungs-Reversal", () => {
    expect(inferSignalDirection("VWAP_STRETCH_LO")).toBe("bullish");
    expect(inferSignalDirection("VWAP_STRETCH_HI")).toBe("bearish");
  });

  it("liefert null statt einer geratenen Richtung fuer unbekannte Typen", () => {
    expect(inferSignalDirection("SOME_FUTURE_SIGNAL")).toBeNull();
  });

  it("ist gross-/kleinschreibungs-unabhaengig", () => {
    expect(inferSignalDirection("fair_value_gap_bullish")).toBe("bullish");
  });
});
