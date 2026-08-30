import type { TradingViewSignal } from "./types";

// Phase 2 TradingView-Integration: reine Anzeige-/Frische-Logik fuer das
// Kontext-Badge in RegimeMatrixCard.tsx. Getrennt von der Webhook-
// Empfangslogik (siehe lib/webhookTradingView.ts) -- hier nur, wie ein
// bereits gespeichertes Signal im Dashboard dargestellt wird. Rein
// informativ: beeinflusst weder Score noch Confidence noch Regime der
// 14-Faktoren-Engine (siehe compute-market-state, unveraendert).

// Wie lange ein Signal als "frisch" gilt, bevor es nicht mehr als aktueller
// Kontext angezeigt wird (Vorgabe: "z. B. der letzten 24 Stunden").
export const TRADINGVIEW_SIGNAL_FRESHNESS_HOURS = 24;

// "BULLISH_BREAKOUT" -> "Bullish Breakout". Kein hartcodiertes Mapping
// bekannter Signal-Typen -- TradingView-Alerts koennen beliebige
// Freitext-Codes senden (Pine-Script-Nutzer definiert signal_type selbst),
// eine feste Liste wuerde neue/unbekannte Typen stillschweigend falsch
// oder gar nicht anzeigen.
export function formatSignalType(raw: string): string {
  return raw
    .toLowerCase()
    .split("_")
    .filter((word) => word.length > 0)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

// Exakter Badge-Text wie in der Aufgabenstellung vorgegeben: "TradingView
// Context: Bullish Breakout [1H]". Ohne Zeitrahmen (timeframe ist optional
// in tradingview_signals) wird die Klammer einfach weggelassen, statt eine
// erfundene Angabe zu zeigen.
export function formatSignalBadge(
  signal: Pick<TradingViewSignal, "signal_type" | "timeframe">
): string {
  const label = formatSignalType(signal.signal_type);
  return signal.timeframe ? `TradingView Context: ${label} [${signal.timeframe}]` : `TradingView Context: ${label}`;
}

// Dieselbe "keine Daten statt veralteter Wert"-Philosophie wie
// isFreshCandle() in compute-market-state: ageMs < 0 (Client-/Server-Uhr-
// Versatz, Signal "aus der Zukunft") gilt ebenfalls als nicht frisch, statt
// stillschweigend akzeptiert zu werden.
export function isSignalFresh(receivedAtIso: string, nowMs: number = Date.now()): boolean {
  const ageMs = nowMs - new Date(receivedAtIso).getTime();
  return ageMs >= 0 && ageMs <= TRADINGVIEW_SIGNAL_FRESHNESS_HOURS * 60 * 60 * 1000;
}
