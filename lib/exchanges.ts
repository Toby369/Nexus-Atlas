// Boersen-Auswahl fuer die OI-Change/Preis-OI-Chart-Sektion (siehe
// lib/timeframes.ts fuer das analoge Zeitraum-Pendant). "aggregated" ist ein
// Pseudo-Wert: die get_market_series/get_market_reference_snapshot-RPCs
// summieren dafuer serverseitig das Open Interest ueber alle Boersen mit
// status='ok', der Preis kommt von Bybit als Referenz. Bitunix ist bewusst
// ausgeschlossen, da diese Boerse oeffentlich kein Open Interest liefert
// (Selector waere sonst immer "—").

export type SeriesExchangeId =
  | "aggregated"
  | "bybit"
  | "binance"
  | "okx"
  | "bitget"
  | "pionex"
  | "hyperliquid"
  | "deribit";

export interface SeriesExchangeOption {
  id: SeriesExchangeId;
  label: string;
  /**
   * Seit 26.11.2026 neu in der Summe. get_market_series zaehlt eine Boerse
   * erst, wenn sie zu Fensterbeginn Daten hat (kein OI-Sprung). Die
   * Konsistenz-Pruefung in lib/marketContext.ts laesst sie deshalb aus.
   */
  addedLater?: boolean;
}

export const SERIES_EXCHANGES: SeriesExchangeOption[] = [
  { id: "aggregated", label: "Aggregiert" },
  { id: "bybit", label: "Bybit" },
  { id: "binance", label: "Binance" },
  { id: "okx", label: "OKX" },
  { id: "bitget", label: "Bitget" },
  { id: "pionex", label: "Pionex" },
  { id: "hyperliquid", label: "Hyperliquid", addedLater: true },
  { id: "deribit", label: "Deribit", addedLater: true },
];

export const DEFAULT_SERIES_EXCHANGE: SeriesExchangeId = "aggregated";

export function getSeriesExchange(id: SeriesExchangeId): SeriesExchangeOption {
  const ex = SERIES_EXCHANGES.find((e) => e.id === id);
  if (!ex) throw new Error(`Unbekannte Boerse: ${id}`);
  return ex;
}
