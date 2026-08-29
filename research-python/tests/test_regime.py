from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.regime import (
    ALL_REGIMES,
    REGIME_HIGH_VOLA_REVERSION,
    REGIME_TREND_EXPANSION_BEARISH,
    REGIME_TREND_EXPANSION_BULLISH,
    REGIME_UNRESOLVED_NEUTRAL,
    REGIME_VOLA_SQUEEZE_RANGING,
    RegimeThresholds,
    classify_market_regime,
    market_state_matrix,
)
from tests.lookahead_utils import make_datetime_index


def _row(
    adx=15.0,
    plus_di=20.0,
    minus_di=20.0,
    slope=0.0,
    bandwidth=0.10,
    atr_ratio=1.0,
    dist_zscore_sma50=0.0,
):
    """One feature row with defaults deliberately in the "nothing special"
    zone (below every threshold), so a test only needs to override the
    column(s) it actually cares about."""
    return dict(
        adx=adx,
        plus_di=plus_di,
        minus_di=minus_di,
        slope=slope,
        bandwidth=bandwidth,
        atr_ratio=atr_ratio,
        dist_zscore_sma50=dist_zscore_sma50,
    )


def _features(rows: list[dict]) -> pd.DataFrame:
    return pd.DataFrame(rows, index=make_datetime_index(len(rows), freq="h"))


class TestClassifyMarketRegime:
    def test_default_row_is_unresolved_neutral(self):
        features = _features([_row()])
        regime = classify_market_regime(features)
        assert regime.iloc[0] == REGIME_UNRESOLVED_NEUTRAL

    def test_trend_expansion_bullish(self):
        features = _features([_row(adx=30.0, plus_di=25.0, minus_di=10.0, slope=5.0)])
        regime = classify_market_regime(features)
        assert regime.iloc[0] == REGIME_TREND_EXPANSION_BULLISH

    def test_trend_expansion_bearish(self):
        features = _features([_row(adx=30.0, plus_di=10.0, minus_di=25.0, slope=-5.0)])
        regime = classify_market_regime(features)
        assert regime.iloc[0] == REGIME_TREND_EXPANSION_BEARISH

    def test_adx_trending_but_di_slope_disagree_is_neutral(self):
        # ADX is high enough to trend, but +DI/-DI direction disagrees with
        # the regression slope's sign -- two Säule-1 signals must both
        # confirm the same direction, not just one of them.
        features = _features([_row(adx=30.0, plus_di=25.0, minus_di=10.0, slope=-5.0)])
        regime = classify_market_regime(features)
        assert regime.iloc[0] == REGIME_UNRESOLVED_NEUTRAL

    def test_vola_squeeze_ranging(self):
        features = _features([_row(adx=12.0, bandwidth=0.02)])
        regime = classify_market_regime(features)
        assert regime.iloc[0] == REGIME_VOLA_SQUEEZE_RANGING

    def test_low_adx_but_bandwidth_above_squeeze_threshold_is_neutral(self):
        features = _features([_row(adx=12.0, bandwidth=0.20)])
        regime = classify_market_regime(features)
        assert regime.iloc[0] == REGIME_UNRESOLVED_NEUTRAL

    def test_high_vola_reversion(self):
        features = _features([_row(atr_ratio=2.0, dist_zscore_sma50=3.0)])
        regime = classify_market_regime(features)
        assert regime.iloc[0] == REGIME_HIGH_VOLA_REVERSION

    def test_high_vola_reversion_negative_extension(self):
        features = _features([_row(atr_ratio=2.0, dist_zscore_sma50=-3.0)])
        regime = classify_market_regime(features)
        assert regime.iloc[0] == REGIME_HIGH_VOLA_REVERSION

    def test_high_vola_reversion_takes_priority_over_trend(self):
        # A row that would otherwise qualify as a strong bullish trend, but
        # also has an extreme vol spike + extension -- reversion wins.
        features = _features(
            [_row(adx=35.0, plus_di=30.0, minus_di=5.0, slope=10.0, atr_ratio=2.5, dist_zscore_sma50=3.5)]
        )
        regime = classify_market_regime(features)
        assert regime.iloc[0] == REGIME_HIGH_VOLA_REVERSION

    def test_missing_value_is_unresolved_neutral_not_nan(self):
        row = _row(adx=30.0, plus_di=25.0, minus_di=10.0, slope=5.0)
        row["adx"] = np.nan
        features = _features([row])
        regime = classify_market_regime(features)
        assert regime.iloc[0] == REGIME_UNRESOLVED_NEUTRAL
        assert regime.notna().all()

    def test_at_exact_thresholds_does_not_trigger(self):
        # Thresholds are strict ">"/"<" (or ">="/"<=" as documented) --
        # values sitting exactly at a boundary should behave per the
        # documented operator, not silently drift either way.
        t = RegimeThresholds()
        features = _features(
            [_row(adx=t.adx_trend_threshold, plus_di=25.0, minus_di=10.0, slope=5.0)]
        )
        regime = classify_market_regime(features)
        # adx == adx_trend_threshold uses >=, so this DOES trend.
        assert regime.iloc[0] == REGIME_TREND_EXPANSION_BULLISH

    def test_output_always_one_of_all_regimes(self):
        rng = np.random.default_rng(41)
        n = 500
        features = pd.DataFrame(
            {
                "adx": rng.uniform(0, 60, n),
                "plus_di": rng.uniform(0, 50, n),
                "minus_di": rng.uniform(0, 50, n),
                "slope": rng.normal(0, 10, n),
                "bandwidth": rng.uniform(0, 0.3, n),
                "atr_ratio": rng.uniform(0.2, 3, n),
                "dist_zscore_sma50": rng.normal(0, 2, n),
            },
            index=make_datetime_index(n, freq="h"),
        )
        regime = classify_market_regime(features)
        assert set(regime.unique()).issubset(set(ALL_REGIMES))
        assert regime.notna().all()

    def test_missing_required_column_raises(self):
        features = _features([_row()]).drop(columns=["adx"])
        with pytest.raises(ValueError):
            classify_market_regime(features)

    def test_rejects_unsorted_index(self):
        features = _features([_row(), _row(), _row()])
        broken = features.iloc[[2, 0, 1]]
        with pytest.raises(ValueError):
            classify_market_regime(broken)


class TestRegimeNoLookahead:
    def test_truncation_reproduces_historical_labels(self):
        rng = np.random.default_rng(59)
        n = 100
        features = pd.DataFrame(
            {
                "adx": rng.uniform(0, 60, n),
                "plus_di": rng.uniform(0, 50, n),
                "minus_di": rng.uniform(0, 50, n),
                "slope": rng.normal(0, 10, n),
                "bandwidth": rng.uniform(0, 0.3, n),
                "atr_ratio": rng.uniform(0.2, 3, n),
                "dist_zscore_sma50": rng.normal(0, 2, n),
            },
            index=make_datetime_index(n, freq="h"),
        )
        cutoff_pos = 60
        full_regime = classify_market_regime(features)
        truncated_regime = classify_market_regime(features.iloc[: cutoff_pos + 1])
        pd.testing.assert_series_equal(
            full_regime.iloc[: cutoff_pos + 1].reset_index(drop=True),
            truncated_regime.reset_index(drop=True),
        )


class TestMarketStateMatrix:
    def test_keeps_original_columns_and_adds_regime(self):
        features = _features([_row(adx=30.0, plus_di=25.0, minus_di=10.0, slope=5.0)])
        result = market_state_matrix(features)
        for col in features.columns:
            assert col in result.columns
        assert "regime" in result.columns
        assert "regime_reasoning" in result.columns
        assert result["regime"].iloc[0] == REGIME_TREND_EXPANSION_BULLISH

    def test_incomplete_row_gets_placeholder_reasoning(self):
        row = _row()
        row["adx"] = np.nan
        features = _features([row])
        result = market_state_matrix(features)
        assert result["regime_reasoning"].iloc[0] == "unvollständige Eingabedaten"
