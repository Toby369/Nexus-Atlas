from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.features.volatility import atr, atr_ratio, bollinger_bands, garman_klass_volatility, true_range
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


class TestTrueRange:
    def test_matches_max_of_three_terms(self, synthetic_ohlc):
        tr = true_range(synthetic_ohlc)
        high, low, close = synthetic_ohlc["high"], synthetic_ohlc["low"], synthetic_ohlc["close"]
        prev_close = close.shift(1)
        expected = pd.concat(
            [high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1
        ).max(axis=1)
        expected.iloc[0] = np.nan
        pd.testing.assert_series_equal(tr.rename(None), expected.rename(None))

    def test_first_bar_is_nan(self, synthetic_ohlc):
        tr = true_range(synthetic_ohlc)
        assert np.isnan(tr.iloc[0])

    def test_missing_column_raises(self, synthetic_ohlc):
        with pytest.raises(ValueError):
            true_range(synthetic_ohlc.drop(columns=["low"]))


class TestAtrNoLookahead:
    def test_truncation(self, synthetic_ohlc):
        assert_no_lookahead_on_truncation(
            lambda df: atr(df, period=14), synthetic_ohlc, cutoff_pos=100
        )

    def test_future_perturbation(self, synthetic_ohlc):
        assert_no_lookahead_on_future_perturbation(
            lambda df: atr(df, period=14), synthetic_ohlc, cutoff_pos=100
        )

    def test_nan_region_and_non_negative(self, synthetic_ohlc):
        result = atr(synthetic_ohlc, period=14)
        # true_range is NaN at bar 0, so the first full window of 14
        # consecutive valid TR values ends at bar 14 (0-indexed), not 13.
        assert result.iloc[:14].isna().all()
        assert (result.iloc[14:].dropna() >= 0).all()

    def test_known_values_constant_range(self):
        # Constant high-low range, flat close-to-close -> True Range is
        # constant after bar 0, so ATR converges to exactly that constant.
        idx = make_datetime_index(30, freq="h")
        ohlc = pd.DataFrame(
            {
                "open": [100.0] * 30,
                "high": [105.0] * 30,
                "low": [95.0] * 30,
                "close": [100.0] * 30,
            },
            index=idx,
        )
        result = atr(ohlc, period=14)
        assert result.iloc[14:].dropna().apply(lambda v: v == pytest.approx(10.0)).all()


class TestAtrRatioNoLookahead:
    def test_truncation(self, synthetic_ohlc):
        assert_no_lookahead_on_truncation(
            lambda df: atr_ratio(df, period=14, sma_window=20), synthetic_ohlc, cutoff_pos=150
        )

    def test_future_perturbation(self, synthetic_ohlc):
        assert_no_lookahead_on_future_perturbation(
            lambda df: atr_ratio(df, period=14, sma_window=20), synthetic_ohlc, cutoff_pos=150
        )

    def test_constant_atr_ratio_is_one(self):
        idx = make_datetime_index(60, freq="h")
        ohlc = pd.DataFrame(
            {
                "open": [100.0] * 60,
                "high": [105.0] * 60,
                "low": [95.0] * 60,
                "close": [100.0] * 60,
            },
            index=idx,
        )
        result = atr_ratio(ohlc, period=14, sma_window=20)
        # ATR is constant once seeded, so ATR / SMA(ATR) must be exactly 1.
        assert result.dropna().apply(lambda v: v == pytest.approx(1.0)).all()

    def test_nan_region_covers_both_warmups(self, synthetic_ohlc):
        result = atr_ratio(synthetic_ohlc, period=14, sma_window=20)
        # ATR itself is NaN for its first 14 bars (see TestAtrNoLookahead);
        # atr_ratio then needs another 20-bar SMA warm-up on top of that.
        assert result.iloc[: 14 + 20 - 1].isna().all()
        assert result.iloc[14 + 20 :].notna().all()
