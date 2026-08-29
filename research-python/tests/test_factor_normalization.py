from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.features.factor_normalization import (
    rolling_zscore,
    soft_discretize,
    soft_factor_matrix,
    zscore_factor_matrix,
)
from tests.lookahead_utils import (
    assert_no_lookahead_on_future_perturbation,
    assert_no_lookahead_on_truncation,
    make_datetime_index,
)


@pytest.fixture
def noisy_series() -> pd.Series:
    rng = np.random.default_rng(7)
    n = 200
    return pd.Series(rng.normal(loc=50.0, scale=15.0, size=n), index=make_datetime_index(n, freq="h"))


class TestRollingZscoreNoLookahead:
    def test_truncation(self, noisy_series):
        assert_no_lookahead_on_truncation(
            lambda s: rolling_zscore(s, window=20), noisy_series, cutoff_pos=150
        )

    def test_future_perturbation(self, noisy_series):
        assert_no_lookahead_on_future_perturbation(
            lambda s: rolling_zscore(s, window=20), noisy_series, cutoff_pos=150
        )

    def test_nan_region_matches_window(self, noisy_series):
        result = rolling_zscore(noisy_series, window=20)
        assert result.iloc[:19].isna().all()
        assert result.iloc[19:].notna().all()


class TestRollingZscoreCorrectness:
    def test_hand_computed_small_example(self):
        # window=3: last window [1, 2, 3] -> mean=2, population std=sqrt(2/3).
        idx = make_datetime_index(3, freq="h")
        series = pd.Series([1.0, 2.0, 3.0], index=idx)
        result = rolling_zscore(series, window=3, ddof=0)
        expected_std = np.sqrt(((np.array([1.0, 2.0, 3.0]) - 2.0) ** 2).mean())
        expected_z = (3.0 - 2.0) / expected_std
        assert result.iloc[-1] == pytest.approx(expected_z, abs=1e-9)

    def test_value_at_the_mean_has_zscore_zero(self):
        series = pd.Series([8.0, 12.0, 10.0], index=make_datetime_index(3, freq="h"))
        result = rolling_zscore(series, window=3)
        assert result.iloc[-1] == pytest.approx(0.0, abs=1e-9)

    def test_constant_window_yields_nan_not_a_blowup(self):
        # Zero variance in the window -> undefined z-score, must be NaN,
        # never a fabricated extreme value (same "no data" philosophy as
        # the rest of this package).
        idx = make_datetime_index(5, freq="h")
        series = pd.Series([42.0] * 5, index=idx)
        result = rolling_zscore(series, window=3)
        assert result.iloc[2:].isna().all()

    def test_rejects_window_below_2(self, noisy_series):
        with pytest.raises(ValueError):
            rolling_zscore(noisy_series, window=1)

    def test_rejects_unsorted_index(self, noisy_series):
        broken = noisy_series.iloc[np.random.default_rng(0).permutation(len(noisy_series))]
        with pytest.raises(ValueError):
            rolling_zscore(broken, window=20)


class TestSoftDiscretize:
    def test_saturates_at_plus_one_beyond_clip(self):
        z = pd.Series([5.0, 3.0, 3.0001])
        result = soft_discretize(z, clip=3.0)
        assert (result == 1.0).all()

    def test_saturates_at_minus_one_beyond_negative_clip(self):
        z = pd.Series([-5.0, -3.0, -10.0])
        result = soft_discretize(z, clip=3.0)
        assert (result == -1.0).all()

    def test_linear_scaling_inside_the_clip_range(self):
        z = pd.Series([1.5])
        result = soft_discretize(z, clip=3.0)
        assert result.iloc[0] == pytest.approx(0.5, abs=1e-9)

    def test_zero_zscore_maps_to_zero(self):
        result = soft_discretize(pd.Series([0.0]), clip=3.0)
        assert result.iloc[0] == 0.0

    def test_nan_stays_nan_not_silently_zero(self):
        result = soft_discretize(pd.Series([np.nan, 1.0]), clip=3.0)
        assert np.isnan(result.iloc[0])
        assert result.iloc[1] == pytest.approx(1.0 / 3.0, abs=1e-9)

    def test_rejects_non_positive_clip(self):
        with pytest.raises(ValueError):
            soft_discretize(pd.Series([1.0]), clip=0.0)


class TestFactorMatrix:
    @pytest.fixture
    def raw_matrix(self) -> pd.DataFrame:
        rng = np.random.default_rng(3)
        n = 100
        idx = make_datetime_index(n, freq="h")
        return pd.DataFrame(
            {
                "rsi_14": rng.normal(50, 15, n),
                "adx_14": rng.uniform(10, 50, n),
            },
            index=idx,
        )

    def test_zscore_factor_matrix_applies_columnwise(self, raw_matrix):
        result = zscore_factor_matrix(raw_matrix, window=20)
        assert list(result.columns) == list(raw_matrix.columns)
        assert result.shape == raw_matrix.shape
        # Cross-check against the single-series function directly.
        expected_rsi = rolling_zscore(raw_matrix["rsi_14"], window=20)
        pd.testing.assert_series_equal(result["rsi_14"], expected_rsi, check_names=False)

    def test_soft_factor_matrix_stays_within_bounds(self, raw_matrix):
        result = soft_factor_matrix(raw_matrix, window=20, clip=3.0)
        valid = result.dropna()
        assert (valid >= -1.0 - 1e-9).all().all()
        assert (valid <= 1.0 + 1e-9).all().all()

    def test_soft_factor_matrix_no_lookahead(self, raw_matrix):
        assert_no_lookahead_on_truncation(
            lambda df: soft_factor_matrix(df, window=20, clip=3.0), raw_matrix, cutoff_pos=80
        )
