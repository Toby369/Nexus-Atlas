from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.features.derivatives import (
    cvd_zscore,
    funding_persistence,
    funding_zscore,
    oi_price_change_matrix,
    oi_volume_ratio,
)
from tests.lookahead_utils import (
    assert_no_lookahead_on_future_perturbation,
    assert_no_lookahead_on_truncation,
    make_datetime_index,
)


@pytest.fixture
def funding_rate_series() -> pd.Series:
    rng = np.random.default_rng(42)
    n = 300
    # Mean-reverting-ish synthetic funding rate with a few explicit long runs
    # of one sign, so funding_persistence has something non-trivial to count.
    values = rng.normal(loc=0.0, scale=0.0004, size=n)
    values[50:65] = np.abs(values[50:65]) + 0.0001   # forced positive run
    values[100:110] = -np.abs(values[100:110]) - 0.0001  # forced negative run
    values[150] = 0.0  # explicit zero to exercise the sign(0) edge case
    return pd.Series(values, index=make_datetime_index(n, freq="8h"), name="funding_rate")


@pytest.fixture
def oi_and_volume() -> tuple[pd.Series, pd.Series]:
    rng = np.random.default_rng(7)
    n = 200
    idx = make_datetime_index(n, freq="h")
    volume = pd.Series(rng.uniform(100, 1000, size=n), index=idx, name="volume")
    oi = pd.Series(rng.uniform(1e8, 5e8, size=n), index=idx, name="open_interest_usd")
    return oi, volume


class TestFundingZScoreNoLookahead:
    def test_truncation(self, funding_rate_series):
        assert_no_lookahead_on_truncation(
            lambda s: funding_zscore(s, window=90), funding_rate_series, cutoff_pos=200
        )

    def test_future_perturbation(self, funding_rate_series):
        assert_no_lookahead_on_future_perturbation(
            lambda s: funding_zscore(s, window=90), funding_rate_series, cutoff_pos=200
        )

    def test_nan_region_matches_min_periods(self, funding_rate_series):
        z = funding_zscore(funding_rate_series, window=90)
        assert z.iloc[:89].isna().all()
        assert z.iloc[89:].notna().all()

    def test_rejects_unsorted_index(self, funding_rate_series):
        # Permute row order so the DatetimeIndex itself is no longer
        # monotonically increasing -- this must be rejected explicitly
        # rather than silently producing a wrong rolling window.
        broken = funding_rate_series.iloc[np.random.default_rng(0).permutation(len(funding_rate_series))]
        with pytest.raises(ValueError):
            funding_zscore(broken, window=90)


class TestFundingPersistenceNoLookahead:
    def test_truncation(self, funding_rate_series):
        assert_no_lookahead_on_truncation(
            funding_persistence, funding_rate_series, cutoff_pos=180
        )

    def test_future_perturbation(self, funding_rate_series):
        assert_no_lookahead_on_future_perturbation(
            funding_persistence, funding_rate_series, cutoff_pos=180
        )

    def test_known_streaks(self):
        # Hand-verifiable short sequence: signs are + + + - - + 0 + +
        fr = pd.Series(
            [0.001, 0.002, 0.0005, -0.001, -0.0002, 0.003, 0.0, 0.001, 0.004],
            index=make_datetime_index(9, freq="8h"),
        )
        result = funding_persistence(fr)
        expected = [1, 2, 3, 1, 2, 1, 0, 1, 2]
        assert result.tolist() == expected

    def test_zero_resets_streak(self):
        fr = pd.Series([0.001, 0.001, 0.0, 0.001], index=make_datetime_index(4, freq="8h"))
        result = funding_persistence(fr)
        assert result.tolist() == [1, 2, 0, 1]


class TestOiVolumeRatioNoLookahead:
    def test_truncation(self, oi_and_volume):
        oi, volume = oi_and_volume

        def compute(_):
            return oi_volume_ratio(oi, volume, window=24)

        # oi_volume_ratio takes two series; wrap so the generic truncation
        # helper (which only truncates its single `full_input` argument) still
        # applies by truncating both together via a combined DataFrame.
        combined = pd.DataFrame({"oi": oi, "volume": volume})

        def compute_from_df(df):
            return oi_volume_ratio(df["oi"], df["volume"], window=24)

        assert_no_lookahead_on_truncation(compute_from_df, combined, cutoff_pos=100)

    def test_future_perturbation(self, oi_and_volume):
        oi, volume = oi_and_volume
        combined = pd.DataFrame({"oi": oi, "volume": volume})

        def compute_from_df(df):
            return oi_volume_ratio(df["oi"], df["volume"], window=24)

        assert_no_lookahead_on_future_perturbation(compute_from_df, combined, cutoff_pos=100)

    def test_zero_volume_is_nan_not_inf(self):
        idx = make_datetime_index(30, freq="h")
        volume = pd.Series([0.0] * 30, index=idx)
        oi = pd.Series([1000.0] * 30, index=idx)
        ratio = oi_volume_ratio(oi, volume, window=24)
        assert not np.isinf(ratio.dropna()).any()

    def test_mismatched_index_raises(self, oi_and_volume):
        oi, volume = oi_and_volume
        with pytest.raises(ValueError):
            oi_volume_ratio(oi, volume.iloc[:-1])


@pytest.fixture
def oi_and_price() -> tuple[pd.Series, pd.Series]:
    rng = np.random.default_rng(3)
    n = 100
    idx = make_datetime_index(n, freq="h")
    price = pd.Series(60000 + np.cumsum(rng.normal(0, 40, size=n)), index=idx, name="price")
    oi = pd.Series(2e8 + np.cumsum(rng.normal(0, 1e6, size=n)), index=idx, name="open_interest")
    return oi, price


class TestOiPriceChangeMatrixNoLookahead:
    def test_truncation(self, oi_and_price):
        oi, price = oi_and_price
        combined = pd.DataFrame({"oi": oi, "price": price})

        def compute(df):
            return oi_price_change_matrix(df["oi"], df["price"], window=10)

        assert_no_lookahead_on_truncation(compute, combined, cutoff_pos=60)

    def test_future_perturbation(self, oi_and_price):
        oi, price = oi_and_price
        combined = pd.DataFrame({"oi": oi, "price": price})

        def compute(df):
            return oi_price_change_matrix(df["oi"], df["price"], window=10)

        assert_no_lookahead_on_future_perturbation(compute, combined, cutoff_pos=60)

    def test_quadrants_hand_verified(self):
        idx = make_datetime_index(4, freq="h")
        # window=1: each bar compared to the previous bar only.
        price = pd.Series([100.0, 110.0, 90.0, 80.0], index=idx)  # up, down, down
        oi = pd.Series([1000.0, 1100.0, 1150.0, 1000.0], index=idx)  # up, up, down
        result = oi_price_change_matrix(oi, price, window=1)
        # bar1: price up (100->110), OI up (1000->1100) -> long_buildup
        assert result["quadrant"].iloc[1] == "long_buildup"
        # bar2: price down (110->90), OI up (1100->1150) -> short_buildup
        assert result["quadrant"].iloc[2] == "short_buildup"
        # bar3: price down (90->80), OI down (1150->1000) -> long_unwind
        assert result["quadrant"].iloc[3] == "long_unwind"

    def test_short_covering_quadrant(self):
        idx = make_datetime_index(2, freq="h")
        price = pd.Series([100.0, 110.0], index=idx)  # up
        oi = pd.Series([1000.0, 900.0], index=idx)  # down
        result = oi_price_change_matrix(oi, price, window=1)
        assert result["quadrant"].iloc[1] == "short_covering"

    def test_flat_moves_are_neutral(self):
        idx = make_datetime_index(2, freq="h")
        price = pd.Series([100.0, 100.0], index=idx)
        oi = pd.Series([1000.0, 1000.0], index=idx)
        result = oi_price_change_matrix(oi, price, window=1)
        assert result["quadrant"].iloc[1] == "neutral"

    def test_warmup_region_quadrant_is_nan_not_neutral(self):
        idx = make_datetime_index(5, freq="h")
        price = pd.Series([100.0, 101.0, 102.0, 103.0, 104.0], index=idx)
        oi = pd.Series([1000.0, 1010.0, 1020.0, 1030.0, 1040.0], index=idx)
        result = oi_price_change_matrix(oi, price, window=3)
        assert result["quadrant"].iloc[:3].isna().all()

    def test_rejects_negative_threshold(self, oi_and_price):
        oi, price = oi_and_price
        with pytest.raises(ValueError):
            oi_price_change_matrix(oi, price, window=10, price_flat_threshold_pct=-1.0)

    def test_mismatched_index_raises(self, oi_and_price):
        oi, price = oi_and_price
        with pytest.raises(ValueError):
            oi_price_change_matrix(oi, price.iloc[:-1], window=10)


@pytest.fixture
def cvd_delta_series() -> pd.Series:
    rng = np.random.default_rng(17)
    n = 200
    return pd.Series(rng.normal(0, 500, size=n), index=make_datetime_index(n, freq="h"), name="cvd_delta")


class TestCvdZscoreNoLookahead:
    def test_truncation(self, cvd_delta_series):
        assert_no_lookahead_on_truncation(
            lambda s: cvd_zscore(s, window=48), cvd_delta_series, cutoff_pos=150
        )

    def test_future_perturbation(self, cvd_delta_series):
        assert_no_lookahead_on_future_perturbation(
            lambda s: cvd_zscore(s, window=48), cvd_delta_series, cutoff_pos=150
        )

    def test_nan_region_matches_window(self, cvd_delta_series):
        z = cvd_zscore(cvd_delta_series, window=48)
        assert z.iloc[:47].isna().all()
        assert z.iloc[47:].notna().all()

    def test_constant_series_is_nan_not_inf(self):
        idx = make_datetime_index(60, freq="h")
        cvd = pd.Series([500.0] * 60, index=idx)
        z = cvd_zscore(cvd, window=48)
        assert not np.isinf(z.dropna()).any()
        assert z.iloc[47:].isna().all()
