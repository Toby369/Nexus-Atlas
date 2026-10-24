-- Exportiert aus supabase_migrations.schema_migrations (20260827031008 fix_refresh_data_quality_news_symbol_null)

-- Bugfix: Block M (News Ingestion) nutzte symbol=NULL. Da NULL in einem
-- UNIQUE-Constraint nie als "gleich" gilt, haette ON CONFLICT dort nie
-- gegriffen -- jeder Lauf (alle 5 Min) haette eine neue Zeile eingefuegt
-- statt die bestehende zu aktualisieren (Duplikate ohne Ende). Vor dem
-- ersten produktiven Lauf gefunden und behoben: 'ALL' statt NULL als
-- Platzhalter-Symbol, damit der UNIQUE-Constraint (source,metric,symbol)
-- greift.
create or replace function public.refresh_data_quality()
returns void
language plpgsql
as $outer$
begin
  -- === A) Futures Market Snapshots (Binance/Bybit/OKX/Bitget) ===========
  with sources as (select unnest(array['binance','bybit','okx','bitget']) as exchange),
  all_time as (
    select exchange, max(timestamp_utc) filter (where status = 'ok') as last_success_at, max(timestamp_utc) as data_timestamp
    from market_snapshots where symbol = 'BTCUSDT' group by exchange
  ),
  recent as (
    select exchange, count(*) as total_count, count(*) filter (where status = 'error') as error_count,
      count(*) filter (where last_price is null) as missing_count,
      (array_agg(status order by timestamp_utc desc))[1] = 'error' as latest_is_error
    from market_snapshots where symbol = 'BTCUSDT' and timestamp_utc >= now() - interval '6 hours' group by exchange
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    s.exchange, 'futures_market_snapshot', 'BTCUSDT', at.last_success_at, at.data_timestamp, 300, ev.status,
    case when coalesce(r.latest_is_error, at.last_success_at is null) then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from market_snapshots where exchange = s.exchange and symbol = 'BTCUSDT'),
    coalesce(r.error_count, 0), ev.quality_score, now()
  from sources s
  left join all_time at on at.exchange = s.exchange
  left join recent r on r.exchange = s.exchange
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, 300, 3,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    coalesce(r.latest_is_error, false)
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === B) Spot Market Snapshots (Binance) ================================
  with all_time as (
    select max(timestamp_utc) filter (where status = 'ok') as last_success_at, max(timestamp_utc) as data_timestamp
    from spot_market_snapshots where exchange = 'binance'
  ),
  recent as (
    select count(*) as total_count, count(*) filter (where status = 'error') as error_count,
      count(*) filter (where last_price is null) as missing_count,
      (array_agg(status order by timestamp_utc desc))[1] = 'error' as latest_is_error
    from spot_market_snapshots where exchange = 'binance' and timestamp_utc >= now() - interval '6 hours'
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    'binance', 'spot_market_snapshot', 'BTCUSDT', at.last_success_at, at.data_timestamp, 300, ev.status,
    case when coalesce(r.latest_is_error, at.last_success_at is null) then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from spot_market_snapshots where exchange = 'binance'),
    coalesce(r.error_count, 0), ev.quality_score, now()
  from all_time at, recent r
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, 300, 3,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    coalesce(r.latest_is_error, false)
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === C) Candles (Binance, je Intervall) -- keine Status-Spalte =========
  with cfg(cinterval, expected_seconds) as (values ('1h',3600), ('4h',14400), ('1d',86400)),
  all_time as (
    select interval as cinterval, max(close_time) as data_timestamp
    from candles where symbol = 'BTCUSDT' and exchange = 'binance' group by interval
  ),
  recent as (
    select c.interval as cinterval, count(*) as total_count, count(*) filter (where c.close is null) as missing_count
    from candles c join cfg on cfg.cinterval = c.interval
    where c.symbol = 'BTCUSDT' and c.exchange = 'binance' and c.close_time >= now() - (cfg.expected_seconds * 10 || ' seconds')::interval
    group by c.interval
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    'binance', 'candles_' || cfg.cinterval, 'BTCUSDT', at.data_timestamp, at.data_timestamp, cfg.expected_seconds, ev.status,
    case when at.data_timestamp is null then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from candles where symbol = 'BTCUSDT' and exchange = 'binance' and interval = cfg.cinterval),
    0, ev.quality_score, now()
  from cfg
  left join all_time at on at.cinterval = cfg.cinterval
  left join recent r on r.cinterval = cfg.cinterval
  cross join lateral public._dq_evaluate(
    at.data_timestamp, at.data_timestamp, cfg.expected_seconds, 3,
    null,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    false
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === D) Market Features (Binance, je Intervall) -- keine Status-Spalte,
  -- Vollstaendigkeit ueber rsi_14 geprueft (null = zu wenig Vorlauf-Historie) ==
  with cfg(cinterval, expected_seconds) as (values ('1h',3600), ('4h',14400), ('1d',86400)),
  all_time as (
    select interval as cinterval, max(candle_open_time) as data_timestamp
    from market_features where symbol = 'BTCUSDT' group by interval
  ),
  recent as (
    select mf.interval as cinterval, count(*) as total_count, count(*) filter (where mf.rsi_14 is null) as missing_count
    from market_features mf join cfg on cfg.cinterval = mf.interval
    where mf.symbol = 'BTCUSDT' and mf.candle_open_time >= now() - (cfg.expected_seconds * 10 || ' seconds')::interval
    group by mf.interval
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    'nexus-atlas-engine', 'market_features_' || cfg.cinterval, 'BTCUSDT', at.data_timestamp, at.data_timestamp, cfg.expected_seconds, ev.status,
    case when at.data_timestamp is null then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from market_features where symbol = 'BTCUSDT' and interval = cfg.cinterval),
    0, ev.quality_score, now()
  from cfg
  left join all_time at on at.cinterval = cfg.cinterval
  left join recent r on r.cinterval = cfg.cinterval
  cross join lateral public._dq_evaluate(
    at.data_timestamp, at.data_timestamp, cfg.expected_seconds, 3,
    null,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    false
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === E) Options (Deribit) ==============================================
  with all_time as (
    select max(timestamp_utc) filter (where status = 'ok') as last_success_at, max(timestamp_utc) as data_timestamp
    from options_snapshots
  ),
  recent as (
    select count(*) as total_count, count(*) filter (where status = 'error') as error_count,
      count(*) filter (where atm_iv is null) as missing_count,
      (array_agg(status order by timestamp_utc desc))[1] = 'error' as latest_is_error
    from options_snapshots where timestamp_utc >= now() - interval '6 hours'
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    'deribit', 'options_snapshot', 'BTC', at.last_success_at, at.data_timestamp, 1800, ev.status,
    case when coalesce(r.latest_is_error, at.last_success_at is null) then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from options_snapshots), coalesce(r.error_count,0), ev.quality_score, now()
  from all_time at, recent r
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, 1800, 3,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    coalesce(r.latest_is_error, false)
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === F) Macro (Yahoo + FRED, je Symbol -- je eigene Toleranz) ==========
  with cfg(symbol, source, expected_seconds, mult) as (
    values
      ('^GSPC','yahoo_finance',1800,100), ('^IXIC','yahoo_finance',1800,100), ('^VIX','yahoo_finance',1800,100),
      ('DX-Y.NYB','yahoo_finance',1800,100), ('^TNX','yahoo_finance',1800,100),
      ('DGS2','fred',86400,5), ('DFF','fred',86400,5), ('RRPONTSYD','fred',86400,5),
      ('WALCL','fred',604800,3), ('WTREGEN','fred',604800,3),
      ('M2SL','fred',2629800,2), ('CPIAUCSL','fred',2629800,2), ('PCEPI','fred',2629800,2), ('PAYEMS','fred',2629800,2)
  ),
  all_time as (
    select symbol, max(timestamp_utc) filter (where status = 'ok') as last_success_at, max(timestamp_utc) as data_timestamp
    from macro_snapshots group by symbol
  ),
  recent as (
    select symbol, count(*) as total_count, count(*) filter (where status = 'error') as error_count,
      count(*) filter (where last_price is null) as missing_count,
      (array_agg(status order by timestamp_utc desc))[1] = 'error' as latest_is_error
    from macro_snapshots where timestamp_utc >= now() - interval '14 days' group by symbol
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    cfg.source, 'macro_series', cfg.symbol, at.last_success_at, at.data_timestamp, cfg.expected_seconds, ev.status,
    case when coalesce(r.latest_is_error, at.last_success_at is null) then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from macro_snapshots where symbol = cfg.symbol), coalesce(r.error_count,0), ev.quality_score, now()
  from cfg
  left join all_time at on at.symbol = cfg.symbol
  left join recent r on r.symbol = cfg.symbol
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, cfg.expected_seconds, cfg.mult,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    coalesce(r.latest_is_error, false)
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === G) On-Chain (BGeometrics, je Metrik -- Tabelle hat schon "metric") ==
  with all_time as (
    select metric, max(timestamp_utc) filter (where status = 'ok') as last_success_at, max(timestamp_utc) as data_timestamp
    from onchain_snapshots group by metric
  ),
  recent as (
    select metric, count(*) as total_count, count(*) filter (where status = 'error') as error_count,
      count(*) filter (where value is null) as missing_count,
      (array_agg(status order by timestamp_utc desc))[1] = 'error' as latest_is_error
    from onchain_snapshots where timestamp_utc >= now() - interval '14 days' group by metric
  ),
  cfg as (
    select unnest(array['sopr','mvrv','realized-price','lth-net-position-change-btc','sth-net-position-change-btc','miner-net-flow','stablecoin-supply','balance-addr-10K-BTC']) as metric
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    'bgeometrics', cfg.metric, 'BTC', at.last_success_at, at.data_timestamp, 86400, ev.status,
    case when coalesce(r.latest_is_error, at.last_success_at is null) then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from onchain_snapshots where metric = cfg.metric), coalesce(r.error_count,0), ev.quality_score, now()
  from cfg
  left join all_time at on at.metric = cfg.metric
  left join recent r on r.metric = cfg.metric
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, 86400, 3,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    coalesce(r.latest_is_error, false)
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === H) Sentiment (alternative.me) ======================================
  with all_time as (
    select max(timestamp_utc) filter (where status = 'ok') as last_success_at, max(timestamp_utc) as data_timestamp
    from sentiment_snapshots
  ),
  recent as (
    select count(*) as total_count, count(*) filter (where status = 'error') as error_count,
      count(*) filter (where value is null) as missing_count,
      (array_agg(status order by timestamp_utc desc))[1] = 'error' as latest_is_error
    from sentiment_snapshots where timestamp_utc >= now() - interval '14 days'
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    'alternative.me', 'fear_greed_index', 'BTC', at.last_success_at, at.data_timestamp, 86400, ev.status,
    case when coalesce(r.latest_is_error, at.last_success_at is null) then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from sentiment_snapshots), coalesce(r.error_count,0), ev.quality_score, now()
  from all_time at, recent r
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, 86400, 3,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    coalesce(r.latest_is_error, false)
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === I) ETF Flows (SoSoValue/Farside) -- keine Status-Spalte ============
  with all_time as (select max(created_at) as data_timestamp from etf_flows),
  recent as (
    select count(*) as total_count, count(*) filter (where total_flow_usd_m is null) as missing_count
    from etf_flows where created_at >= now() - interval '14 days'
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    'sosovalue', 'etf_net_flow', 'BTC', at.data_timestamp, at.data_timestamp, 86400, ev.status,
    case when at.data_timestamp is null then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from etf_flows), 0, ev.quality_score, now()
  from all_time at, recent r
  cross join lateral public._dq_evaluate(
    at.data_timestamp, at.data_timestamp, 86400, 4,
    null,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    false
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === J) Positioning Snapshots (Binance/Bybit/OKX/Bitget) ===============
  with sources as (select unnest(array['binance','bybit','okx','bitget']) as exchange),
  all_time as (
    select exchange, max(timestamp_utc) filter (where status = 'ok') as last_success_at, max(timestamp_utc) as data_timestamp
    from positioning_snapshots group by exchange
  ),
  recent as (
    select exchange, count(*) as total_count, count(*) filter (where status = 'error') as error_count,
      count(*) filter (where global_account_long_short_ratio is null) as missing_count,
      (array_agg(status order by timestamp_utc desc))[1] = 'error' as latest_is_error
    from positioning_snapshots where timestamp_utc >= now() - interval '6 hours' group by exchange
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    s.exchange, 'positioning_snapshot', 'BTCUSDT', at.last_success_at, at.data_timestamp, 300, ev.status,
    case when coalesce(r.latest_is_error, at.last_success_at is null) then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from positioning_snapshots where exchange = s.exchange), coalesce(r.error_count,0), ev.quality_score, now()
  from sources s
  left join all_time at on at.exchange = s.exchange
  left join recent r on r.exchange = s.exchange
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, 300, 3,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    coalesce(r.latest_is_error, false)
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === K) Liquidation Events (Binance/Bybit) -- ereignisgetrieben, siehe
  -- Kommentar oben: grosszuegige Stale-Toleranz (6h), da "keine Zeile" ein
  -- legitimer Ruhezustand sein kann. ============================
  with sources as (select unnest(array['binance','bybit']) as exchange),
  all_time as (
    select exchange, max(event_time_utc) filter (where status = 'ok') as last_success_at, max(event_time_utc) as data_timestamp
    from liquidation_events group by exchange
  ),
  recent as (
    select exchange, count(*) as total_count, count(*) filter (where status = 'error') as error_count
    from liquidation_events where event_time_utc >= now() - interval '24 hours' group by exchange
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    s.exchange, 'liquidation_events', 'BTCUSDT', at.last_success_at, at.data_timestamp, 300, ev.status,
    case when at.last_success_at is null then 'error' else 'ok' end,
    null,
    'not_applicable',
    (select count(*) from liquidation_events where exchange = s.exchange), coalesce(r.error_count,0), ev.quality_score, now()
  from sources s
  left join all_time at on at.exchange = s.exchange
  left join recent r on r.exchange = s.exchange
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, 300, 72,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    null, false
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === L) Orderbook Snapshots (Binance/Bybit/OKX) =========================
  with sources as (select unnest(array['binance','bybit','okx']) as exchange),
  all_time as (
    select exchange, max(timestamp_utc) filter (where status = 'ok') as last_success_at, max(timestamp_utc) as data_timestamp
    from orderbook_snapshots group by exchange
  ),
  recent as (
    select exchange, count(*) as total_count, count(*) filter (where status = 'error') as error_count,
      count(*) filter (where mid_price is null) as missing_count,
      (array_agg(status order by timestamp_utc desc))[1] = 'error' as latest_is_error
    from orderbook_snapshots where timestamp_utc >= now() - interval '6 hours' group by exchange
  )
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    s.exchange, 'orderbook_snapshot', 'BTCUSDT', at.last_success_at, at.data_timestamp, 300, ev.status,
    case when coalesce(r.latest_is_error, at.last_success_at is null) then 'error' else 'ok' end,
    case when coalesce(r.total_count,0) > 0 then round(r.missing_count::numeric / r.total_count, 4) else null end,
    case when ev.status in ('LIVE','VALIDATED') then 'passed' when ev.status = 'DEGRADED' then 'failed' else 'not_applicable' end,
    (select count(*) from orderbook_snapshots where exchange = s.exchange), coalesce(r.error_count,0), ev.quality_score, now()
  from sources s
  left join all_time at on at.exchange = s.exchange
  left join recent r on r.exchange = s.exchange
  cross join lateral public._dq_evaluate(
    at.last_success_at, at.data_timestamp, 300, 3,
    case when coalesce(r.total_count,0) > 0 then r.error_count::numeric / r.total_count else null end,
    case when coalesce(r.total_count,0) > 0 then r.missing_count::numeric / r.total_count else null end,
    coalesce(r.latest_is_error, false)
  ) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

  -- === M) News Ingestion -- ereignisgetrieben, grosszuegige Toleranz.
  -- symbol='ALL' (statt NULL, s. Migrationskommentar oben) =====
  with all_time as (select max(created_at) as data_timestamp from news_events),
  recent as (select count(*) as total_count from news_events where created_at >= now() - interval '24 hours')
  insert into public.data_quality (source, metric, symbol, last_success_at, data_timestamp, expected_update_interval_seconds, status, request_status, missing_value_rate, validation_status, historical_observation_count, error_count, quality_score, updated_at)
  select
    'nexus-news-collector', 'news_ingestion', 'ALL', at.data_timestamp, at.data_timestamp, 900, ev.status,
    case when at.data_timestamp is null then 'error' else 'ok' end,
    null, 'not_applicable',
    (select count(*) from news_events), 0, ev.quality_score, now()
  from all_time at, recent r
  cross join lateral public._dq_evaluate(at.data_timestamp, at.data_timestamp, 900, 48, null, null, false) ev
  on conflict (source, metric, symbol) do update set
    last_success_at = excluded.last_success_at, data_timestamp = excluded.data_timestamp, status = excluded.status,
    request_status = excluded.request_status, missing_value_rate = excluded.missing_value_rate,
    validation_status = excluded.validation_status, historical_observation_count = excluded.historical_observation_count,
    error_count = excluded.error_count, quality_score = excluded.quality_score, updated_at = now();

end;
$outer$;
