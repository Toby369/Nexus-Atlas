from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.features.sentiment import liquidation_cluster_density, net_taker_flow_ratio
from tests.lookahead_utils import (
    assert_no_lookahead_on_future_perturbation,
    assert_no_lookahead_on_truncation,
    make_datetime_index,
)


@pytest.fixture
def liquidation_notional_series() -> pd.Series:
    rng = np.random.default_rng(29)
    n = 200
    values = rng.exponential(scale=5000.0, size=n)
    # A few zero-liquidation bars, placed well past the window=6/
    # baseline_window=48 warm-up (0 is a real, informative value here, not NaN).
    values[150:155] = 0.0
    # An explicit cluster/burst, also past the warm-up.
    values[100:104] = 200000.0
    return pd.Series(values, index=make_datetime_index(n, freq="h"), name="liquidation_notional_usd")


class TestLiquidationClusterDensityNoLookahead:
    def test_truncation(self, liquidation_notional_series):
        assert_no_lookahead_on_truncation(
            lambda s: liquidation_cluster_density(s, window=6, baseline_window=48),
            liquidation_notional_series,
            cutoff_pos=150,
        )

    def test_future_perturbation(self, liquidation_notional_series):
        assert_no_lookahead_on_future_perturbation(
            lambda s: liquidation_cluster_density(s, window=6, baseline_window=48),
            liquidation_notional_series,
            cutoff_pos=150,
        )

    def test_nan_region_matches_combined_warmup(self, liquidation_notional_series):
        density = liquidation_cluster_density(liquidation_notional_series, window=6, baseline_window=48)
        # cluster_sum (window=6) is valid from index 5; the baseline rolling
        # mean/std then needs 48 *valid* cluster_sum values, i.e. indices
        # 5..52 -> density is first valid at index 52.
        assert density.iloc[:52].isna().all()
        assert density.iloc[52:].notna().all()

    def test_burst_produces_high_positive_density(self, liquidation_notional_series):
        density = liquidation_cluster_density(liquidation_notional_series, window=6, baseline_window=48)
        # The forced 200k-notional burst at bars 100-103 should register as a
        # clear positive spike relative to the (much smaller, exponential(5000))
        # background baseline shortly after it happens.
        assert density.iloc[103] > 1.0

    def test_zero_liquidation_stretch_is_not_positive(self, liquidation_notional_series):
        density = liquidation_cluster_density(liquidation_notional_series, window=6, baseline_window=48)
        # Bars 150-154 are all-zero liquidations -- the cluster sum ending
        # there should be at or below its own recent baseline, never a
        # positive "cluster" reading.
        assert density.iloc[154] <= 0.0

    def test_rejects_baseline_not_greater_than_window(self, liquidation_notional_series):
        with pytest.raises(ValueError):
            liquidation_cluster_density(liquidation_notional_series, window=48, baseline_window=48)

    def test_rejects_unsorted_index(self, liquidation_notional_series):
        broken = liquidation_notional_series.iloc[
            np.random.default_rng(0).permutation(len(liquidation_notional_series))
        ]
        with pytest.raises(ValueError):
            liquidation_cluster_density(broken, window=6, baseline_window=48)


class TestNetTakerFlowRatio:
    def test_pure_buying_is_one(self):
        idx = make_datetime_index(3, freq="h")
        buy = pd.Series([100.0, 50.0, 10.0], index=idx)
        sell = pd.Series([0.0, 0.0, 0.0], index=idx)
        ratio = net_taker_flow_ratio(buy, sell)
        assert (ratio == 1.0).all()

    def test_pure_selling_is_negative_one(self):
        idx = make_datetime_index(3, freq="h")
        buy = pd.Series([0.0, 0.0, 0.0], index=idx)
        sell = pd.Series([100.0, 50.0, 10.0], index=idx)
        ratio = net_taker_flow_ratio(buy, sell)
        assert (ratio == -1.0).all()

    def test_balanced_is_zero(self):
        idx = make_datetime_index(2, freq="h")
        buy = pd.Series([100.0, 50.0], index=idx)
        sell = pd.Series([100.0, 50.0], index=idx)
        ratio = net_taker_flow_ratio(buy, sell)
        assert (ratio == 0.0).all()

    def test_known_ratio_value(self):
        idx = make_datetime_index(1, freq="h")
        buy = pd.Series([70.0], index=idx)
        sell = pd.Series([30.0], index=idx)
        ratio = net_taker_flow_ratio(buy, sell)
        assert ratio.iloc[0] == pytest.approx(0.4)  # (70-30)/100

    def test_zero_total_volume_is_nan_not_inf(self):
        idx = make_datetime_index(1, freq="h")
        buy = pd.Series([0.0], index=idx)
        sell = pd.Series([0.0], index=idx)
        ratio = net_taker_flow_ratio(buy, sell)
        assert np.isnan(ratio.iloc[0])

    def test_bounded_minus_one_to_one(self):
        rng = np.random.default_rng(5)
        idx = make_datetime_index(100, freq="h")
        buy = pd.Series(rng.uniform(0, 1000, size=100), index=idx)
        sell = pd.Series(rng.uniform(0, 1000, size=100), index=idx)
        ratio = net_taker_flow_ratio(buy, sell)
        assert (ratio.dropna() >= -1.0).all()
        assert (ratio.dropna() <= 1.0).all()

    def test_mismatched_index_raises(self):
        idx = make_datetime_index(3, freq="h")
        buy = pd.Series([1.0, 2.0, 3.0], index=idx)
        sell = pd.Series([1.0, 2.0], index=idx[:2])
        with pytest.raises(ValueError):
            net_taker_flow_ratio(buy, sell)
