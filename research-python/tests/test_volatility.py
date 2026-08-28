from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.features.volatility import bollinger_bands, garman_klass_volatility
from tests.lookahead_utils import (
    assert_no_lookahead_on_future_perturbation,
    assert_no_lookahead_on_truncation,
    make_datetime_index,
)


@pytest.fixture
def synthetic_ohlc() -> pd.DataFrame:
    rng = np.random.default_rng(11)
    n = 200
    idx = make_datetime_index(n, freq="h")

    close = 60000 + np.cumsum(rng.normal(0, 50, size=n))
    open_ = close + rng.normal(0, 20, size=n)
    high = np.maximum(open_, close) + np.abs(rng.normal(0, 30, size=n))
    low = np.minimum(open_, close) - np.abs(rng.normal(0, 30, size=n))

    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close}, index=idx)


class TestGarmanKlassNoLookahead:
    def test_truncation(self, synthetic_ohlc):
        assert_no_lookahead_on_truncation(
            lambda df: garman_klass_volatility(df, window=24), synthetic_ohlc, cutoff_pos=100
        )

    def test_future_perturbation(self, synthetic_ohlc):
        assert_no_lookahead_on_future_perturbation(
            lambda df: garman_klass_volatility(df, window=24), synthetic_ohlc, cutoff_pos=100
        )

    def test_nan_region_and_non_negative(self, synthetic_ohlc):
        vol = garman_klass_volatility(synthetic_ohlc, window=24)
        assert vol.iloc[:23].isna().all()
        assert (vol.iloc[23:].dropna() >= 0).all()

    def test_annualize_requires_periods_per_year(self, synthetic_ohlc):
        with pytest.raises(ValueError):
            garman_klass_volatility(synthetic_ohlc, window=24, annualize=True)

    def test_annualize_scales_correctly(self, synthetic_ohlc):
        raw = garman_klass_volatility(synthetic_ohlc, window=24, annualize=False)
        annualized = garman_klass_volatility(
            synthetic_ohlc, window=24, annualize=True, periods_per_year=24 * 365
        )
        factor = np.sqrt(24 * 365)
        pd.testing.assert_series_equal(
            (raw * factor).rename(annualized.name), annualized, check_exact=False
        )

    def test_missing_column_raises(self, synthetic_ohlc):
        with pytest.raises(ValueError):
            garman_klass_volatility(synthetic_ohlc.drop(columns=["low"]))


class TestBollingerBandsNoLookahead:
    def test_truncation(self, synthetic_ohlc):
        close = synthetic_ohlc["close"]
        assert_no_lookahead_on_truncation(
            lambda s: bollinger_bands(s, window=20, num_std=2.0), close, cutoff_pos=100
        )

    def test_future_perturbation(self, synthetic_ohlc):
        close = synthetic_ohlc["close"]
        assert_no_lookahead_on_future_perturbation(
            lambda s: bollinger_bands(s, window=20, num_std=2.0), close, cutoff_pos=100
        )

    def test_bandwidth_positive_and_percent_b_matches_definition(self, synthetic_ohlc):
        close = synthetic_ohlc["close"]
        bb = bollinger_bands(close, window=20, num_std=2.0)
        valid = bb.dropna()
        assert (valid["bandwidth"] > 0).all()

        recomputed_percent_b = (close.loc[valid.index] - valid["lower"]) / (
            valid["upper"] - valid["lower"]
        )
        pd.testing.assert_series_equal(
            recomputed_percent_b.rename("percent_b"), valid["percent_b"], check_exact=False
        )

    def test_nan_region_matches_window(self, synthetic_ohlc):
        close = synthetic_ohlc["close"]
        bb = bollinger_bands(close, window=20)
        assert bb["middle"].iloc[:19].isna().all()
        assert bb["middle"].iloc[19:].notna().all()
