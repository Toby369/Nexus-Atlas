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
