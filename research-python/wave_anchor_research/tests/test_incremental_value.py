import numpy as np
import pandas as pd

from incremental_value import evaluate_incremental_value


def _synthetic_df(n, rng, wave_anchor_effect):
    baseline_momentum = rng.normal(0, 0.01, n)
    baseline_ema_trend = rng.normal(0, 1, n)
    baseline_rsi = rng.uniform(0, 100, n)
    baseline_macd_hist = rng.normal(0, 1, n)
    htfA_wt2 = rng.normal(0, 30, n)
    htfB_wt2 = rng.normal(0, 30, n)
    forward_return = wave_anchor_effect * htfA_wt2 + rng.normal(0, 0.01, n)
    return pd.DataFrame({
        "baseline_momentum": baseline_momentum, "baseline_ema_trend": baseline_ema_trend,
        "baseline_rsi": baseline_rsi, "baseline_macd_hist": baseline_macd_hist,
        "htfA_wt2": htfA_wt2, "htfB_wt2": htfB_wt2,
        "forward_return_1H": forward_return, "direction_1H": np.sign(forward_return),
    })


def test_real_wave_anchor_effect_detected_via_positive_delta_r2_and_significant_wald():
    rng = np.random.default_rng(42)
    df = _synthetic_df(2000, rng, wave_anchor_effect=-0.00005)
    result = evaluate_incremental_value(df, "forward_return_1H", "forward_return", "1H", 8, "test")
    assert result.status == "OK"
    assert result.delta_r2 > 0.005
    assert result.wave_anchor_wald_p_value < 0.01


def test_no_wave_anchor_effect_gives_small_delta_r2():
    rng = np.random.default_rng(7)
    df = _synthetic_df(2000, rng, wave_anchor_effect=0.0)
    result = evaluate_incremental_value(df, "forward_return_1H", "forward_return", "1H", 8, "test")
    assert result.status == "OK"
    assert result.delta_r2 < 0.01


def test_insufficient_data_below_min_n():
    rng = np.random.default_rng(3)
    df = _synthetic_df(50, rng, wave_anchor_effect=0.0)
    result = evaluate_incremental_value(df, "forward_return_1H", "forward_return", "1H", 8, "test")
    assert result.status == "INSUFFICIENT_DATA"
    assert np.isnan(result.delta_r2)


def test_direction_target_uses_logit_and_returns_pseudo_r2():
    rng = np.random.default_rng(11)
    df = _synthetic_df(2000, rng, wave_anchor_effect=-0.00005)
    result = evaluate_incremental_value(df, "direction_1H", "direction", "1H", 8, "test")
    assert result.status == "OK"
    assert 0.0 <= result.r2_baseline_plus_wave_anchor <= 1.0
    assert result.delta_r2 > 0.0
