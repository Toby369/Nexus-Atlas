from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.features.mean_reversion import (
    distance_to_ma_zscore,
    distance_to_ma_zscore_multi,
    rsi_wilder,
)
from tests.lookahead_utils import (
    assert_no_lookahead_on_future_perturbation,
    assert_no_lookahead_on_truncation,
    make_datetime_index,
)


@pytest.fixture
def close_series() -> pd.Series:
    rng = np.random.default_rng(23)
    n = 300
    price = 60000 + np.cumsum(rng.normal(0, 40, size=n))
    return pd.Series(price, index=make_datetime_index(n, freq="h"), name="close")


class TestRsiWilderNoLookahead:
    def test_truncation(self, close_series):
        assert_no_lookahead_on_truncation(
            lambda s: rsi_wilder(s, period=14), close_series, cutoff_pos=200
        )

    def test_future_perturbation(self, close_series):
        assert_no_lookahead_on_future_perturbation(
            lambda s: rsi_wilder(s, period=14), close_series, cutoff_pos=200
        )

    def test_nan_region_matches_period(self, close_series):
        rsi = rsi_wilder(close_series, period=14)
        # delta has a leading NaN (bar 0), so the first full 14-value window
        # of gain/loss is seeded at bar 14 (0-indexed), same offset pattern
        # as ATR (see test_volatility.py::TestAtrNoLookahead).
        assert rsi.iloc[:14].isna().all()
        assert rsi.iloc[14:].notna().all()

    def test_bounded_0_to_100(self, close_series):
        rsi = rsi_wilder(close_series, period=14)
        valid = rsi.dropna()
        assert (valid >= 0).all()
        assert (valid <= 100).all()

    def test_pure_uptrend_is_100(self):
        idx = make_datetime_index(30, freq="h")
        price = pd.Series(100.0 + 2.0 * np.arange(30), index=idx)
        rsi = rsi_wilder(price, period=14)
        assert rsi.iloc[14:].dropna().apply(lambda v: v == pytest.approx(100.0)).all()

    def test_pure_downtrend_is_0(self):
        idx = make_datetime_index(30, freq="h")
        price = pd.Series(1000.0 - 2.0 * np.arange(30), index=idx)
        rsi = rsi_wilder(price, period=14)
        assert rsi.iloc[14:].dropna().apply(lambda v: v == pytest.approx(0.0)).all()

    def test_flat_price_is_50(self):
        idx = make_datetime_index(30, freq="h")
        price = pd.Series([1000.0] * 30, index=idx)
        rsi = rsi_wilder(price, period=14)
        assert rsi.iloc[14:].dropna().apply(lambda v: v == pytest.approx(50.0)).all()

    def test_rejects_non_positive_period(self, close_series):
        with pytest.raises(ValueError):
            rsi_wilder(close_series, period=0)


class TestDistanceToMaZscoreNoLookahead:
    def test_truncation(self, close_series):
        assert_no_lookahead_on_truncation(
            lambda s: distance_to_ma_zscore(s, window=20), close_series, cutoff_pos=150
        )

    def test_future_perturbation(self, close_series):
        assert_no_lookahead_on_future_perturbation(
            lambda s: distance_to_ma_zscore(s, window=20), close_series, cutoff_pos=150
        )

    def test_nan_region_matches_window(self, close_series):
        z = distance_to_ma_zscore(close_series, window=20)
        assert z.iloc[:19].isna().all()
        assert z.iloc[19:].notna().all()

    def test_flat_price_zero_std_is_nan_not_zero(self):
        idx = make_datetime_index(25, freq="h")
        price = pd.Series([100.0] * 25, index=idx)
        z = distance_to_ma_zscore(price, window=20)
        # Flat series -> std == 0 at every fully-windowed point -> NaN
        # (division-by-zero guarded), not a fabricated 0.
        assert z.iloc[19:].isna().all()

    def test_known_zscore_value(self):
        # Window [10, 20, 30, 40, 50]: mean=30, population std=sqrt(200)=~14.142.
        # Last value 50 -> z = (50-30)/14.142... = 1.41421356...
        idx = make_datetime_index(5, freq="h")
        price = pd.Series([10.0, 20.0, 30.0, 40.0, 50.0], index=idx)
        z = distance_to_ma_zscore(price, window=5, ddof=0)
        expected = (50.0 - 30.0) / np.sqrt(200.0)
        assert z.iloc[-1] == pytest.approx(expected)

    def test_rejects_window_below_2(self, close_series):
        with pytest.raises(ValueError):
            distance_to_ma_zscore(close_series, window=1)


class TestDistanceToMaZscoreMulti:
    def test_produces_one_column_per_window(self, close_series):
        result = distance_to_ma_zscore_multi(close_series, windows=(20, 50, 200))
        assert list(result.columns) == ["dist_zscore_sma20", "dist_zscore_sma50", "dist_zscore_sma200"]

    def test_matches_individual_calls(self, close_series):
        result = distance_to_ma_zscore_multi(close_series, windows=(20, 50))
        individual_20 = distance_to_ma_zscore(close_series, window=20)
        individual_50 = distance_to_ma_zscore(close_series, window=50)
        pd.testing.assert_series_equal(
            result["dist_zscore_sma20"], individual_20.rename("dist_zscore_sma20")
        )
        pd.testing.assert_series_equal(
            result["dist_zscore_sma50"], individual_50.rename("dist_zscore_sma50")
        )
