// Kontext-Builder fuer die Trade-Debate-Kachel (Nutzer-Idee 07.09.2026,
// nach TradingAgents-Architektur [arXiv:2412.20138] recherchiert und
// optimiert): zwei gegensaetzlich geprompte KI-Analysten (Bull/Bear) +
// ein Referee/CIO bekommen GENAU DIESEN einen strukturierten Kontext --
// niemals einen Chart als Bild (siehe Recherche 07.09.2026: strukturierte,
// vorab berechnete Zahlen statt Bild-Interpretation reduziert Halluzination
// nachweislich). Alle Werte kommen aus bereits bestehenden RPCs/Tabellen,
// keine Neuberechnung/zweite Definition bestehender Kennzahlen.
//
// Server-only (nutzt Supabase direkt) -- niemals aus einer "use client"
// Komponente importieren.

import { supabase } from "./supabase";
import type { MarketState } from "./types";

const SYMBOL = "BTCUSDT";
type Timeframe = "1h" | "4h" | "1d";

// Dieselben Lookback-/Bucket-Werte wie LiquidationPanel.tsx bzw.
// compute-market-state -- keine zweite, abweichende Kalibrierung derselben
// Kennzahlen.
const LIQUIDATION_LOOKBACK_HOURS = 6;
const LIQUIDATION_BUCKET_MINUTES = 15;
const LIQUIDATION_PRICE_BUCKET_USD = 200;
const FUNDING_LOOKBACK_HOURS = 24;

interface FeatureRow {
  candle_open_time: string;
  close_price: number | null;
  ema_20: number | null;
  ema_50: number | null;
  ema_100: number | null;
  ema_200: number | null;
  ema_800: number | null;
  rsi_14: number | null;
  adx_14: number | null;
  atr_14: number | null;
  vwap: number | null;
  structure_trend: string | null;
  swing_type: string | null;
  oi_current: number | null;
  oi_delta_pct: number | null;
  basis_pct: number | null;
}

export interface TradeDebateTimeframeSnapshot {
  candle_open_time: string;
  close_price: number | null;
  ema_20: number | null;
  ema_50: number | null;
  ema_100: number | null;
  ema_200: number | null;
  // Community-/Nischen-Heuristik, KEIN etablierter institutioneller
  // Standard wie EMA20/50/200 (siehe Recherche 07.09.2026) -- absichtlich
  // trotzdem mitgegeben, da vom Nutzer explizit gewuenscht.
  ema_800: number | null;
  rsi_14: number | null;
  adx_14: number | null;
  atr_14: number | null;
  // Rollierender 20-Perioden-VWAP (siehe market_features/collect-candles) --
  // eigenstaendig vom Weekly/Monthly/Swing-VWAP unten.
  vwap_rolling_20: number | null;
  structure_trend: string | null;
}

export interface TradeDebateContext {
  generated_at: string;
  symbol: string;
  current_price: number | null;
  timeframes: Record<Timeframe, TradeDebateTimeframeSnapshot | null>;
  derivatives: {
    oi_current: number | null;
    oi_delta_pct: number | null;
    basis_pct: number | null;
    funding: {
      avg_current_rate: number | null;
      avg_delta: number | null;
      cross_exchange_spread: number | null;
      exchange_count: number | null;
    } | null;
  };
  // Rohe Rueckgabe von get_pivot_points()/get_anchored_vwap_summary() --
  // bewusst ungetypt durchgereicht (reine, bereits validierte Zahlen-JSON
  // aus der DB, keine zusaetzliche Typebene noetig).
  pivots: unknown;
  anchored_vwap: unknown;
  liquidation_clusters: unknown;
  market_state: {
    overall_state: MarketState["overall_state"] | null;
    confidence: number | null;
    risk_level: MarketState["risk_level"] | null;
    patterns: MarketState["patterns"] | null;
  };
}

async function fetchLatestFeatureRow(interval: Timeframe): Promise<FeatureRow | null> {
  const { data, error } = await supabase
    .from("market_features")
    .select(
      "candle_open_time, close_price, ema_20, ema_50, ema_100, ema_200, ema_800, rsi_14, adx_14, atr_14, vwap, structure_trend, swing_type, oi_current, oi_delta_pct, basis_pct"
    )
    .eq("symbol", SYMBOL)
    .eq("interval", interval)
    .order("candle_open_time", { ascending: false })
    .limit(1);
  if (error) {
    console.error(`tradeDebateContext: Fehler bei market_features (${interval}):`, error.message);
    return null;
  }
  return (data?.[0] as FeatureRow | undefined) ?? null;
}

function toSnapshot(row: FeatureRow | null): TradeDebateTimeframeSnapshot | null {
  if (!row) return null;
  return {
    candle_open_time: row.candle_open_time,
    close_price: row.close_price,
    ema_20: row.ema_20,
    ema_50: row.ema_50,
    ema_100: row.ema_100,
    ema_200: row.ema_200,
    ema_800: row.ema_800,
    rsi_14: row.rsi_14,
    adx_14: row.adx_14,
    atr_14: row.atr_14,
    vwap_rolling_20: row.vwap,
    structure_trend: row.structure_trend,
  };
}

/**
 * Liefert null, wenn noch keine 1h-market_features-Zeile existiert (der
 * primaere, fuer den aktuellen Preis massgebliche Timeframe) -- dann gibt
 * es keine belastbare Grundlage fuer eine Analyse.
 */
export async function buildTradeDebateContext(): Promise<TradeDebateContext | null> {
  const [row1h, row4h, row1d, pivotsRes, vwapRes, fundingRes, liqRes, stateRes] = await Promise.all([
    fetchLatestFeatureRow("1h"),
    fetchLatestFeatureRow("4h"),
    fetchLatestFeatureRow("1d"),
    supabase.rpc("get_pivot_points"),
    supabase.rpc("get_anchored_vwap_summary"),
    supabase.rpc("get_funding_intelligence", { p_lookback_hours: FUNDING_LOOKBACK_HOURS }),
    supabase.rpc("get_liquidation_intelligence", {
      p_since: new Date(Date.now() - LIQUIDATION_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString(),
      p_bucket_minutes: LIQUIDATION_BUCKET_MINUTES,
      p_price_bucket_usd: LIQUIDATION_PRICE_BUCKET_USD,
    }),
    supabase
      .from("market_states")
      .select("overall_state, confidence, risk_level, patterns")
      .order("timestamp_utc", { ascending: false })
      .limit(1),
  ]);

  if (!row1h) return null;

  const state = stateRes.data?.[0] as
    | Pick<MarketState, "overall_state" | "confidence" | "risk_level" | "patterns">
    | undefined;

  return {
    generated_at: new Date().toISOString(),
    symbol: SYMBOL,
    current_price: row1h.close_price,
    timeframes: {
      "1h": toSnapshot(row1h),
      "4h": toSnapshot(row4h),
      "1d": toSnapshot(row1d),
    },
    derivatives: {
      oi_current: row1h.oi_current,
      oi_delta_pct: row1h.oi_delta_pct,
      basis_pct: row1h.basis_pct,
      funding: fundingRes.data ?? null,
    },
    pivots: pivotsRes.data ?? null,
    anchored_vwap: vwapRes.data ?? null,
    liquidation_clusters:
      liqRes.data && typeof liqRes.data === "object" && "price_clusters" in liqRes.data
        ? (liqRes.data as { price_clusters: unknown }).price_clusters
        : null,
    market_state: {
      overall_state: state?.overall_state ?? null,
      confidence: state?.confidence ?? null,
      risk_level: state?.risk_level ?? null,
      patterns: state?.patterns ?? null,
    },
  };
}

