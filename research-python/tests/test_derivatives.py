from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.features.derivatives import funding_persistence, funding_zscore, oi_volume_ratio
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
