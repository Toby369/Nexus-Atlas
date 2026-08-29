from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.features.trend import linreg_trend
from tests.lookahead_utils import (
    assert_no_lookahead_on_future_perturbation,
    assert_no_lookahead_on_truncation,
    make_datetime_index,
)


@pytest.fixture
def price_series() -> pd.Series:
    rng = np.random.default_rng(11)
    n = 200
    # Random walk with a mild upward drift so the slope has something
    # non-trivial to detect.
    steps = rng.normal(loc=5.0, scale=50.0, size=n)
    price = 30000.0 + np.cumsum(steps)
    return pd.Series(price, index=make_datetime_index(n, freq="h"), name="close")


class TestLinregTrendNoLookahead:
    def test_truncation(self, price_series):
        assert_no_lookahead_on_truncation(
            lambda s: linreg_trend(s, window=20), price_series, cutoff_pos=150
        )

    def test_future_perturbation(self, price_series):
        assert_no_lookahead_on_future_perturbation(
            lambda s: linreg_trend(s, window=20), price_series, cutoff_pos=150
        )

    def test_nan_region_matches_window(self, price_series):
        result = linreg_trend(price_series, window=20)
        assert result["slope"].iloc[:19].isna().all()
        assert result["slope"].iloc[19:].notna().all()
        assert result["r2"].iloc[:19].isna().all()
        assert result["r2"].iloc[19:].notna().all()


class TestLinregTrendCorrectness:
    def test_perfect_uptrend_slope_and_r2(self):
        # y = 100 + 2*x exactly -> slope must be exactly 2, R^2 exactly 1.
        idx = make_datetime_index(30, freq="h")
        price = pd.Series(100.0 + 2.0 * np.arange(30), index=idx)
        result = linreg_trend(price, window=10)
        last = result.iloc[-1]
        assert last["slope"] == pytest.approx(2.0, abs=1e-9)
        assert last["r2"] == pytest.approx(1.0, abs=1e-9)

    def test_perfect_downtrend_slope_and_r2(self):
        idx = make_datetime_index(30, freq="h")
        price = pd.Series(500.0 - 3.0 * np.arange(30), index=idx)
        result = linreg_trend(price, window=10)
        last = result.iloc[-1]
        assert last["slope"] == pytest.approx(-3.0, abs=1e-9)
        assert last["r2"] == pytest.approx(1.0, abs=1e-9)

    def test_flat_price_slope_zero(self):
        idx = make_datetime_index(30, freq="h")
        price = pd.Series([1000.0] * 30, index=idx)
        result = linreg_trend(price, window=10)
        # A perfectly flat window has zero variance in y -> slope is 0/var_x
        # = 0 (well-defined, x still varies), but corr(x,y) is undefined
        # (0/0) since y has no variance -- R^2 must be NaN, not fabricated.
        last = result.iloc[-1]
        assert last["slope"] == pytest.approx(0.0, abs=1e-9)
        assert np.isnan(last["r2"])

    def test_noisy_data_r2_between_0_and_1(self, price_series):
        result = linreg_trend(price_series, window=20)
        valid_r2 = result["r2"].dropna()
        assert (valid_r2 >= -1e-9).all()
        assert (valid_r2 <= 1.0 + 1e-9).all()

    def test_rejects_window_below_2(self, price_series):
        with pytest.raises(ValueError):
            linreg_trend(price_series, window=1)

    def test_rejects_unsorted_index(self, price_series):
        broken = price_series.iloc[np.random.default_rng(0).permutation(len(price_series))]
        with pytest.raises(ValueError):
            linreg_trend(broken, window=20)
