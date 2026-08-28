from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.features.momentum import adx, log_return, return_momentum
from tests.lookahead_utils import (
    assert_no_lookahead_on_future_perturbation,
    assert_no_lookahead_on_truncation,
    make_datetime_index,
)


@pytest.fixture
def synthetic_ohlc() -> pd.DataFrame:
    rng = np.random.default_rng(99)
    n = 150
    idx = make_datetime_index(n, freq="h")

    close = 60000 + np.cumsum(rng.normal(0, 40, size=n))
    open_ = close + rng.normal(0, 15, size=n)
    high = np.maximum(open_, close) + np.abs(rng.normal(0, 25, size=n))
    low = np.minimum(open_, close) - np.abs(rng.normal(0, 25, size=n))

    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close}, index=idx)


@pytest.fixture
def synthetic_price() -> pd.Series:
    rng = np.random.default_rng(3)
    n = 100
    return pd.Series(
        60000 + np.cumsum(rng.normal(0, 40, size=n)), index=make_datetime_index(n, freq="h")
    )


def _reference_adx(ohlc: pd.DataFrame, period: int) -> pd.DataFrame:
    """Independent, deliberately differently-structured reference
    implementation of Wilder's ADX (classic *sum*-based recursion, per the
    1978 original, rather than the average-form recursion used in
    src/features/momentum.py). Used only to cross-check the production
    implementation in tests -- not imported by production code.
    """
    high = ohlc["high"].to_numpy(dtype=float)
    low = ohlc["low"].to_numpy(dtype=float)
    close = ohlc["close"].to_numpy(dtype=float)
    n = len(ohlc)

    tr = np.full(n, np.nan)
    plus_dm = np.full(n, np.nan)
    minus_dm = np.full(n, np.nan)
    for t in range(1, n):
        tr[t] = max(high[t] - low[t], abs(high[t] - close[t - 1]), abs(low[t] - close[t - 1]))
        up = high[t] - high[t - 1]
        down = low[t - 1] - low[t]
        plus_dm[t] = up if (up > down and up > 0) else 0.0
        minus_dm[t] = down if (down > up and down > 0) else 0.0

    def wilder_sum_smooth(x: np.ndarray) -> np.ndarray:
        out = np.full(n, np.nan)
        # first valid index is 1 (index 0 is NaN from diff/TR)
        seed_end = 1 + period - 1
        if seed_end >= n:
            return out
        s = np.sum(x[1 : 1 + period])
        out[seed_end] = s
        for t in range(seed_end + 1, n):
            s = s - s / period + x[t]
            out[t] = s
        return out

    smoothed_tr = wilder_sum_smooth(tr)
    smoothed_plus_dm = wilder_sum_smooth(plus_dm)
    smoothed_minus_dm = wilder_sum_smooth(minus_dm)

    plus_di = 100.0 * smoothed_plus_dm / smoothed_tr
    minus_di = 100.0 * smoothed_minus_dm / smoothed_tr
    dx = 100.0 * np.abs(plus_di - minus_di) / (plus_di + minus_di)

    # ADX = Wilder-smooth(DX) using the SUM form again, seeded on the first
    # `period` valid DX values (average = sum/period so we divide at the end).
    first_dx_idx = np.argmax(~np.isnan(dx))
    adx_out = np.full(n, np.nan)
    seed_end = first_dx_idx + period - 1
    if seed_end < n and not np.isnan(dx[first_dx_idx : seed_end + 1]).any():
        s = np.sum(dx[first_dx_idx : seed_end + 1])
        adx_out[seed_end] = s / period
        for t in range(seed_end + 1, n):
            if np.isnan(dx[t]) or np.isnan(adx_out[t - 1]):
                continue
            avg_prev = adx_out[t - 1]
            avg_prev_sum = avg_prev * period
            s = avg_prev_sum - avg_prev_sum / period + dx[t]
            adx_out[t] = s / period

    return pd.DataFrame(
        {"plus_di": plus_di, "minus_di": minus_di, "dx": dx, "adx": adx_out}, index=ohlc.index
    )


class TestAdxCorrectness:
    def test_matches_independent_reference_implementation(self, synthetic_ohlc):
        period = 5
        result = adx(synthetic_ohlc.iloc[:40], period=period)
        reference = _reference_adx(synthetic_ohlc.iloc[:40], period=period)

        pd.testing.assert_series_equal(result["plus_di"], reference["plus_di"], check_exact=False, rtol=1e-9)
        pd.testing.assert_series_equal(result["minus_di"], reference["minus_di"], check_exact=False, rtol=1e-9)
        pd.testing.assert_series_equal(result["dx"], reference["dx"], check_exact=False, rtol=1e-9)
        pd.testing.assert_series_equal(result["adx"], reference["adx"], check_exact=False, rtol=1e-9)

    def test_di_and_adx_bounded_0_100(self, synthetic_ohlc):
        result = adx(synthetic_ohlc, period=14)
        valid = result.dropna()
        assert (valid["plus_di"] >= 0).all()
        assert (valid["minus_di"] >= 0).all()
        assert ((valid["adx"] >= 0) & (valid["adx"] <= 100)).all()


class TestAdxNoLookahead:
    def test_truncation(self, synthetic_ohlc):
        assert_no_lookahead_on_truncation(lambda df: adx(df, period=14), synthetic_ohlc, cutoff_pos=100)

    def test_future_perturbation(self, synthetic_ohlc):
        assert_no_lookahead_on_future_perturbation(
            lambda df: adx(df, period=14), synthetic_ohlc, cutoff_pos=100
        )

    def test_missing_column_raises(self, synthetic_ohlc):
        with pytest.raises(ValueError):
            adx(synthetic_ohlc.drop(columns=["high"]))


class TestReturnMomentumNoLookahead:
    def test_truncation(self, synthetic_price):
        assert_no_lookahead_on_truncation(
            lambda s: return_momentum(s, bar_interval_hours=1.0), synthetic_price, cutoff_pos=50
        )

    def test_future_perturbation(self, synthetic_price):
        assert_no_lookahead_on_future_perturbation(
            lambda s: return_momentum(s, bar_interval_hours=1.0), synthetic_price, cutoff_pos=50
        )

    def test_matches_manual_log_return(self, synthetic_price):
        result = return_momentum(synthetic_price, bar_interval_hours=1.0, horizons_hours=(1.0, 4.0, 24.0))
        manual_1h = np.log(synthetic_price / synthetic_price.shift(1))
        pd.testing.assert_series_equal(
            result["log_return_1h"], manual_1h.rename("log_return_1h"), check_exact=False
        )

    def test_non_hourly_bar_interval(self, synthetic_price):
        # 4h bars: a "4h" horizon should resolve to 1 bar, "24h" to 6 bars.
        result = return_momentum(synthetic_price, bar_interval_hours=4.0, horizons_hours=(4.0, 24.0))
        pd.testing.assert_series_equal(
            result["log_return_4h"], log_return(synthetic_price, periods=1).rename("log_return_4h")
        )
        pd.testing.assert_series_equal(
            result["log_return_24h"], log_return(synthetic_price, periods=6).rename("log_return_24h")
        )

    def test_log_return_rejects_negative_periods(self, synthetic_price):
        with pytest.raises(ValueError):
            log_return(synthetic_price, periods=0)
