-- research-python/data/export_multivariate_snapshot.sql
--
-- ONE-TIME, READ-ONLY, MANUALLY-RUN export for the multivariate model
-- (logistic regression on continuous features instead of the hand-built
-- -1/0/1 discretization). Documents exactly which query produced
-- multivariate_1d_snapshot.csv, run once via the Supabase MCP tool
-- (project cpktesxmbqrzpsurntul).
--
-- Interval: 1d. Range: full backfilled 2-year history (2024-09-04 to
-- 2026-09-03), point-in-time safe (backtest_states with
-- architecture_version='experimental_domain_v2_phase4_full_asof').
--
-- On-chain features (sopr/mvrv/lth_net_position/stablecoin_supply/whale
-- count) are joined to the PRIOR calendar day's observation
-- (candle_open_time - 1 day), not the same day -- conservative choice to
-- avoid any same-day publication-timing leakage, since the exact
-- publication time-of-day for bitcoin-data.com's daily snapshots is not
-- documented.
--
-- Label: forward_return_24h_pct = (close(t+24h) - close(t)) / close(t) *
-- 100, and label_up = 1 if > 0 else 0. Rows where the forward close is not
-- yet available (last ~1 day) will have label=NULL and must be dropped
-- before training -- not imputed.

select
  bs.candle_open_time,
  mf.close_price,
  mf.rsi_14,
  mf.macd_histogram,
  mf.adx_14,
  mf.plus_di,
  mf.minus_di,
  mf.ema_50,
  mf.ema_200,
  mf.vwap,
  mf.cvd_delta,
  mf.structure_trend,
  (bs.factors->'funding'->'basis'->>'avg_funding_rate')::numeric as avg_funding_rate,
  bs.factors->'macro'->'basis'->>'regime' as macro_regime,
  bs.factors->'sentiment'->'basis'->>'classification' as sentiment_classification,
  oc_sopr.value as onchain_sopr,
  oc_mvrv.value as onchain_mvrv,
  oc_lth.value as onchain_lth_net_position_change_btc,
  oc_stable.value as onchain_stablecoin_supply,
  oc_whale.value as onchain_whale_addr_count,
  mf2.close_price as close_price_fwd_24h
from backtest_states bs
join market_features mf
  on mf.symbol = 'BTCUSDT' and mf.interval = '1d' and mf.candle_open_time = bs.candle_open_time
left join market_features mf2
  on mf2.symbol = 'BTCUSDT' and mf2.interval = '1d' and mf2.candle_open_time = bs.candle_open_time + interval '24 hours'
left join onchain_snapshots oc_sopr
  on oc_sopr.metric = 'sopr' and oc_sopr.status = 'ok'
 and oc_sopr.observation_date = (bs.candle_open_time - interval '1 day')::date
left join onchain_snapshots oc_mvrv
  on oc_mvrv.metric = 'mvrv' and oc_mvrv.status = 'ok'
 and oc_mvrv.observation_date = (bs.candle_open_time - interval '1 day')::date
left join onchain_snapshots oc_lth
  on oc_lth.metric = 'lth-net-position-change-btc' and oc_lth.status = 'ok'
 and oc_lth.observation_date = (bs.candle_open_time - interval '1 day')::date
left join onchain_snapshots oc_stable
  on oc_stable.metric = 'stablecoin-supply' and oc_stable.status = 'ok'
 and oc_stable.observation_date = (bs.candle_open_time - interval '1 day')::date
left join onchain_snapshots oc_whale
  on oc_whale.metric = 'balance-addr-10K-BTC' and oc_whale.status = 'ok'
 and oc_whale.observation_date = (bs.candle_open_time - interval '1 day')::date
where bs.interval = '1d'
  and bs.architecture_version = 'experimental_domain_v2_phase4_full_asof'
  and bs.candle_open_time between '2024-09-04' and '2026-09-03'
order by bs.candle_open_time asc;
