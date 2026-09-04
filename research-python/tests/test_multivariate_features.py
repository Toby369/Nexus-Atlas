from __future__ import annotations

import numpy as np
import pandas as pd

from src.multivariate.features import (
    CORE_FEATURE_COLUMNS,
    ONCHAIN_FEATURE_COLUMNS,
    build_features,
)


def _raw_row(**overrides) -> dict:
    base = dict(
        candle_open_time="2026-01-01T00:00:00+00:00",
        close_price=100.0,
        rsi_14=60.0,
        macd_histogram=1.5,
        adx_14=25.0,
        plus_di=30.0,
        minus_di=10.0,
        ema_50=95.0,
        ema_200=90.0,
        vwap=99.0,
        cvd_delta=500.0,
        structure_trend="bullish",
        avg_funding_rate=0.0001,
        macro_regime="Risk-On",
        sentiment_classification="Greed",
        onchain_sopr=1.02,
        onchain_mvrv=1.8,
        onchain_lth_net_position_change_btc=-500.0,
        onchain_stablecoin_supply=1000.0,
        onchain_whale_addr_count=100,
        close_price_fwd_24h=105.0,
    )
    base.update(overrides)
    return base


def test_all_expected_columns_present():
    raw = pd.DataFrame([_raw_row(), _raw_row()])
    out = build_features(raw)
    for col in CORE_FEATURE_COLUMNS + ONCHAIN_FEATURE_COLUMNS + ["label_up", "forward_return_pct"]:
        assert col in out.columns


def test_ordinal_encodings_correct():
    raw = pd.DataFrame(
        [
            _raw_row(structure_trend="bullish", macro_regime="Risk-On", sentiment_classification="Extreme Fear"),
            _raw_row(structure_trend="bearish", macro_regime="Risk-Off", sentiment_classification="Extreme Greed"),
            _raw_row(structure_trend="ranging", macro_regime="Mixed", sentiment_classification="Neutral"),
        ]
    )
    out = build_features(raw)
    assert out["structure_ord"].tolist() == [1.0, -1.0, 0.0]
    assert out["macro_ord"].tolist() == [1.0, -1.0, 0.0]
    # Extreme Fear must map to the LOW end of the ordinal scale and Extreme
    # Greed to the HIGH end -- i.e. the raw Fear&Greed scale, not
    # pre-flipped to match production's contrarian convention (the model
    # is meant to learn its own sign).
    assert out["sentiment_ord"].iloc[0] == 1.0
    assert out["sentiment_ord"].iloc[1] == 5.0


def test_di_diff_and_distance_pct_computed_correctly():
    raw = pd.DataFrame([_raw_row(plus_di=30.0, minus_di=10.0, close_price=110.0, ema_50=100.0, ema_200=100.0, vwap=100.0)])
    out = build_features(raw)
    assert out["di_diff"].iloc[0] == 20.0
    assert out["ema50_dist_pct"].iloc[0] == pytest_approx(10.0)
    assert out["ema200_dist_pct"].iloc[0] == pytest_approx(10.0)
    assert out["vwap_dist_pct"].iloc[0] == pytest_approx(10.0)


def pytest_approx(value: float, tol: float = 1e-9):
    class _Approx:
        def __eq__(self, other):
            return abs(other - value) < tol

    return _Approx()


def test_label_up_true_when_price_rises():
    raw = pd.DataFrame([_raw_row(close_price=100.0, close_price_fwd_24h=101.0)])
    out = build_features(raw)
    assert out["label_up"].iloc[0] == 1.0


def test_label_up_false_when_price_falls():
    raw = pd.DataFrame([_raw_row(close_price=100.0, close_price_fwd_24h=99.0)])
    out = build_features(raw)
    assert out["label_up"].iloc[0] == 0.0


def test_label_up_nan_when_forward_price_missing():
    raw = pd.DataFrame([_raw_row(close_price_fwd_24h=None)])
    out = build_features(raw)
    assert np.isnan(out["label_up"].iloc[0])


def test_stablecoin_supply_change_pct_uses_prior_row_only():
    raw = pd.DataFrame(
        [
            _raw_row(onchain_stablecoin_supply=1000.0),
            _raw_row(onchain_stablecoin_supply=1100.0),
            _raw_row(onchain_stablecoin_supply=990.0),
        ]
    )
    out = build_features(raw)
    assert np.isnan(out["onchain_stablecoin_supply_chg_pct"].iloc[0])
    assert out["onchain_stablecoin_supply_chg_pct"].iloc[1] == pytest_approx(10.0)
    assert out["onchain_stablecoin_supply_chg_pct"].iloc[2] == pytest_approx((990.0 - 1100.0) / 1100.0 * 100.0)


def test_unmapped_categorical_value_becomes_nan_not_silently_zero():
    raw = pd.DataFrame([_raw_row(structure_trend="unexpected_value")])
    out = build_features(raw)
    assert np.isnan(out["structure_ord"].iloc[0])
