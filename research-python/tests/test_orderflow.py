from __future__ import annotations

import numpy as np
import pandas as pd

from src.signals.orderflow import (
    classify_cvd_trend,
    compute_cvd_delta,
    compute_day_anchored_vwap,
    compute_orderflow_signals,
)
from tests.lookahead_utils import assert_no_lookahead_on_truncation, make_datetime_index


class TestComputeCvdDelta:
    def test_matches_formula(self):
        idx = make_datetime_index(3, freq="15min")
        volume = pd.Series([100.0, 200.0, 50.0], index=idx)
        taker_buy = pd.Series([60.0, 80.0, 50.0], index=idx)
        result = compute_cvd_delta(volume, taker_buy)
        expected = pd.Series([20.0, -40.0, 50.0], index=idx, name="cvd_delta")
        pd.testing.assert_series_equal(result, expected)


class TestClassifyCvdTrend:
    def test_rising_when_cumulative_change_exceeds_flat_threshold(self):
        # Konstant positive Deltas -> eindeutig steigend, klar ueber der
        # Flat-Schwelle (0.5x mittlerer Betrag).
        idx = make_datetime_index(10, freq="15min")
        delta = pd.Series([10.0] * 10, index=idx)
        result = classify_cvd_trend(delta, lookback=5)
        assert result.iloc[5] == "rising"

    def test_falling_when_cumulative_change_negative(self):
        idx = make_datetime_index(10, freq="15min")
        delta = pd.Series([-10.0] * 10, index=idx)
        result = classify_cvd_trend(delta, lookback=5)
        assert result.iloc[5] == "falling"

    def test_flat_when_deltas_oscillate_around_zero(self):
        # lookback=4 (gerade Zahl): Paare +10/-10 heben sich ueber genau 4
        # Bars vollstaendig auf -> cumulative-Aenderung = 0, klar unter der
        # Flat-Schwelle (0.5x mittlerer Betrag = 5).
        idx = make_datetime_index(10, freq="15min")
        delta = pd.Series([10.0, -10.0] * 5, index=idx)
        result = classify_cvd_trend(delta, lookback=4)
        assert result.iloc[5] == "flat"

    def test_none_during_warmup(self):
        idx = make_datetime_index(3, freq="15min")
        delta = pd.Series([1.0, 2.0, 3.0], index=idx)
        result = classify_cvd_trend(delta, lookback=5)
        assert result.iloc[0] is None


class TestComputeDayAnchoredVwap:
    def test_resets_at_day_boundary(self):
        idx = pd.DatetimeIndex(
            ["2025-01-01 23:00", "2025-01-01 23:15", "2025-01-02 00:00", "2025-01-02 00:15"], tz="UTC"
        )
        ohlc = pd.DataFrame(
            {"high": [101, 101, 200, 200], "low": [99, 99, 198, 198], "close": [100, 100, 199, 199],
             "volume": [10.0, 10.0, 10.0, 10.0]},
            index=idx,
        )
        result = compute_day_anchored_vwap(ohlc)
        # Zweiter Tag beginnt bei ~199 (nicht durch den ersten Tag ~100 verzerrt).
        assert result.iloc[2] > 150

    def test_cumulative_within_day_is_volume_weighted_average(self):
        idx = pd.DatetimeIndex(["2025-01-01 00:00", "2025-01-01 00:15"], tz="UTC")
        ohlc = pd.DataFrame(
            {"high": [101.0, 111.0], "low": [99.0, 109.0], "close": [100.0, 110.0], "volume": [1.0, 3.0]},
            index=idx,
        )
        result = compute_day_anchored_vwap(ohlc)
        # Bar2 typical=110, cum_pv=(100*1+110*3), cum_vol=4 -> vwap=(100+330)/4=107.5
        assert result.iloc[1] == pytest_approx(107.5)


def pytest_approx(value):
    import pytest

    return pytest.approx(value, rel=1e-9)


class TestComputeOrderflowSignals:
    def test_output_columns_boolean_and_never_nan(self):
        rng = np.random.default_rng(9)
        n = 60
        idx = make_datetime_index(n, freq="15min")
        walk = 100 + np.cumsum(rng.normal(0, 1.0, n))
        ohlc = pd.DataFrame(
            {
                "open": walk, "high": walk + 1.0, "low": walk - 1.0, "close": walk,
                "volume": rng.uniform(10, 100, n),
                "taker_buy_base_vol": rng.uniform(5, 50, n),
            },
            index=idx,
        )
        result = compute_orderflow_signals(ohlc)
        for col in ["cvd_bullish", "cvd_bearish", "vwap_above", "vwap_below"]:
            assert result[col].dtype == bool
            assert result[col].notna().all()
        # Bullish/Bearish duerfen nie gleichzeitig wahr sein.
        assert not (result["cvd_bullish"] & result["cvd_bearish"]).any()
        assert not (result["vwap_above"] & result["vwap_below"]).any()


class TestOrderflowNoLookahead:
    def test_truncation_reproduces_historical_labels(self):
        rng = np.random.default_rng(17)
        n = 80
        idx = make_datetime_index(n, freq="15min")
        walk = 100 + np.cumsum(rng.normal(0, 1.0, n))
        ohlc = pd.DataFrame(
            {
                "open": walk, "high": walk + 1.0, "low": walk - 1.0, "close": walk,
                "volume": rng.uniform(10, 100, n),
                "taker_buy_base_vol": rng.uniform(5, 50, n),
            },
            index=idx,
        )
        assert_no_lookahead_on_truncation(compute_orderflow_signals, ohlc, cutoff_pos=60)
