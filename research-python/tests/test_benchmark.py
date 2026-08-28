"""Tests for src/benchmark_production.py.

Uses small synthetic datasets for speed/determinism where possible, plus
one end-to-end smoke test against the real snapshot file (skipped if it
isn't present, e.g. in an environment that hasn't run the export).
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from src.benchmark_production import (
    DATA_PATH,
    LEGACY_EVALUABLE,
    LEGACY_NOT_EVALUABLE,
    _effective_dimensionality,
    _mean_abs_pairwise_correlation,
    _rolling_zscore,
    build_forward_returns,
    build_legacy_factor_set,
    build_new_candidate_factor_set,
    load_snapshot,
    main,
    summarize_side,
    write_markdown_report,
)


class TestRollingZscore:
    def test_no_lookahead_truncation(self):
        from tests.lookahead_utils import assert_no_lookahead_on_truncation, make_datetime_index

        rng = np.random.default_rng(0)
        s = pd.Series(rng.normal(size=100), index=make_datetime_index(100, freq="D"))
        assert_no_lookahead_on_truncation(lambda x: _rolling_zscore(x, window=20), s, cutoff_pos=60)

    def test_min_periods_enforced(self):
        s = pd.Series(np.arange(30.0))
        z = _rolling_zscore(s, window=20)
        assert z.iloc[:19].isna().all()
        assert z.iloc[19:].notna().all()


class TestMulticollinearityIndex:
    def test_identical_columns_index_near_one(self):
        base = pd.Series(np.linspace(0, 1, 50))
        df = pd.DataFrame({"a": base, "b": base})
        assert np.isclose(_mean_abs_pairwise_correlation(df), 1.0)

    def test_independent_columns_index_near_zero(self):
        rng = np.random.default_rng(1)
        df = pd.DataFrame({f"f{i}": rng.normal(size=2000) for i in range(5)})
        assert _mean_abs_pairwise_correlation(df) < 0.15

    def test_single_column_is_nan(self):
        df = pd.DataFrame({"a": [1.0, 2.0, 3.0]})
        assert np.isnan(_mean_abs_pairwise_correlation(df))


class TestEffectiveDimensionality:
    def test_perfectly_collinear_set_has_effective_dim_one(self):
        rng = np.random.default_rng(2)
        base = rng.normal(size=300)
        df = pd.DataFrame({"a": base, "b": base, "c": base})
        eff, nominal = _effective_dimensionality(df)
        assert nominal == 3.0
        assert np.isclose(eff, 1.0, atol=0.01)

    def test_independent_set_has_effective_dim_near_nominal(self):
        rng = np.random.default_rng(3)
        df = pd.DataFrame({f"f{i}": rng.normal(size=2000) for i in range(4)})
        eff, nominal = _effective_dimensionality(df)
        assert nominal == 4.0
        assert eff > 3.5

    def test_insufficient_rows_returns_nan(self):
        df = pd.DataFrame({"a": [1.0, 2.0], "b": [2.0, 1.0], "c": [1.0, 1.0]})
        eff, nominal = _effective_dimensionality(df)
        assert np.isnan(eff)
        assert nominal == 3.0


class TestBuildForwardReturns:
    def test_forward_looking_by_construction_and_labeled_as_such(self):
        close = pd.Series([100.0, 110.0, 90.0, 120.0])
        df = pd.DataFrame({"close_price": close})
        fwd = build_forward_returns(df)
        assert set(fwd.keys()) == {"7d", "1d", "30d"}
        expected_1d = np.log(close.shift(-1) / close)
        pd.testing.assert_series_equal(fwd["1d"], expected_1d.rename("fwd_return_1d"))

    def test_primary_horizon_is_7d_first(self):
        close = pd.Series(np.arange(50.0) + 100)
        df = pd.DataFrame({"close_price": close})
        fwd = build_forward_returns(df)
        assert next(iter(fwd.keys())) == "7d"


class TestLegacyFactorSetExclusions:
    def test_not_evaluable_list_is_all_nan_on_synthetic_data(self):
        n = 60
        df = pd.DataFrame(
            {
                "structure_trend": ["bullish"] * n,
                "rsi_14": np.linspace(30, 70, n),
                "macd_histogram": np.linspace(-10, 10, n),
                "cvd_trend": ["rising"] * n,
                "oi_delta_pct": [np.nan] * n,
                "close_price": np.linspace(100, 200, n),
                "ema_20": np.linspace(95, 195, n),
                "ema_50": np.linspace(90, 190, n),
                "ema_200": np.linspace(80, 180, n),
                "adx_14": np.linspace(15, 35, n),
                "plus_di": np.linspace(10, 30, n),
                "minus_di": np.linspace(10, 30, n),
                "vwap": np.linspace(95, 195, n),
                "basis_pct": [np.nan] * n,
                "positioning_score": [np.nan] * n,
                "avg_depth_imbalance": [np.nan] * n,
                "put_call_oi_ratio": [np.nan] * n,
                "macro_regime": [np.nan] * n,
                "avg_funding_rate_pct": [np.nan] * n,
                "sentiment_classification": [np.nan] * n,
                "candle_open_time": pd.date_range("2024-01-01", periods=n, freq="D"),
            }
        )
        factors = build_legacy_factor_set(df)
        for f in LEGACY_NOT_EVALUABLE:
            assert factors[f].isna().all()
        for f in LEGACY_EVALUABLE:
            assert factors[f].notna().any()


class TestNewCandidateFactorSet:
    def test_produces_six_named_columns(self):
        n = 80
        rng = np.random.default_rng(4)
        df = pd.DataFrame(
            {
                "close_price": 100 + np.cumsum(rng.normal(size=n)),
                "cvd_delta": rng.normal(size=n),
            }
        )
        result = build_new_candidate_factor_set(df)
        assert list(result.columns) == ["mom_1d", "mom_7d", "mom_14d", "percent_b", "bandwidth", "cvd_zscore"]
        assert len(result) == n


class TestEndToEndSmokeSynthetic:
    """Runs the full summarize_side() pipeline (walk-forward + evaluate_features
    + diagnostics) on a small synthetic dataset -- proves the orchestration
    code works end to end without depending on the real snapshot file."""

    def test_summarize_side_runs_end_to_end(self):
        n = 150
        rng = np.random.default_rng(5)
        idx = pd.date_range("2024-01-01", periods=n, freq="D")
        signal = rng.normal(size=n)
        features = pd.DataFrame(
            {
                "f1": signal + rng.normal(scale=0.1, size=n),
                "f2": rng.normal(size=n),
            },
            index=idx,
        )
        forward_returns = {"7d": pd.Series(signal * 1.2 + rng.normal(scale=0.5, size=n), index=idx)}

        # Patch CV params locally via monkeypatch-free small n_splits for speed.
        import src.benchmark_production as bp

        original_splits = bp.CV_N_SPLITS, bp.CV_TRAIN_SIZE, bp.CV_TEST_SIZE, bp.CV_PURGE_WINDOW, bp.CV_EMBARGO_WINDOW
        bp.CV_N_SPLITS, bp.CV_TRAIN_SIZE, bp.CV_TEST_SIZE, bp.CV_PURGE_WINDOW, bp.CV_EMBARGO_WINDOW = 3, 40, 20, 2, 1
        try:
            result = summarize_side(features, forward_returns, "TEST")
        finally:
            (
                bp.CV_N_SPLITS,
                bp.CV_TRAIN_SIZE,
                bp.CV_TEST_SIZE,
                bp.CV_PURGE_WINDOW,
                bp.CV_EMBARGO_WINDOW,
            ) = original_splits

        assert result.label == "TEST"
        assert len(result.report.fold_results) == 3
        assert not np.isnan(result.multicollinearity_index)
        assert result.nominal_dim == 2.0


@pytest.mark.skipif(not DATA_PATH.exists(), reason="btc_1d_trainval_snapshot.csv not present")
class TestEndToEndSmokeRealSnapshot:
    def test_load_snapshot(self):
        df = load_snapshot()
        assert len(df) == 201
        assert df["candle_open_time"].is_monotonic_increasing

    def test_main_runs_and_writes_report(self, tmp_path, monkeypatch):
        import src.benchmark_production as bp

        report_path = tmp_path / "BENCHMARK_RESULTS.md"
        monkeypatch.setattr(bp, "REPORT_PATH", report_path)

        main()

        assert report_path.exists()
        content = report_path.read_text(encoding="utf-8")
        assert "DISCLAIMER" in content
        assert "statistically valid migration decision" in content
        for f in LEGACY_NOT_EVALUABLE:
            assert f in content
