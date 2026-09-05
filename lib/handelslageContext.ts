// Kontext-Builder fuer die Handelslage-KI-Kachel (Umsetzungsplan Phase 3,
// 05.09.2026) -- Konzept aus server/handelslage.js im Crypto-Trading-
// Journal: eine kurze, guenstige "was halten die naechsten Stunden bereit"-
// Einschaetzung, bewusst unterschieden von der grossen taeglichen AI-Report-
// Engine (lib/reportContext.ts) und von der Gesamteinschaetzung (14-Faktoren-
// Score, "wo stehen wir im Zyklus").
//
// Kernkennzahl: Bewegungsvorrat -- die heutige Tagesspanne relativ zum
// MEDIAN (nicht Mittelwert, ein einzelner Crash-Tag soll den Massstab
// nicht dauerhaft verzerren) der letzten 10 abgeschlossenen Tage. Ein Markt,
// der bereits 200% seines ueblichen Tagespensums bewegt hat, ist kein guter
// Fortsetzungskandidat, wie sauber der Trend auch aussieht.
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

import { supabase } from "./supabase";
import type { MarketState } from "./types";

const SYMBOL = "BTCUSDT";
// Dieselbe Rohdatenquelle wie compute-market-state (Faktoren basieren auf
// Binance-Kerzen) -- kein "aggregated" (das ist eine Pseudo-Boerse nur fuer
// die get_market_series-RPC, existiert nicht in der candles-Tabelle).
const EXCHANGE = "binance";
const LOOKBACK_DAYS = 10;

interface DailyCandleRow {
  open_time: string;
  high: number;
  low: number;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface HandelslageContext {
  generated_at: string;
  bewegungsvorrat: {
    today_range_usd: number | null;
    median_range_10d_usd: number | null;
    /** heutige Spanne / Median * 100 -- >100 heisst ueberdurchschnittlich viel Bewegung bereits verbraucht. */
    ratio_pct: number | null;
  };
  factors: MarketState["factors"] | null;
  overall_state: MarketState["overall_state"] | null;
  confidence: number | null;
  risk_level: MarketState["risk_level"] | null;
  patterns: MarketState["patterns"] | null;
}

export async function buildHandelslageContext(): Promise<HandelslageContext> {
  const { data: candleRows } = await supabase
    .from("candles")
    .select("open_time, high, low")
    .eq("exchange", EXCHANGE)
    .eq("symbol", SYMBOL)
    .eq("interval", "1d")
    .order("open_time", { ascending: false })
    .limit(LOOKBACK_DAYS + 1);

  const rows = (candleRows ?? []) as DailyCandleRow[];
  const [today, ...previousDays] = rows;
  const todayRange = today ? today.high - today.low : null;
  const priorRanges = previousDays.map((c) => c.high - c.low);
  const medianRange = median(priorRanges);
  const ratioPct =
    todayRange !== null && medianRange !== null && medianRange > 0
      ? Math.round((todayRange / medianRange) * 1000) / 10
      : null;

  const { data: stateRows } = await supabase
    .from("market_states")
    .select("factors, overall_state, confidence, risk_level, patterns")
    .order("timestamp_utc", { ascending: false })
    .limit(1);
  const state = stateRows?.[0] as
    | Pick<MarketState, "factors" | "overall_state" | "confidence" | "risk_level" | "patterns">
    | undefined;

  return {
    generated_at: new Date().toISOString(),
    bewegungsvorrat: {
      today_range_usd: todayRange,
      median_range_10d_usd: medianRange,
      ratio_pct: ratioPct,
    },
    factors: state?.factors ?? null,
    overall_state: state?.overall_state ?? null,
    confidence: state?.confidence ?? null,
    risk_level: state?.risk_level ?? null,
    patterns: state?.patterns ?? null,
  };
}
