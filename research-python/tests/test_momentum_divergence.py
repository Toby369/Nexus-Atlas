from __future__ import annotations

import numpy as np
import pandas as pd

from src.signals.momentum_divergence import detect_momentum_divergence
from tests.lookahead_utils import make_datetime_index


def _series(values, n=None):
    n = n or len(values)
    return pd.Series(values, index=make_datetime_index(n, freq="h"))


class TestDetectMomentumDivergence:
    def test_established_bullish_trend_with_contradicting_macd_triggers(self):
        result = detect_momentum_divergence(
            adx=_series([30.0]), plus_di=_series([25.0]), minus_di=_series([10.0]),
            macd_histogram=_series([-0.5]),
        )
        assert bool(result.iloc[0]) is True

    def test_established_bearish_trend_with_contradicting_macd_triggers(self):
        result = detect_momentum_divergence(
            adx=_series([30.0]), plus_di=_series([10.0]), minus_di=_series([25.0]),
            macd_histogram=_series([0.5]),
        )
        assert bool(result.iloc[0]) is True

    def test_confirmed_momentum_does_not_trigger(self):
        result = detect_momentum_divergence(
            adx=_series([30.0]), plus_di=_series([25.0]), minus_di=_series([10.0]),
            macd_histogram=_series([0.5]),
        )
        assert bool(result.iloc[0]) is False

    def test_weak_trend_below_adx_threshold_does_not_trigger(self):
        result = detect_momentum_divergence(
            adx=_series([15.0]), plus_di=_series([25.0]), minus_di=_series([10.0]),
            macd_histogram=_series([-0.5]),
        )
        assert bool(result.iloc[0]) is False

    def test_adx_exactly_at_threshold_is_inclusive(self):
        result = detect_momentum_divergence(
            adx=_series([25.0]), plus_di=_series([25.0]), minus_di=_series([10.0]),
            macd_histogram=_series([-0.5]),
        )
        assert bool(result.iloc[0]) is True

    def test_missing_input_never_triggers(self):
        result = detect_momentum_divergence(
            adx=_series([np.nan]), plus_di=_series([25.0]), minus_di=_series([10.0]),
            macd_histogram=_series([-0.5]),
        )
        assert bool(result.iloc[0]) is False

    def test_output_is_boolean_dtype_and_never_nan(self):
        n = 50
        rng = np.random.default_rng(1)
        result = detect_momentum_divergence(
            adx=_series(rng.uniform(0, 60, n)),
            plus_di=_series(rng.uniform(0, 50, n)),
            minus_di=_series(rng.uniform(0, 50, n)),
            macd_histogram=_series(rng.normal(0, 1, n)),
        )
        assert result.notna().all()
        assert result.dtype == bool
