-- Exportiert aus supabase_migrations.schema_migrations (20260826080614 create_candles_and_market_features)

-- Phase 1 der Market-Intelligence-Erweiterung: Data Layer (candles, rohe
-- OHLCV-Kerzen) und Analysis Layer (market_features, daraus berechnete
-- Indikatoren) sauber getrennt (Vorgabe Punkt 26/31) -- eine zukuenftige
-- zweite Kerzenquelle koennte dieselbe candles-Tabelle befuellen, ein
-- zukuenftiger Konsument koennte market_features direkt lesen, ohne
-- Indikatoren neu herzuleiten.

create table public.candles (
  id bigint generated always as identity primary key,
  exchange text not null default 'binance',
  symbol text not null default 'BTCUSDT',
  interval text not null check (interval in ('1h','4h','1d')),
  open_time timestamptz not null,
  close_time timestamptz not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null,
  quote_volume numeric,
  taker_buy_base_vol numeric,
  taker_buy_quote_vol numeric,
  trade_count integer,
  created_at timestamptz not null default now(),
  unique (exchange, symbol, interval, open_time)
);
create index idx_candles_lookup on public.candles (exchange, symbol, interval, open_time desc);
alter table public.candles enable row level security;
create policy "Public read access" on public.candles for select using (true);

create table public.market_features (
  id bigint generated always as identity primary key,
  symbol text not null default 'BTCUSDT',
  interval text not null check (interval in ('1h','4h','1d')),
  -- open_time der juengsten Kerze, auf der diese Berechnung basiert.
  candle_open_time timestamptz not null,
  computed_at timestamptz not null default now(),
  close_price numeric,

  -- Trend / Moving Averages
  ema_20 numeric,
  ema_50 numeric,
  ema_200 numeric,

  -- Momentum (Bestaetigungsfaktoren, siehe Vorgabe Punkt 4 -- nie isoliert
  -- als Signal verwendet, sondern Teil der spaeteren Market-State-Engine)
  rsi_14 numeric,
  macd_line numeric,
  macd_signal numeric,
  macd_histogram numeric,

  -- Volatilitaet / Trendstaerke
  atr_14 numeric,
  adx_14 numeric,
  plus_di numeric,
  minus_di numeric,

  -- VWAP: rollierend ueber die geladene Kerzenhistorie (keine Session-VWAP
  -- wie bei Aktien, da BTC 24/7 ohne Handelsschluss notiert).
  vwap numeric,

  -- Market Structure (Swing-basiert, Lookback konfigurierbar im Code)
  swing_type text check (swing_type in ('HH','HL','LH','LL')),
  structure_trend text check (structure_trend in ('bullish','bearish','ranging')),
  bos boolean not null default false,
  bos_direction text check (bos_direction in ('bullish','bearish')),
  choch boolean not null default false,
  choch_direction text check (choch_direction in ('bullish','bearish')),

  -- Futures-Orderflow (CVD). cvd_cumulative ist NICHT seit Symbol-Start
  -- kumuliert, sondern ueber die im jeweiligen Lauf geladene Historie
  -- (siehe candle_count) -- fuer Trend-/Divergenzerkennung ausreichend,
  -- als Trend/Richtung zu verstehen, nicht als absolute Grösse.
  cvd_delta numeric,
  cvd_cumulative numeric,
  cvd_trend text check (cvd_trend in ('rising','falling','flat')),

  -- OI Intelligence (wiederverwendet die bestehende, bereits fuer den
  -- Coverage-Bug reparierte get_market_reference_snapshot-RPC als einzige
  -- Quelle der Wahrheit fuer "aggregiertes OI zu Zeitpunkt X").
  oi_current numeric,
  oi_delta_pct numeric,
  oi_volume_ratio numeric,

  -- Basis (Spot vs. Futures)
  spot_price numeric,
  basis_pct numeric,

  -- Data Quality (Vorgabe Punkt 20)
  candle_count integer not null default 0,
  data_quality text not null check (data_quality in ('OK','PRELIMINARY','INSUFFICIENT')),

  created_at timestamptz not null default now(),
  unique (symbol, interval, candle_open_time)
);
create index idx_market_features_lookup on public.market_features (symbol, interval, candle_open_time desc);
alter table public.market_features enable row level security;
create policy "Public read access" on public.market_features for select using (true);
