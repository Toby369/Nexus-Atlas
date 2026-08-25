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
  | "pionex";

export interface SeriesExchangeOption {
  id: SeriesExchangeId;
  label: string;
}

export const SERIES_EXCHANGES: SeriesExchangeOption[] = [
  { id: "aggregated", label: "Aggregiert" },
  { id: "bybit", label: "Bybit" },
  { id: "binance", label: "Binance" },
  { id: "okx", label: "OKX" },
  { id: "bitget", label: "Bitget" },
  { id: "pionex", label: "Pionex" },
];

export const DEFAULT_SERIES_EXCHANGE: SeriesExchangeId = "aggregated";

export function getSeriesExchange(id: SeriesExchangeId): SeriesExchangeOption {
  const ex = SERIES_EXCHANGES.find((e) => e.id === id);
  if (!ex) throw new Error(`Unbekannte Boerse: ${id}`);
  return ex;
}
