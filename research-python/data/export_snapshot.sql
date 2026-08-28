-- research-python/data/export_snapshot.sql
--
-- ONE-TIME, READ-ONLY, MANUALLY-RUN data export for the production-factor
-- benchmark (ADR: "Datengrundlage für den Benchmark", Option B). This file
-- is a documentation/reproducibility artifact -- it records EXACTLY which
-- query produced btc_1d_trainval_snapshot.csv, so the export is auditable
-- and re-runnable (e.g. once the Phase-3 Future Research Window has
-- accumulated enough data to extend it).
--
-- This script is NOT executed by any Python code in research-python/ --
-- benchmark_production.py and legacy_factors.py never connect to Supabase
-- (per the project's "no Supabase/production imports in the benchmark
-- pipeline" rule). It was run once, manually, via the Supabase MCP tool
-- (project cpktesxmbqrzpsurntul), and its output was saved as a static CSV.
--
-- HARD GUARANTEE: candle_open_time::date <= '2026-07-07' excludes the
-- entire TEST split (08.07.-26.08.2026) unconditionally. This is TRAIN+
-- VALIDATION data only -- already "seen" diagnostically in Phase 0-2 of
-- this project, appropriate for an engineering/mechanics benchmark of the
-- pipeline, but NOT a substitute for the Phase-3/3.2 pre-registered
-- confirmatory evaluation (see BENCHMARK_RESULTS.md for the explicit
-- caveat this triggers).
--
-- Live-verified row counts before running (see chat record): 201 rows in
-- both backtest_states and market_features for this range; 0 rows with a
-- non-null funding_rate in market_snapshots for this range (confirms the
-- Phase 6 finding that funding/positioning/orderbook/options/macro/
-- sentiment/oi_price/basis have ~0% coverage in TRAIN+VALIDATION -- this
-- export will faithfully reproduce that, not paper over it).

select
  bs.candle_open_time,
  bs.interval,
  bs.architecture_version,
  bs.point_in_time_safe,

  -- Raw continuous inputs (market_features) -- legacy_factors.py recomputes
  -- the actual production factor formulas from these, it does not read
  -- bs.factors directly (that would just be re-reading the already-computed
  -- answer, not an independent reimplementation).
  mf.close_price,
  mf.ema_20,
  mf.ema_50,
  mf.ema_200,
  mf.rsi_14,
  mf.macd_line,
  mf.macd_signal,
  mf.macd_histogram,
  mf.atr_14,
  mf.adx_14,
  mf.plus_di,
  mf.minus_di,
  mf.vwap,
  mf.structure_trend,
  mf.cvd_delta,
  mf.cvd_cumulative,
  mf.cvd_trend,
  mf.oi_current,
  mf.oi_delta_pct,
  mf.oi_volume_ratio,
  mf.spot_price,
  mf.basis_pct,
  mf.data_quality,

  -- Reference only: the already-computed production-mirroring factors/state
  -- from the point-in-time-safe reconstruction, used SOLELY to sanity-check
  -- that legacy_factors.py's independent Python reimplementation reproduces
  -- these values -- never used as an input to the benchmark itself.
  bs.factors as reference_factors_jsonb,
  bs.domain_result as reference_domain_result_jsonb

from backtest_states bs
join market_features mf
  on mf.symbol = 'BTCUSDT'
 and mf.interval = bs.interval
 and mf.candle_open_time = bs.candle_open_time
where bs.interval = '1d'
  and bs.architecture_version = 'experimental_domain_v2_phase4_full_asof'
  and bs.candle_open_time::date <= '2026-07-07'   -- TEST split hard-excluded, see guarantee above
order by bs.candle_open_time asc;
