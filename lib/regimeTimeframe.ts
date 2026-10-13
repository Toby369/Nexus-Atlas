import { supabase } from "./supabase";
import type { MarketStateMatrix } from "./types";
import type { TimeframeId } from "./timeframes";

// Marktphase je Zeitrahmen: die Kachel folgt der Zeitraum-Auswahl oben.
// 1h liegt persistiert in market_state_matrix (Cron refresh-market-state-
// matrix-every-15-min, lesen dort auch Briefing/Scores/Push). Die uebrigen
// Kerzen-Intervalle rechnet compute_market_state_matrix_latest live aus den
// letzten 400 Kerzen -- gleiche Formeln, nichts zusaetzlich gespeichert
// (siehe docs/research/MARKTPHASE-ZEITRAHMEN_2026-10-13.md).

// 15M zeigt bewusst 1H (Entscheid Toby 13.10.2026): auf 15m-Kerzen schlaegt
// die fuer Stundenkerzen gewaehlte Schwelle zu oft um.
export type RegimeInterval = "1h" | "4h" | "1d" | "1w";

const INTERVAL_BY_TIMEFRAME: Record<TimeframeId, RegimeInterval> = {
  "15M": "1h",
  "1H": "1h",
  "4H": "4h",
  "24H": "1d",
  "1W": "1w",
  "1M": "1w",
};

export const REGIME_INTERVAL_LABEL: Record<RegimeInterval, string> = {
  "1h": "1H",
  "4h": "4H",
  "1d": "1D",
  "1w": "1W",
};

export function regimeIntervalFor(timeframe: TimeframeId): RegimeInterval {
  return INTERVAL_BY_TIMEFRAME[timeframe];
}

export async function fetchRegimeMatrix(
  interval: RegimeInterval
): Promise<{ data: MarketStateMatrix | null; ok: boolean }> {
  if (interval === "1h") {
    const { data, error } = await supabase
      .from("market_state_matrix")
      .select("*")
      .eq("symbol", "BTCUSDT")
      .eq("interval", "1h")
      .order("timestamp_utc", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      console.error("Fehler beim Laden der Market State Matrix:", error.message);
      return { data: null, ok: false };
    }
    return { data, ok: true };
  }

  const { data, error } = await supabase.rpc("compute_market_state_matrix_latest", {
    p_symbol: "BTCUSDT",
    p_interval: interval,
    p_exchange: "binance",
  });
  if (error) {
    console.error(`Fehler beim Berechnen der Marktphase (${interval}):`, error.message);
    return { data: null, ok: false };
  }
  const row = (data as Omit<MarketStateMatrix, "id" | "symbol" | "interval" | "created_at">[] | null)?.[0];
  return {
    data: row ? { ...row, id: 0, symbol: "BTCUSDT", interval, created_at: row.timestamp_utc } : null,
    ok: true,
  };
}
