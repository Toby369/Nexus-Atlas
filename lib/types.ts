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
