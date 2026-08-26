export interface MarketSnapshot {
  id: number;
  timestamp_utc: string;
  symbol: string;
  exchange: string;
  last_price: number | null;
  mark_price: number | null;
  index_price: number | null;
  open_interest: number | null;
  open_interest_usd: number | null;
  funding_rate: number | null;
  next_funding_time_utc: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

// Rueckgabezeile der get_market_series-RPC (serverseitig heruntergesamplete
// Preis-/OI-Zeitreihe je Boerse, siehe lib/timeframes.ts).
export interface MarketSeriesPoint {
  timestamp_utc: string;
  last_price: number | null;
  open_interest: number | null;
}

export interface MarketCommentary {
  id: number;
  generated_at: string;
  symbol: string;
  summary_text: string;
  price_trend: string;
  funding_sentiment: string;
  oi_trend: string;
  price_change_pct: number | null;
  created_at: string;
}

export interface PositioningSnapshot {
  id: number;
  timestamp_utc: string;
  exchange: string;
  symbol: string;
  global_long_account_ratio: number | null;
  global_short_account_ratio: number | null;
  global_account_long_short_ratio: number | null;
  top_trader_long_account_ratio: number | null;
  top_trader_short_account_ratio: number | null;
  top_trader_account_long_short_ratio: number | null;
  top_trader_long_position_ratio: number | null;
  top_trader_short_position_ratio: number | null;
  top_trader_position_long_short_ratio: number | null;
  taker_buy_vol: number | null;
  taker_sell_vol: number | null;
  taker_buy_sell_ratio: number | null;
  status: string;
  error: string | null;
  created_at: string;
}

export interface PositioningSignal {
  id: number;
  timestamp_utc: string;
  signal_type: string;
  symbol: string;
  score: number | null;
  confidence: number | null;
  timeframe: string | null;
  explanation: string;
  supporting_metrics: Record<string, unknown> | null;
  created_at: string;
}

export interface LiquidationEvent {
  id: number;
  event_time_utc: string;
  exchange: string;
  symbol: string;
  side: "long" | "short" | "unknown";
  price: number | null;
  quantity: number | null;
  notional_usd: number | null;
  order_type: string | null;
  source_event_id: string | null;
  status: string;
  error: string | null;
  created_at: string;
}

// Rueckgabeform der get_liquidation_intelligence-RPC (Phase 2: Velocity,
// Preis-Cluster, Vergleich vs. aggregiertem Open Interest).
export interface LiquidationIntelligence {
  velocity: {
    bucket_start: string;
    event_count: number;
    notional_usd: number;
    long_notional: number | null;
    short_notional: number | null;
  }[];
  price_clusters: {
    price_bucket: number;
    notional_usd: number;
    event_count: number;
  }[];
  total_notional_usd: number;
  total_oi_usd: number | null;
}

// Rueckgabezeile der get_spot_pressure_series-RPC (Binance-Spot-BTC-Kerzen,
// 5-Min-Takt, siehe SpotPressurePanel.tsx).
export interface SpotPressurePoint {
  timestamp_utc: string;
  last_price: number | null;
  taker_buy_vol: number | null;
  taker_sell_vol: number | null;
}

// Rueckgabezeile der get_spot_pressure_summary-RPC: exakte Summe ueber ein
// Zeitfenster (nicht heruntergesamplet, im Gegensatz zu SpotPressurePoint).
export interface SpotPressureSummary {
  candle_count: number;
  sum_taker_buy_vol: number | null;
  sum_taker_sell_vol: number | null;
  sum_taker_buy_quote_vol: number | null;
  sum_taker_sell_quote_vol: number | null;
  first_price: number | null;
  last_price: number | null;
  latest_timestamp_utc: string;
}

// Rueckgabezeile der get_oi_change_by_exchange-RPC: OI-Change% je Boerse
// fuer denselben Zeitraum wie die uebrige Seite -- Basis fuer Exchange-
// Divergence (welche Boerse treibt eine Bewegung) und die "UNAVAILABLE"-
// Kennzeichnung bei Boersen ohne oeffentliche OI-Route.
export interface OiChangeByExchange {
  exchange: string;
  oi_change_pct: number | null;
  current_oi: number | null;
  reference_oi: number | null;
  reference_timestamp_utc: string | null;
  current_timestamp_utc: string | null;
  has_full_history: boolean;
}

// NEXUS AI Report Engine (Vorgabe Teil M-P). report_configs = bis zu 4
// vom Nutzer konfigurierte Report-Slots, report_runs = jede tatsaechliche
// Ausfuehrung samt der Datenbasis, die der KI vorlag (data_snapshot).
export type ReportType = "market_structure" | "positioning" | "news_macro" | "master";

export interface ReportConfig {
  id: number;
  slot: number;
  report_type: ReportType;
  provider: string;
  model: string | null;
  timeframe: string;
  schedule_time: string | null;
  active: boolean;
  email_enabled: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReportRun {
  id: number;
  report_config_id: number | null;
  report_type: ReportType;
  provider: string;
  model: string | null;
  timeframe: string;
  generated_at: string;
  status: "ok" | "error";
  result: Record<string, unknown> | null;
  data_snapshot: Record<string, unknown> | null;
  error: string | null;
  email_sent: boolean;
  created_at: string;
}

export interface EtfFlowDay {
  id: number;
  flow_date: string;
  total_flow_usd_m: number | null;
  source: string;
  created_at: string;
}

export interface NewsEvent {
  id: number;
  source_id: number | null;
  external_id: string | null;
  published_at: string;
  title: string;
  title_de: string | null;
  summary: string | null;
  url: string | null;
  category: string;
  market_direction: string;
  impact_score: number;
  confidence_score: number;
  relevance_score: number;
  btc_impact_score: number;
  horizon: string;
  is_market_moving: boolean;
  is_verified: boolean;
  raw_hash: string | null;
  created_at: string;
}
