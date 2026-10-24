-- Tabellen/Views im Schema public, rekonstruiert aus dem Katalog (Referenz, kein Ersatz für die Migrationen)

create table public.candles (
  id bigint generated always as identity not null,
  exchange text default 'binance'::text not null,
  symbol text default 'BTCUSDT'::text not null,
  interval text not null,
  open_time timestamp with time zone not null,
  close_time timestamp with time zone not null,
  open numeric not null,
  high numeric not null,
  low numeric not null,
  close numeric not null,
  volume numeric not null,
  quote_volume numeric,
  taker_buy_base_vol numeric,
  taker_buy_quote_vol numeric,
  trade_count integer,
  created_at timestamp with time zone default now() not null,
  constraint candles_exchange_symbol_interval_open_time_key UNIQUE (exchange, symbol, "interval", open_time),
  constraint candles_interval_check CHECK (("interval" = ANY (ARRAY['1m'::text, '5m'::text, '15m'::text, '1h'::text, '4h'::text, '1d'::text, '1w'::text]))),
  constraint candles_pkey PRIMARY KEY (id)
);
alter table public.candles enable row level security;
CREATE UNIQUE INDEX candles_exchange_symbol_interval_open_time_key ON public.candles USING btree (exchange, symbol, "interval", open_time);
create policy "Public read access" on public.candles as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.checklist_runs (
  id bigint generated always as identity not null,
  module text not null,
  checked_items text[] default '{}'::text[] not null,
  checked_count integer not null,
  total_count integer not null,
  created_at timestamp with time zone default now() not null,
  constraint checklist_runs_module_check CHECK ((module = ANY (ARRAY['welz'::text, 'salomon'::text, 'mein_system'::text, 'orderflow'::text]))),
  constraint checklist_runs_pkey PRIMARY KEY (id)
);
alter table public.checklist_runs enable row level security;
CREATE INDEX checklist_runs_module_created_at_idx ON public.checklist_runs USING btree (module, created_at DESC);
create policy "Public read access" on public.checklist_runs as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.data_quality (
  id bigint generated always as identity not null,
  source text not null,
  metric text not null,
  symbol text,
  last_success_at timestamp with time zone,
  data_timestamp timestamp with time zone,
  expected_update_interval_seconds integer not null,
  status text not null,
  request_status text,
  missing_value_rate numeric,
  validation_status text,
  historical_observation_count integer,
  error_count integer default 0 not null,
  fallback_source text,
  quality_score numeric(5,2),
  updated_at timestamp with time zone default now() not null,
  constraint data_quality_missing_value_rate_check CHECK (((missing_value_rate IS NULL) OR ((missing_value_rate >= (0)::numeric) AND (missing_value_rate <= (1)::numeric)))),
  constraint data_quality_pkey PRIMARY KEY (id),
  constraint data_quality_quality_score_check CHECK (((quality_score IS NULL) OR ((quality_score >= (0)::numeric) AND (quality_score <= (100)::numeric)))),
  constraint data_quality_source_metric_symbol_key UNIQUE (source, metric, symbol),
  constraint data_quality_status_check CHECK ((status = ANY (ARRAY['LIVE'::text, 'VALIDATED'::text, 'DEGRADED'::text, 'STALE'::text, 'ERROR'::text, 'UNKNOWN'::text]))),
  constraint data_quality_validation_status_check CHECK ((validation_status = ANY (ARRAY['passed'::text, 'failed'::text, 'not_applicable'::text])))
);
alter table public.data_quality enable row level security;
CREATE UNIQUE INDEX data_quality_source_metric_symbol_key ON public.data_quality USING btree (source, metric, symbol);
create policy "Public read access" on public.data_quality as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.divergence_radar_snapshots (
  id bigint generated always as identity not null,
  snapshotted_at timestamp with time zone default now() not null,
  price numeric,
  overall_state text,
  options_vs_sentiment text not null,
  spot_vs_futures text not null,
  spot_pressure_vs_price text not null,
  cycle_vs_momentum text not null,
  cycle_band_label text,
  handelslage_vs_state text not null,
  handelslage_bias text,
  tradingview_vs_state text not null,
  tv_direction text,
  rsi_divergence_vs_trend text not null,
  rsi_macd_divergence_direction text,
  onchain_vs_price text not null,
  created_at timestamp with time zone default now() not null,
  spot_pressure_vs_orderbook text,
  constraint divergence_radar_snapshots_pkey PRIMARY KEY (id)
);
alter table public.divergence_radar_snapshots enable row level security;
CREATE INDEX divergence_radar_snapshots_snapshotted_at_idx ON public.divergence_radar_snapshots USING btree (snapshotted_at);
create policy "Public read access" on public.divergence_radar_snapshots as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.economic_calendar_events (
  event_key text not null,
  label text not null,
  event_date date not null,
  typical_time_et text,
  source text not null,
  updated_at timestamp with time zone default now() not null,
  constraint economic_calendar_events_pkey PRIMARY KEY (event_key)
);
alter table public.economic_calendar_events enable row level security;
create policy "Public read access" on public.economic_calendar_events as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.economic_event_results (
  event_key text not null,
  event_date date not null,
  bias text not null,
  summary text not null,
  headlines jsonb default '[]'::jsonb not null,
  provider text,
  model text,
  created_at timestamp with time zone default now() not null,
  constraint economic_event_results_bias_check CHECK ((bias = ANY (ARRAY['bullish'::text, 'bearish'::text, 'neutral'::text]))),
  constraint economic_event_results_pkey PRIMARY KEY (event_key, event_date)
);
alter table public.economic_event_results enable row level security;
create policy "Public read access" on public.economic_event_results as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.escalation_snapshots (
  id bigint generated always as identity not null,
  generated_at timestamp with time zone default now() not null,
  trigger_reasons jsonb not null,
  reads jsonb default '[]'::jsonb not null,
  failed_providers jsonb default '[]'::jsonb not null,
  consensus text,
  status text not null,
  error text,
  constraint escalation_snapshots_consensus_check CHECK ((consensus = ANY (ARRAY['AGREEMENT'::text, 'DIVERGENCE'::text, 'INCONCLUSIVE'::text]))),
  constraint escalation_snapshots_pkey PRIMARY KEY (id),
  constraint escalation_snapshots_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'error'::text])))
);
alter table public.escalation_snapshots enable row level security;
create policy "Public read access" on public.escalation_snapshots as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.etf_flows (
  id bigint generated always as identity not null,
  flow_date date not null,
  total_flow_usd_m numeric,
  source text default 'farside'::text not null,
  created_at timestamp with time zone default now() not null,
  constraint etf_flows_pkey PRIMARY KEY (id)
);
alter table public.etf_flows enable row level security;
CREATE UNIQUE INDEX idx_etf_flows_date_source ON public.etf_flows USING btree (flow_date, source);
CREATE INDEX idx_etf_flows_date ON public.etf_flows USING btree (flow_date DESC);
create policy "Public read access" on public.etf_flows as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.knowledge_base (
  id bigint generated always as identity not null,
  module text not null,
  section text not null,
  title text not null,
  content text not null,
  source text,
  sort_order integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  constraint knowledge_base_module_check CHECK ((module = ANY (ARRAY['welz'::text, 'salomon'::text, 'mein_system'::text]))),
  constraint knowledge_base_pkey PRIMARY KEY (id)
);
alter table public.knowledge_base enable row level security;
create policy "Public read access" on public.knowledge_base as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.liquidation_events (
  id bigint generated by default as identity not null,
  event_time_utc timestamp with time zone not null,
  exchange text not null,
  symbol text not null,
  side text not null,
  price numeric,
  quantity numeric,
  notional_usd numeric,
  order_type text,
  source_event_id text,
  status text default 'ok'::text not null,
  error text,
  created_at timestamp with time zone default now() not null,
  constraint liquidation_events_pkey PRIMARY KEY (id),
  constraint liquidation_events_side_check CHECK ((side = ANY (ARRAY['long'::text, 'short'::text, 'unknown'::text]))),
  constraint liquidation_events_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'error'::text])))
);
alter table public.liquidation_events enable row level security;
CREATE INDEX idx_liquidation_events_time ON public.liquidation_events USING btree (event_time_utc DESC);
CREATE INDEX idx_liquidation_events_exchange_symbol ON public.liquidation_events USING btree (exchange, symbol, event_time_utc DESC);
CREATE UNIQUE INDEX idx_liquidation_events_exchange_source_event ON public.liquidation_events USING btree (exchange, source_event_id);
create policy "Public read access" on public.liquidation_events as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.macro_snapshots (
  id bigint generated always as identity not null,
  timestamp_utc timestamp with time zone not null,
  symbol text not null,
  label text not null,
  last_price numeric,
  prev_close numeric,
  change_pct numeric,
  market_time_utc timestamp with time zone,
  status text default 'ok'::text not null,
  error text,
  created_at timestamp with time zone default now() not null,
  constraint macro_snapshots_pkey PRIMARY KEY (id),
  constraint macro_snapshots_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'error'::text])))
);
alter table public.macro_snapshots enable row level security;
CREATE INDEX idx_macro_snapshots_lookup ON public.macro_snapshots USING btree (symbol, timestamp_utc DESC);
create policy "Public read access" on public.macro_snapshots as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.market_features (
  id bigint generated always as identity not null,
  symbol text default 'BTCUSDT'::text not null,
  interval text not null,
  candle_open_time timestamp with time zone not null,
  computed_at timestamp with time zone default now() not null,
  close_price numeric,
  ema_20 numeric,
  ema_50 numeric,
  ema_200 numeric,
  rsi_14 numeric,
  macd_line numeric,
  macd_signal numeric,
  macd_histogram numeric,
  atr_14 numeric,
  adx_14 numeric,
  plus_di numeric,
  minus_di numeric,
  vwap numeric,
  swing_type text,
  structure_trend text,
  bos boolean default false not null,
  bos_direction text,
  choch boolean default false not null,
  choch_direction text,
  cvd_delta numeric,
  cvd_cumulative numeric,
  cvd_trend text,
  oi_current numeric,
  oi_delta_pct numeric,
  oi_volume_ratio numeric,
  spot_price numeric,
  basis_pct numeric,
  candle_count integer default 0 not null,
  data_quality text not null,
  created_at timestamp with time zone default now() not null,
  range_high_20 numeric,
  range_low_20 numeric,
  ema_100 double precision,
  ema_800 double precision,
  constraint market_features_bos_direction_check CHECK ((bos_direction = ANY (ARRAY['bullish'::text, 'bearish'::text]))),
  constraint market_features_choch_direction_check CHECK ((choch_direction = ANY (ARRAY['bullish'::text, 'bearish'::text]))),
  constraint market_features_cvd_trend_check CHECK ((cvd_trend = ANY (ARRAY['rising'::text, 'falling'::text, 'flat'::text]))),
  constraint market_features_data_quality_check CHECK ((data_quality = ANY (ARRAY['OK'::text, 'PRELIMINARY'::text, 'INSUFFICIENT'::text]))),
  constraint market_features_interval_check CHECK (("interval" = ANY (ARRAY['15m'::text, '1h'::text, '4h'::text, '1d'::text, '1w'::text]))),
  constraint market_features_pkey PRIMARY KEY (id),
  constraint market_features_structure_trend_check CHECK ((structure_trend = ANY (ARRAY['bullish'::text, 'bearish'::text, 'ranging'::text]))),
  constraint market_features_swing_type_check CHECK ((swing_type = ANY (ARRAY['HH'::text, 'HL'::text, 'LH'::text, 'LL'::text]))),
  constraint market_features_symbol_interval_candle_open_time_key UNIQUE (symbol, "interval", candle_open_time)
);
alter table public.market_features enable row level security;
CREATE UNIQUE INDEX market_features_symbol_interval_candle_open_time_key ON public.market_features USING btree (symbol, "interval", candle_open_time);
create policy "Public read access" on public.market_features as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.market_snapshots (
  id bigint generated by default as identity not null,
  timestamp_utc timestamp with time zone not null,
  symbol text not null,
  exchange text not null,
  last_price numeric,
  mark_price numeric,
  index_price numeric,
  open_interest numeric,
  open_interest_usd numeric,
  funding_rate numeric,
  next_funding_time_utc timestamp with time zone,
  status text not null,
  error text,
  created_at timestamp with time zone default now() not null,
  constraint market_snapshots_pkey PRIMARY KEY (id)
);
alter table public.market_snapshots enable row level security;
CREATE INDEX idx_market_snapshots_time ON public.market_snapshots USING btree (timestamp_utc DESC);
CREATE INDEX idx_market_snapshots_exchange_symbol ON public.market_snapshots USING btree (exchange, symbol, timestamp_utc DESC);
CREATE INDEX idx_market_snapshots_created_at ON public.market_snapshots USING btree (created_at DESC);
create policy "Public read access" on public.market_snapshots as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.market_state_matrix (
  id bigint generated always as identity not null,
  timestamp_utc timestamp with time zone not null,
  symbol text default 'BTCUSDT'::text not null,
  interval text default '1h'::text not null,
  adx_14 numeric,
  plus_di numeric,
  minus_di numeric,
  linreg_slope numeric,
  linreg_r2 numeric,
  garman_klass_vol numeric,
  bb_width numeric,
  bb_percent_b numeric,
  atr_ratio numeric,
  rsi_14 numeric,
  dist_zscore_sma20 numeric,
  dist_zscore_sma50 numeric,
  dist_zscore_sma200 numeric,
  funding_zscore numeric,
  price_change_pct numeric,
  oi_change_pct numeric,
  oi_price_quadrant text,
  cvd_zscore numeric,
  liq_cluster_density numeric,
  net_taker_flow_ratio numeric,
  regime text not null,
  data_coverage_pct numeric,
  created_at timestamp with time zone default now() not null,
  constraint market_state_matrix_pkey PRIMARY KEY (id),
  constraint market_state_matrix_timestamp_utc_symbol_interval_key UNIQUE (timestamp_utc, symbol, "interval")
);
alter table public.market_state_matrix enable row level security;
CREATE UNIQUE INDEX market_state_matrix_timestamp_utc_symbol_interval_key ON public.market_state_matrix USING btree (timestamp_utc, symbol, "interval");
CREATE INDEX idx_market_state_matrix_timestamp ON public.market_state_matrix USING btree (timestamp_utc DESC);
CREATE INDEX idx_market_state_matrix_regime ON public.market_state_matrix USING btree (regime);
create policy "Public read access" on public.market_state_matrix as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.market_states (
  id bigint generated always as identity not null,
  timestamp_utc timestamp with time zone not null,
  overall_state text not null,
  score numeric,
  confidence numeric not null,
  data_coverage_pct numeric not null,
  factors jsonb not null,
  patterns jsonb default '[]'::jsonb not null,
  created_at timestamp with time zone default now() not null,
  mtf_alignment jsonb,
  risk_level text,
  risk_factors jsonb default '[]'::jsonb,
  constraint market_states_confidence_check CHECK (((confidence >= (0)::numeric) AND (confidence <= (100)::numeric))),
  constraint market_states_data_coverage_pct_check CHECK (((data_coverage_pct >= (0)::numeric) AND (data_coverage_pct <= (100)::numeric))),
  constraint market_states_overall_state_check CHECK ((overall_state = ANY (ARRAY['BULLISH'::text, 'BEARISH'::text, 'NEUTRAL'::text, 'MIXED'::text, 'INSUFFICIENT_DATA'::text]))),
  constraint market_states_pkey PRIMARY KEY (id),
  constraint market_states_risk_level_check CHECK ((risk_level = ANY (ARRAY['LOW'::text, 'MEDIUM'::text, 'HIGH'::text, 'UNKNOWN'::text])))
);
alter table public.market_states enable row level security;
CREATE INDEX idx_market_states_lookup ON public.market_states USING btree (timestamp_utc DESC);
create policy "Public read access" on public.market_states as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.news_events (
  id bigint generated by default as identity not null,
  source_id bigint,
  external_id text,
  published_at timestamp with time zone not null,
  title text not null,
  summary text,
  url text,
  category text not null,
  market_direction text default 'neutral'::text not null,
  impact_score smallint default 0 not null,
  confidence_score smallint default 0 not null,
  relevance_score smallint default 0 not null,
  btc_impact_score smallint default 0 not null,
  horizon text default 'intraday'::text not null,
  is_market_moving boolean default false not null,
  is_verified boolean default false not null,
  raw_hash text,
  created_at timestamp with time zone default now() not null,
  title_de text,
  constraint news_events_btc_impact_score_check CHECK (((btc_impact_score >= '-100'::integer) AND (btc_impact_score <= 100))),
  constraint news_events_category_check CHECK ((category = ANY (ARRAY['fed'::text, 'treasury'::text, 'cpi'::text, 'macro'::text, 'etf'::text, 'regulation'::text, 'geopolitics'::text, 'crypto'::text, 'market_structure'::text, 'other'::text]))),
  constraint news_events_confidence_score_check CHECK (((confidence_score >= 0) AND (confidence_score <= 100))),
  constraint news_events_horizon_check CHECK ((horizon = ANY (ARRAY['intraday'::text, 'short_term'::text, 'medium_term'::text]))),
  constraint news_events_impact_score_check CHECK (((impact_score >= 0) AND (impact_score <= 100))),
  constraint news_events_market_direction_check CHECK ((market_direction = ANY (ARRAY['bullish'::text, 'bearish'::text, 'neutral'::text, 'mixed'::text]))),
  constraint news_events_pkey PRIMARY KEY (id),
  constraint news_events_relevance_score_check CHECK (((relevance_score >= 0) AND (relevance_score <= 100))),
  constraint news_events_source_id_external_id_key UNIQUE (source_id, external_id),
  constraint news_events_source_id_fkey FOREIGN KEY (source_id) REFERENCES public.news_sources(id) ON DELETE SET NULL
);
alter table public.news_events enable row level security;
CREATE UNIQUE INDEX news_events_source_id_external_id_key ON public.news_events USING btree (source_id, external_id);
CREATE INDEX idx_news_events_published_at ON public.news_events USING btree (published_at DESC);
CREATE INDEX idx_news_events_market_moving ON public.news_events USING btree (is_market_moving, published_at DESC);
CREATE INDEX idx_news_events_category ON public.news_events USING btree (category, published_at DESC);
create policy "Public read access" on public.news_events as permissive for select to public using (true);
create policy "public can read market moving news" on public.news_events as permissive for select to anon, authenticated using ((is_market_moving = true));
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.news_sources (
  id bigint generated by default as identity not null,
  name text not null,
  source_type text not null,
  base_reliability numeric(4,3) default 0.800 not null,
  url text,
  enabled boolean default true not null,
  created_at timestamp with time zone default now() not null,
  constraint news_sources_base_reliability_check CHECK (((base_reliability >= (0)::numeric) AND (base_reliability <= (1)::numeric))),
  constraint news_sources_name_key UNIQUE (name),
  constraint news_sources_pkey PRIMARY KEY (id),
  constraint news_sources_source_type_check CHECK ((source_type = ANY (ARRAY['primary'::text, 'wire'::text, 'crypto'::text, 'research'::text])))
);
alter table public.news_sources enable row level security;
CREATE UNIQUE INDEX news_sources_name_key ON public.news_sources USING btree (name);
create policy "Public read access" on public.news_sources as permissive for select to public using (true);
create policy "public can read enabled news sources" on public.news_sources as permissive for select to anon, authenticated using ((enabled = true));
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.news_warning_pushes_sent (
  warning_id text not null,
  mark_id text not null,
  event_date date not null,
  sent_at timestamp with time zone default now() not null,
  constraint news_warning_pushes_sent_pkey PRIMARY KEY (warning_id, mark_id, event_date)
);
alter table public.news_warning_pushes_sent enable row level security;
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.onchain_snapshots (
  id bigint generated always as identity not null,
  timestamp_utc timestamp with time zone not null,
  metric text not null,
  label text not null,
  value numeric,
  prev_value numeric,
  change_pct numeric,
  observation_date date,
  status text default 'ok'::text not null,
  error text,
  created_at timestamp with time zone default now() not null,
  constraint onchain_snapshots_pkey PRIMARY KEY (id),
  constraint onchain_snapshots_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'error'::text])))
);
alter table public.onchain_snapshots enable row level security;
create policy "Public read access" on public.onchain_snapshots as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.options_snapshots (
  id bigint generated always as identity not null,
  timestamp_utc timestamp with time zone not null,
  currency text default 'BTC'::text not null,
  near_expiry text,
  near_expiry_days numeric,
  underlying_price numeric,
  atm_iv numeric,
  skew_proxy numeric,
  put_call_oi_ratio numeric,
  max_pain_strike numeric,
  total_oi_calls_btc numeric,
  total_oi_puts_btc numeric,
  instrument_count integer,
  status text default 'ok'::text not null,
  error text,
  created_at timestamp with time zone default now() not null,
  iv_30d numeric,
  skew_30d numeric,
  expiries_30d text,
  constraint options_snapshots_pkey PRIMARY KEY (id),
  constraint options_snapshots_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'error'::text])))
);
alter table public.options_snapshots enable row level security;
CREATE INDEX idx_options_snapshots_lookup ON public.options_snapshots USING btree (currency, timestamp_utc DESC);
create policy "Public read access" on public.options_snapshots as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.orderbook_snapshots (
  id bigint generated always as identity not null,
  timestamp_utc timestamp with time zone not null,
  exchange text not null,
  symbol text default 'BTCUSDT'::text not null,
  best_bid numeric,
  best_ask numeric,
  mid_price numeric,
  spread_abs numeric,
  spread_pct numeric,
  bid_depth_usd numeric,
  ask_depth_usd numeric,
  depth_imbalance numeric,
  bid_wall_price numeric,
  bid_wall_usd numeric,
  ask_wall_price numeric,
  ask_wall_usd numeric,
  status text default 'ok'::text not null,
  error text,
  created_at timestamp with time zone default now() not null,
  constraint orderbook_snapshots_pkey PRIMARY KEY (id),
  constraint orderbook_snapshots_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'error'::text])))
);
alter table public.orderbook_snapshots enable row level security;
CREATE INDEX idx_orderbook_snapshots_lookup ON public.orderbook_snapshots USING btree (exchange, symbol, timestamp_utc DESC);
create policy "Public read access" on public.orderbook_snapshots as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create view public.pg_all_foreign_keys as
 SELECT n1.nspname AS fk_schema_name,
    c1.relname AS fk_table_name,
    k1.conname AS fk_constraint_name,
    c1.oid AS fk_table_oid,
    public._pg_sv_column_array(k1.conrelid, k1.conkey) AS fk_columns,
    n2.nspname AS pk_schema_name,
    c2.relname AS pk_table_name,
    k2.conname AS pk_constraint_name,
    c2.oid AS pk_table_oid,
    ci.relname AS pk_index_name,
    public._pg_sv_column_array(k1.confrelid, k1.confkey) AS pk_columns,
        CASE k1.confmatchtype
            WHEN 'f'::"char" THEN 'FULL'::text
            WHEN 'p'::"char" THEN 'PARTIAL'::text
            WHEN 'u'::"char" THEN 'NONE'::text
            ELSE NULL::text
        END AS match_type,
        CASE k1.confdeltype
            WHEN 'a'::"char" THEN 'NO ACTION'::text
            WHEN 'c'::"char" THEN 'CASCADE'::text
            WHEN 'd'::"char" THEN 'SET DEFAULT'::text
            WHEN 'n'::"char" THEN 'SET NULL'::text
            WHEN 'r'::"char" THEN 'RESTRICT'::text
            ELSE NULL::text
        END AS on_delete,
        CASE k1.confupdtype
            WHEN 'a'::"char" THEN 'NO ACTION'::text
            WHEN 'c'::"char" THEN 'CASCADE'::text
            WHEN 'd'::"char" THEN 'SET DEFAULT'::text
            WHEN 'n'::"char" THEN 'SET NULL'::text
            WHEN 'r'::"char" THEN 'RESTRICT'::text
            ELSE NULL::text
        END AS on_update,
    k1.condeferrable AS is_deferrable,
    k1.condeferred AS is_deferred
   FROM ((((((((pg_constraint k1
     JOIN pg_namespace n1 ON ((n1.oid = k1.connamespace)))
     JOIN pg_class c1 ON ((c1.oid = k1.conrelid)))
     JOIN pg_class c2 ON ((c2.oid = k1.confrelid)))
     JOIN pg_namespace n2 ON ((n2.oid = c2.relnamespace)))
     JOIN pg_depend d ON (((d.classid = ('pg_constraint'::regclass)::oid) AND (d.objid = k1.oid) AND (d.objsubid = 0) AND (d.deptype = 'n'::"char") AND (d.refclassid = ('pg_class'::regclass)::oid) AND (d.refobjsubid = 0))))
     JOIN pg_class ci ON (((ci.oid = d.refobjid) AND (ci.relkind = 'i'::"char"))))
     LEFT JOIN pg_depend d2 ON (((d2.classid = ('pg_class'::regclass)::oid) AND (d2.objid = ci.oid) AND (d2.objsubid = 0) AND (d2.deptype = 'i'::"char") AND (d2.refclassid = ('pg_constraint'::regclass)::oid) AND (d2.refobjsubid = 0))))
     LEFT JOIN pg_constraint k2 ON (((k2.oid = d2.refobjid) AND (k2.contype = ANY (ARRAY['p'::"char", 'u'::"char"])))))
  WHERE ((k1.conrelid <> (0)::oid) AND (k1.confrelid <> (0)::oid) AND (k1.contype = 'f'::"char") AND public._pg_sv_table_accessible(n1.oid, c1.oid));

create table public.positioning_signals (
  id bigint generated always as identity not null,
  timestamp_utc timestamp with time zone not null,
  signal_type text not null,
  symbol text not null,
  score numeric,
  confidence numeric,
  timeframe text,
  explanation text not null,
  supporting_metrics jsonb,
  created_at timestamp with time zone default now() not null,
  constraint positioning_signals_pkey PRIMARY KEY (id)
);
alter table public.positioning_signals enable row level security;
CREATE INDEX positioning_signals_time_idx ON public.positioning_signals USING btree (timestamp_utc DESC);
create policy "Public read access" on public.positioning_signals as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.positioning_snapshots (
  id bigint generated always as identity not null,
  timestamp_utc timestamp with time zone not null,
  exchange text not null,
  symbol text not null,
  global_long_account_ratio numeric,
  global_short_account_ratio numeric,
  global_account_long_short_ratio numeric,
  top_trader_long_account_ratio numeric,
  top_trader_short_account_ratio numeric,
  top_trader_account_long_short_ratio numeric,
  top_trader_long_position_ratio numeric,
  top_trader_short_position_ratio numeric,
  top_trader_position_long_short_ratio numeric,
  taker_buy_vol numeric,
  taker_sell_vol numeric,
  taker_buy_sell_ratio numeric,
  status text not null,
  error text,
  created_at timestamp with time zone default now() not null,
  constraint positioning_snapshots_pkey PRIMARY KEY (id)
);
alter table public.positioning_snapshots enable row level security;
CREATE INDEX positioning_snapshots_exchange_time_idx ON public.positioning_snapshots USING btree (exchange, timestamp_utc DESC);
create policy "Public read access" on public.positioning_snapshots as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.push_messages (
  id uuid default gen_random_uuid() not null,
  created_at timestamp with time zone default now() not null,
  kind text not null,
  title text not null,
  body text not null,
  explanation text not null,
  details jsonb default '[]'::jsonb not null,
  link_url text,
  constraint push_messages_pkey PRIMARY KEY (id)
);
alter table public.push_messages enable row level security;
CREATE INDEX push_messages_created_at_idx ON public.push_messages USING btree (created_at DESC);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.push_subscriptions (
  id uuid default gen_random_uuid() not null,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  user_agent text,
  created_at timestamp with time zone default now() not null,
  constraint push_subscriptions_endpoint_key UNIQUE (endpoint),
  constraint push_subscriptions_pkey PRIMARY KEY (id)
);
alter table public.push_subscriptions enable row level security;
CREATE UNIQUE INDEX push_subscriptions_endpoint_key ON public.push_subscriptions USING btree (endpoint);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.quiz_cards (
  id bigint generated always as identity not null,
  question text not null,
  answer text not null,
  explanation text,
  category text,
  active boolean default true not null,
  created_at timestamp with time zone default now() not null,
  pattern_key text,
  constraint quiz_cards_pkey PRIMARY KEY (id)
);
alter table public.quiz_cards enable row level security;
create policy "Public read access" on public.quiz_cards as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.quiz_progress (
  card_id bigint not null,
  box smallint default 1 not null,
  due_at timestamp with time zone default now() not null,
  last_seen_at timestamp with time zone,
  correct_streak integer default 0 not null,
  total_correct integer default 0 not null,
  total_hard integer default 0 not null,
  total_wrong integer default 0 not null,
  history jsonb default '[]'::jsonb not null,
  constraint quiz_progress_box_check CHECK (((box >= 1) AND (box <= 4))),
  constraint quiz_progress_card_id_fkey FOREIGN KEY (card_id) REFERENCES public.quiz_cards(id) ON DELETE CASCADE,
  constraint quiz_progress_pkey PRIMARY KEY (card_id)
);
alter table public.quiz_progress enable row level security;
create policy "Public read access" on public.quiz_progress as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.rate_limit_events (
  id bigint generated always as identity not null,
  endpoint text not null,
  created_at timestamp with time zone default now() not null,
  constraint rate_limit_events_pkey PRIMARY KEY (id)
);
alter table public.rate_limit_events enable row level security;
CREATE INDEX rate_limit_events_endpoint_created_at_idx ON public.rate_limit_events USING btree (endpoint, created_at DESC);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.regime_change_pushes_sent (
  interval text not null,
  candle_time timestamp with time zone not null,
  regime text not null,
  sent_at timestamp with time zone default now() not null,
  constraint regime_change_pushes_sent_pkey PRIMARY KEY ("interval", candle_time)
);
alter table public.regime_change_pushes_sent enable row level security;
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.research_confluence_score_tiers (
  direction text not null,
  base_logit numeric not null,
  tier_low_max numeric not null,
  tier_mid_max numeric not null,
  n_total integer not null,
  computed_at timestamp with time zone default now() not null,
  constraint research_confluence_score_tiers_pkey PRIMARY KEY (direction)
);
alter table public.research_confluence_score_tiers enable row level security;
create policy "Public read access" on public.research_confluence_score_tiers as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.research_confluence_score_woe (
  id bigint generated by default as identity not null,
  direction text not null,
  factor text not null,
  level text not null,
  n integer not null,
  x integer not null,
  woe numeric not null,
  computed_at timestamp with time zone default now() not null,
  constraint research_confluence_score_woe_direction_factor_level_key UNIQUE (direction, factor, level),
  constraint research_confluence_score_woe_pkey PRIMARY KEY (id)
);
alter table public.research_confluence_score_woe enable row level security;
CREATE UNIQUE INDEX research_confluence_score_woe_direction_factor_level_key ON public.research_confluence_score_woe USING btree (direction, factor, level);
create policy "Public read access" on public.research_confluence_score_woe as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.research_confluence_signal_activation (
  setup_id bigint not null,
  signal_a text not null,
  direction text not null,
  outcome text not null,
  is_active boolean not null,
  constraint research_confluence_signal_activation_direction_check CHECK ((direction = ANY (ARRAY['LONG'::text, 'SHORT'::text]))),
  constraint research_confluence_signal_activation_pkey PRIMARY KEY (setup_id, signal_a, direction)
);
alter table public.research_confluence_signal_activation enable row level security;
CREATE INDEX research_confluence_signal_activation_signal_a_direction_idx ON public.research_confluence_signal_activation USING btree (signal_a, direction);
create policy "Public read access" on public.research_confluence_signal_activation as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.research_confluence_signal_stats (
  id bigint generated always as identity not null,
  cell_type text not null,
  pool text not null,
  signal_a text not null,
  signal_b text,
  direction text not null,
  window_start timestamp with time zone not null,
  window_end timestamp with time zone not null,
  n1 integer not null,
  x1 integer not null,
  n2 integer not null,
  x2 integer not null,
  hit_rate1_pct numeric,
  hit_rate2_pct numeric,
  wilson1_lower numeric,
  wilson1_upper numeric,
  wilson2_lower numeric,
  wilson2_upper numeric,
  z_score numeric,
  raw_p_value numeric,
  raw_significant boolean,
  min_n_met boolean not null,
  computed_at timestamp with time zone default now() not null,
  constraint research_confluence_signal_st_cell_type_signal_a_signal_b_d_key UNIQUE (cell_type, signal_a, signal_b, direction, window_start, window_end),
  constraint research_confluence_signal_stats_cell_type_check CHECK ((cell_type = ANY (ARRAY['signal'::text, 'pair_a'::text, 'pair_b'::text]))),
  constraint research_confluence_signal_stats_direction_check CHECK ((direction = ANY (ARRAY['LONG'::text, 'SHORT'::text]))),
  constraint research_confluence_signal_stats_pkey PRIMARY KEY (id),
  constraint research_confluence_signal_stats_pool_check CHECK ((pool = ANY (ARRAY['main'::text, 'exploratory'::text])))
);
alter table public.research_confluence_signal_stats enable row level security;
CREATE UNIQUE INDEX research_confluence_signal_st_cell_type_signal_a_signal_b_d_key ON public.research_confluence_signal_stats USING btree (cell_type, signal_a, signal_b, direction, window_start, window_end);
create policy "Public read access" on public.research_confluence_signal_stats as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.research_funding_rate_history (
  funding_time timestamp with time zone not null,
  funding_rate numeric not null,
  funding_zscore numeric,
  constraint research_funding_rate_history_pkey PRIMARY KEY (funding_time)
);
alter table public.research_funding_rate_history enable row level security;
create policy "Public read access" on public.research_funding_rate_history as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.research_regime_cci_roc_1h (
  candle_open_time timestamp with time zone not null,
  cci numeric,
  roc numeric,
  constraint research_regime_cci_roc_1h_pkey PRIMARY KEY (candle_open_time)
);
alter table public.research_regime_cci_roc_1h enable row level security;
create policy "Public read access" on public.research_regime_cci_roc_1h as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.research_regime_score_tiers (
  direction text not null,
  base_logit numeric not null,
  tier_low_max numeric not null,
  tier_mid_max numeric not null,
  n_total integer not null,
  computed_at timestamp with time zone default now() not null,
  constraint research_regime_score_tiers_direction_check CHECK ((direction = ANY (ARRAY['UP'::text, 'DOWN'::text]))),
  constraint research_regime_score_tiers_pkey PRIMARY KEY (direction)
);
alter table public.research_regime_score_tiers enable row level security;
create policy "Public read access" on public.research_regime_score_tiers as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.research_regime_score_woe (
  id bigint generated always as identity not null,
  direction text not null,
  factor text not null,
  level text not null,
  n integer not null,
  x integer not null,
  woe numeric,
  computed_at timestamp with time zone default now() not null,
  constraint research_regime_score_woe_direction_check CHECK ((direction = ANY (ARRAY['UP'::text, 'DOWN'::text]))),
  constraint research_regime_score_woe_direction_factor_level_key UNIQUE (direction, factor, level),
  constraint research_regime_score_woe_pkey PRIMARY KEY (id)
);
alter table public.research_regime_score_woe enable row level security;
CREATE UNIQUE INDEX research_regime_score_woe_direction_factor_level_key ON public.research_regime_score_woe USING btree (direction, factor, level);
create policy "Public read access" on public.research_regime_score_woe as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.research_regime_signal_activation (
  id bigint generated always as identity not null,
  evaluation_time timestamp with time zone not null,
  signal_a text not null,
  direction text not null,
  outcome text not null,
  is_active boolean not null,
  computed_at timestamp with time zone default now() not null,
  constraint research_regime_signal_activa_evaluation_time_signal_a_dire_key UNIQUE (evaluation_time, signal_a, direction),
  constraint research_regime_signal_activation_direction_check CHECK ((direction = ANY (ARRAY['UP'::text, 'DOWN'::text]))),
  constraint research_regime_signal_activation_outcome_check CHECK ((outcome = ANY (ARRAY['UP'::text, 'DOWN'::text, 'NEUTRAL'::text]))),
  constraint research_regime_signal_activation_pkey PRIMARY KEY (id)
);
alter table public.research_regime_signal_activation enable row level security;
CREATE UNIQUE INDEX research_regime_signal_activa_evaluation_time_signal_a_dire_key ON public.research_regime_signal_activation USING btree (evaluation_time, signal_a, direction);
CREATE INDEX idx_regime_activation_signal ON public.research_regime_signal_activation USING btree (signal_a, direction);
create policy "Public read access" on public.research_regime_signal_activation as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.research_regime_signal_stats (
  id bigint generated always as identity not null,
  cell_type text default 'signal'::text not null,
  signal_a text not null,
  direction text not null,
  n1 integer not null,
  x1 integer not null,
  n2 integer not null,
  x2 integer not null,
  hit_rate1_pct numeric,
  hit_rate2_pct numeric,
  wilson1_lower numeric,
  wilson1_upper numeric,
  wilson2_lower numeric,
  wilson2_upper numeric,
  z_score numeric,
  raw_p_value numeric,
  min_n_met boolean default false not null,
  computed_at timestamp with time zone default now() not null,
  constraint research_regime_signal_stats_direction_check CHECK ((direction = ANY (ARRAY['UP'::text, 'DOWN'::text]))),
  constraint research_regime_signal_stats_pkey PRIMARY KEY (id),
  constraint research_regime_signal_stats_signal_a_direction_key UNIQUE (signal_a, direction)
);
alter table public.research_regime_signal_stats enable row level security;
CREATE UNIQUE INDEX research_regime_signal_stats_signal_a_direction_key ON public.research_regime_signal_stats USING btree (signal_a, direction);
create policy "Public read access" on public.research_regime_signal_stats as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.research_rsi_reversal_results (
  id bigint generated always as identity not null,
  interval text not null,
  rsi_upper numeric not null,
  rsi_lower numeric not null,
  definition text not null,
  split text not null,
  direction text not null,
  n_signals integer not null,
  n_tp integer not null,
  n_sl integer not null,
  n_timeout integer not null,
  created_at timestamp with time zone default now() not null,
  constraint research_rsi_reversal_results_pkey PRIMARY KEY (id)
);
alter table public.research_rsi_reversal_results enable row level security;
create policy "Public read access" on public.research_rsi_reversal_results as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.research_swing_setup_chain_results (
  id bigint generated always as identity not null,
  interval text not null,
  direction text not null,
  tp_pct numeric not null,
  sl_pct numeric not null,
  retrace_pct numeric not null,
  vertical_bars integer not null,
  signal_time timestamp with time zone not null,
  entry_time timestamp with time zone not null,
  entry_price numeric not null,
  outcome text not null,
  resolution_time timestamp with time zone not null,
  bars_to_resolution integer,
  mfe_pct numeric,
  created_at timestamp with time zone default now() not null,
  constraint research_swing_setup_chain_re_interval_direction_tp_pct_sl__key UNIQUE ("interval", direction, tp_pct, sl_pct, retrace_pct, vertical_bars, signal_time),
  constraint research_swing_setup_chain_results_direction_check CHECK ((direction = ANY (ARRAY['LONG'::text, 'SHORT'::text]))),
  constraint research_swing_setup_chain_results_outcome_check CHECK ((outcome = ANY (ARRAY['SL'::text, 'TIMEOUT'::text, 'TRAIL_EXIT'::text, 'OPEN_AT_HORIZON'::text]))),
  constraint research_swing_setup_chain_results_pkey PRIMARY KEY (id)
);
alter table public.research_swing_setup_chain_results enable row level security;
CREATE UNIQUE INDEX research_swing_setup_chain_re_interval_direction_tp_pct_sl__key ON public.research_swing_setup_chain_results USING btree ("interval", direction, tp_pct, sl_pct, retrace_pct, vertical_bars, signal_time);
create policy "Public read access" on public.research_swing_setup_chain_results as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.sentiment_snapshots (
  id bigint generated always as identity not null,
  timestamp_utc timestamp with time zone default now() not null,
  source text default 'alternative.me'::text not null,
  value smallint,
  classification text,
  status text not null,
  error text,
  created_at timestamp with time zone default now() not null,
  constraint sentiment_snapshots_pkey PRIMARY KEY (id)
);
alter table public.sentiment_snapshots enable row level security;
CREATE INDEX sentiment_snapshots_timestamp_idx ON public.sentiment_snapshots USING btree (timestamp_utc DESC);
create policy "Public read access" on public.sentiment_snapshots as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.signal_outcomes (
  id bigint generated always as identity not null,
  category text not null,
  signal_type text not null,
  direction_expected text,
  fired_at timestamp with time zone not null,
  price_at_signal numeric not null,
  horizon_hours integer not null,
  source_table text not null,
  source_id text not null,
  outcome_price numeric,
  outcome_at timestamp with time zone,
  return_pct numeric,
  hit boolean,
  filled_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  constraint signal_outcomes_direction_expected_check CHECK ((direction_expected = ANY (ARRAY['bullish'::text, 'bearish'::text]))),
  constraint signal_outcomes_pkey PRIMARY KEY (id),
  constraint signal_outcomes_unique_instance UNIQUE (source_table, source_id, signal_type, horizon_hours)
);
alter table public.signal_outcomes enable row level security;
CREATE INDEX signal_outcomes_category_type_idx ON public.signal_outcomes USING btree (category, signal_type);
CREATE INDEX signal_outcomes_fired_at_idx ON public.signal_outcomes USING btree (fired_at);
CREATE INDEX signal_outcomes_pending_fill_idx ON public.signal_outcomes USING btree (fired_at) WHERE (filled_at IS NULL);
CREATE UNIQUE INDEX signal_outcomes_unique_instance ON public.signal_outcomes USING btree (source_table, source_id, signal_type, horizon_hours);
create policy "Public read access" on public.signal_outcomes as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.signal_review_snapshots (
  id bigint generated always as identity not null,
  generated_at timestamp with time zone default now() not null,
  provider text,
  model text,
  result jsonb,
  status text not null,
  error text,
  constraint signal_review_snapshots_pkey PRIMARY KEY (id),
  constraint signal_review_snapshots_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'error'::text])))
);
alter table public.signal_review_snapshots enable row level security;
create policy "Public read access" on public.signal_review_snapshots as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.signal_stats_results (
  id bigint generated always as identity not null,
  window_label text not null,
  category text not null,
  signal_type text not null,
  horizon_hours integer not null,
  direction_expected text,
  test_type text not null,
  n integer not null,
  hit_rate_pct numeric,
  baseline_hit_rate_pct numeric,
  avg_return_pct numeric,
  avg_abs_return_pct numeric,
  baseline_avg_abs_return_pct numeric,
  raw_p_value numeric,
  rank integer,
  bh_critical_value numeric,
  significant_after_bh boolean,
  computed_at timestamp with time zone default now() not null,
  constraint signal_stats_results_direction_expected_check CHECK ((direction_expected = ANY (ARRAY['bullish'::text, 'bearish'::text]))),
  constraint signal_stats_results_pkey PRIMARY KEY (id),
  constraint signal_stats_results_test_type_check CHECK ((test_type = ANY (ARRAY['directional'::text, 'magnitude'::text]))),
  constraint signal_stats_results_unique_cell UNIQUE (window_label, category, signal_type, horizon_hours),
  constraint signal_stats_results_window_label_check CHECK ((window_label = ANY (ARRAY['90d'::text, 'all'::text])))
);
alter table public.signal_stats_results enable row level security;
CREATE UNIQUE INDEX signal_stats_results_unique_cell ON public.signal_stats_results USING btree (window_label, category, signal_type, horizon_hours);
create policy "Public read access" on public.signal_stats_results as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.spot_market_snapshots (
  id bigint generated by default as identity not null,
  timestamp_utc timestamp with time zone not null,
  symbol text not null,
  exchange text not null,
  last_price numeric,
  status text not null,
  error text,
  created_at timestamp with time zone default now() not null,
  interval_minutes integer default 5 not null,
  open_price numeric,
  base_volume numeric,
  quote_volume numeric,
  taker_buy_vol numeric,
  taker_sell_vol numeric,
  taker_buy_quote_vol numeric,
  taker_sell_quote_vol numeric,
  taker_buy_sell_ratio numeric,
  trade_count integer,
  constraint spot_market_snapshots_pkey PRIMARY KEY (id)
);
alter table public.spot_market_snapshots enable row level security;
CREATE INDEX idx_spot_snapshots_time ON public.spot_market_snapshots USING btree (timestamp_utc DESC);
CREATE INDEX idx_spot_snapshots_exchange_symbol ON public.spot_market_snapshots USING btree (exchange, symbol, timestamp_utc DESC);
CREATE UNIQUE INDEX spot_market_snapshots_unique_candle ON public.spot_market_snapshots USING btree (exchange, symbol, timestamp_utc);
create policy "Public read access" on public.spot_market_snapshots as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.spot_volume_buckets (
  id bigint generated always as identity not null,
  bucket_time_utc timestamp with time zone default now() not null,
  exchange text default 'binance'::text not null,
  symbol text default 'BTCUSDT'::text not null,
  price_bucket numeric not null,
  buy_volume numeric default 0 not null,
  sell_volume numeric default 0 not null,
  trade_count integer default 0 not null,
  created_at timestamp with time zone default now() not null,
  constraint spot_volume_buckets_pkey PRIMARY KEY (id)
);
alter table public.spot_volume_buckets enable row level security;
CREATE INDEX idx_spot_volume_buckets_time ON public.spot_volume_buckets USING btree (bucket_time_utc);
CREATE INDEX idx_spot_volume_buckets_lookup ON public.spot_volume_buckets USING btree (exchange, symbol, price_bucket);
create policy "Public read access" on public.spot_volume_buckets as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.spot_volume_profile_cursor (
  exchange text not null,
  symbol text not null,
  last_agg_trade_id bigint,
  updated_at timestamp with time zone default now() not null,
  constraint spot_volume_profile_cursor_pkey PRIMARY KEY (exchange, symbol)
);
alter table public.spot_volume_profile_cursor enable row level security;
create policy "Public read access" on public.spot_volume_profile_cursor as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.system_briefing_config (
  id smallint default 1 not null,
  schedule_times time without time zone[],
  email_enabled boolean default false not null,
  push_enabled boolean default false not null,
  updated_at timestamp with time zone default now() not null,
  constraint system_briefing_config_id_check CHECK ((id = 1)),
  constraint system_briefing_config_pkey PRIMARY KEY (id),
  constraint system_briefing_config_schedule_times_max5 CHECK (((schedule_times IS NULL) OR (array_length(schedule_times, 1) <= 5)))
);
alter table public.system_briefing_config enable row level security;
create policy "Public read access" on public.system_briefing_config as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.system_briefings (
  id bigint generated always as identity not null,
  generated_at timestamp with time zone default now() not null,
  provider text,
  model text,
  result jsonb,
  status text not null,
  error text,
  email_sent boolean default false not null,
  push_sent boolean default false not null,
  constraint system_briefings_pkey PRIMARY KEY (id)
);
alter table public.system_briefings enable row level security;
create policy "Public read access" on public.system_briefings as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create view public.tap_funky as
 SELECT p.oid,
    n.nspname AS schema,
    p.proname AS name,
    pg_get_userbyid(p.proowner) AS owner,
    array_to_string((p.proargtypes)::regtype[], ','::text) AS args,
    (
        CASE p.proretset
            WHEN true THEN 'setof '::text
            ELSE ''::text
        END || (p.prorettype)::regtype) AS returns,
    p.prolang AS langoid,
    p.proisstrict AS is_strict,
    public._prokind(p.oid) AS kind,
    p.prosecdef AS is_definer,
    p.proretset AS returns_set,
    (p.provolatile)::character(1) AS volatility,
    pg_function_is_visible(p.oid) AS is_visible
   FROM (pg_proc p
     JOIN pg_namespace n ON ((p.pronamespace = n.oid)));

create table public.term_basis_snapshots (
  id bigint default nextval('public.term_basis_snapshots_id_seq'::regclass) not null,
  timestamp_utc timestamp with time zone not null,
  instrument text not null,
  expiry_utc timestamp with time zone not null,
  days_to_expiry numeric not null,
  future_price numeric not null,
  index_price numeric not null,
  basis_pct numeric not null,
  basis_annualized_pct numeric not null,
  source text default 'deribit'::text not null,
  created_at timestamp with time zone default now() not null,
  constraint term_basis_snapshots_pkey PRIMARY KEY (id),
  constraint term_basis_snapshots_timestamp_utc_instrument_key UNIQUE (timestamp_utc, instrument)
);
alter table public.term_basis_snapshots enable row level security;
CREATE UNIQUE INDEX term_basis_snapshots_timestamp_utc_instrument_key ON public.term_basis_snapshots USING btree (timestamp_utc, instrument);
CREATE INDEX term_basis_snapshots_ts_idx ON public.term_basis_snapshots USING btree (timestamp_utc DESC);
create policy "Public read access" on public.term_basis_snapshots as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.trade_debate_snapshots (
  id bigint generated always as identity not null,
  generated_at timestamp with time zone default now() not null,
  bull_read jsonb,
  bear_read jsonb,
  referee_provider text,
  referee_model text,
  referee_result jsonb,
  verdict text,
  status text not null,
  error text,
  constraint trade_debate_snapshots_pkey PRIMARY KEY (id)
);
alter table public.trade_debate_snapshots enable row level security;
create policy "Public read access" on public.trade_debate_snapshots as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.tradingview_signals (
  id uuid default gen_random_uuid() not null,
  received_at timestamp with time zone default now() not null,
  ticker text not null,
  signal_type text not null,
  timeframe text,
  payload jsonb not null,
  constraint tradingview_signals_pkey PRIMARY KEY (id)
);
alter table public.tradingview_signals enable row level security;
CREATE INDEX tradingview_signals_received_at_idx ON public.tradingview_signals USING btree (received_at DESC);
create policy "Public read access" on public.tradingview_signals as permissive for select to anon, authenticated using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.youtube_monitor_config (
  id bigint default 1 not null,
  search_query text default 'Bitcoin BTC'::text not null,
  channels jsonb default '[]'::jsonb not null,
  updated_at timestamp with time zone default now() not null,
  blocked_channels text[] default '{}'::text[] not null,
  constraint youtube_monitor_config_pkey PRIMARY KEY (id),
  constraint youtube_monitor_config_singleton CHECK ((id = 1))
);
alter table public.youtube_monitor_config enable row level security;
create policy "Public read access" on public.youtube_monitor_config as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

create table public.youtube_video_analyses (
  id bigint generated always as identity not null,
  video_id text not null,
  channel_title text,
  title text not null,
  published_at timestamp with time zone not null,
  url text not null,
  generated_at timestamp with time zone default now() not null,
  model text,
  result jsonb,
  status text not null,
  error text,
  constraint youtube_video_analyses_pkey PRIMARY KEY (id),
  constraint youtube_video_analyses_status_check CHECK ((status = ANY (ARRAY['ok'::text, 'error'::text]))),
  constraint youtube_video_analyses_video_id_key UNIQUE (video_id)
);
alter table public.youtube_video_analyses enable row level security;
CREATE UNIQUE INDEX youtube_video_analyses_video_id_key ON public.youtube_video_analyses USING btree (video_id);
create policy "Public read access" on public.youtube_video_analyses as permissive for select to public using (true);
-- Rechte: {postgres=arwdDxtm/postgres,anon=arwdDxtm/postgres,authenticated=arwdDxtm/postgres,service_role=arwdDxtm/postgres}

