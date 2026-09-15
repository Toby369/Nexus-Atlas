import { supabase } from "./supabase";
import type { MarketState } from "./types";

// Live-Kopplung fuer die "Mein Trading System"-Checkliste (Nutzer-Wunsch
// 15.09.2026: "meine trading regeln/Setup in nexus integrieren", Umsetzungs-
// Entscheidung 4: Funding/OI-Delta kommen 1:1 aus dem neuesten market_states-
// Eintrag, kein neuer Request/keine neue Datenquelle noetig).
//
// EMA13 wird bewusst NICHT als neue Spalte in market_features/compute-
// market-state ergaenzt (siehe Entscheidung 3 im Umsetzungsplan) -- Tobys
// persoenliches EMA-Framework (13/50/200) ist unabhaengig von NEXUS'
// produktivem Trend-Regime (reines EMA50/200), jede Aenderung an der Live-
// Scoring-Engine haette hier ein eigenes Backtesting-Protokoll verdient wie
// beim Regime-/Setup-Score. Stattdessen: EMA13 wird bei jedem Aufruf frisch
// aus den ohnehin vorhandenen 1h-Kerzen berechnet, rein fuer die Anzeige.

const EMA13_PERIOD = 13;
// Genug Kerzen fuer eine seed-SMA + einige Nachlauf-Perioden, damit sich der
// EMA-Wert vom SMA-Seed geloest hat (Daumenregel: >= 3x Periode).
const EMA13_LOOKBACK_CANDLES = 60;

export interface MeinSystemChecklistData {
  fundingRatePct: number | null;
  fundingUnderThreshold: boolean | null;
  oiDeltaPct: number | null;
  oiPriceDirection: -1 | 0 | 1 | null;
  ema13: number | null;
  ema50: number | null;
  ema200: number | null;
  closePrice: number | null;
  dataAsOf: string | null;
}

// Gleicher Schwellenwert wie FUNDING_EXTREME_THRESHOLD in compute-market-
// state (0.0005 = 0,05%) -- Tobys eigene Checkliste nutzt denselben Wert
// (siehe knowledge_base 'mein_system'/'Rally-Nachhaltigkeit').
const FUNDING_THRESHOLD_PCT = 0.05;

export function computeEma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const seed = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const multiplier = 2 / (period + 1);
  let ema = seed;
  for (let i = period; i < closes.length; i++) {
    ema = (closes[i] - ema) * multiplier + ema;
  }
  return ema;
}

async function getEma13(): Promise<number | null> {
  const { data, error } = await supabase
    .from("candles")
    .select("close, open_time")
    .eq("exchange", "binance")
    .eq("symbol", "BTCUSDT")
    .eq("interval", "1h")
    .order("open_time", { ascending: false })
    .limit(EMA13_LOOKBACK_CANDLES);

  if (error || !data || data.length < EMA13_PERIOD) {
    if (error) console.error("meinSystemContext: Fehler beim Laden der Kerzen fuer EMA13:", error.message);
    return null;
  }

  const closesChronological = data
    .slice()
    .reverse()
    .map((row) => Number(row.close))
    .filter((v) => Number.isFinite(v));

  return computeEma(closesChronological, EMA13_PERIOD);
}

export async function getMeinSystemChecklistData(): Promise<MeinSystemChecklistData> {
  const [{ data: stateRows, error: stateError }, ema13] = await Promise.all([
    supabase.from("market_states").select("*").order("timestamp_utc", { ascending: false }).limit(1),
    getEma13(),
  ]);

  if (stateError) {
    console.error("meinSystemContext: Fehler beim Laden des Market State:", stateError.message);
  }

  const state = (stateRows?.[0] ?? null) as MarketState | null;
  const fundingBasis = state?.factors?.funding?.basis as Record<string, unknown> | undefined;
  const oiPriceFactor = state?.factors?.oi_price;
  const oiPriceBasis = oiPriceFactor?.basis as Record<string, unknown> | undefined;
  const trendRegimeBasis = state?.factors?.trend_regime?.basis as Record<string, unknown> | undefined;

  const rawFundingRate =
    typeof fundingBasis?.avg_current_rate === "number" ? fundingBasis.avg_current_rate : null;
  const fundingRatePct = rawFundingRate !== null ? rawFundingRate * 100 : null;

  const oiDeltaPct = typeof oiPriceBasis?.oi_delta_pct === "number" ? oiPriceBasis.oi_delta_pct : null;
  const closePrice = typeof trendRegimeBasis?.close_price === "number" ? trendRegimeBasis.close_price : null;
  const ema50 = typeof trendRegimeBasis?.ema_50 === "number" ? trendRegimeBasis.ema_50 : null;
  const ema200 = typeof trendRegimeBasis?.ema_200 === "number" ? trendRegimeBasis.ema_200 : null;

  return {
    fundingRatePct,
    fundingUnderThreshold: fundingRatePct !== null ? Math.abs(fundingRatePct) < FUNDING_THRESHOLD_PCT : null,
    oiDeltaPct,
    oiPriceDirection: oiPriceFactor?.value ?? null,
    ema13,
    ema50,
    ema200,
    closePrice,
    dataAsOf: state?.timestamp_utc ?? null,
  };
}
