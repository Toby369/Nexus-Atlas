import numpy as np
import pandas as pd

from stats_battery import apply_bh_fdr, evaluate_condition_vs_complement, evaluate_rank_ic


def test_condition_with_real_effect_shows_positive_difference():
    rng = np.random.default_rng(42)
    n = 2000
    condition = pd.Series(rng.random(n) < 0.2)
    # Bedingung hat einen echten, deutlichen positiven Effekt eingebaut.
    fr = pd.Series(rng.normal(0.0, 0.01, n) + np.where(condition, 0.02, 0.0))
    result = evaluate_condition_vs_complement(
        fr, condition, horizon_bars=4, seed=1, n_replicates=500,
        study_setup="test", wt_preset="test", split="TRAIN_VAL",
        test_category="B", feature="test_feature", condition="TEST", horizon="1H",
    )
    assert result.status == "OK"
    assert result.observed_diff > 0.01
    assert result.raw_p_value < 0.05


def test_insufficient_data_below_min_n():
    fr = pd.Series([0.01] * 10 + [np.nan] * 5)
    condition = pd.Series([True] * 10 + [False] * 5)
    result = evaluate_condition_vs_complement(
        fr, condition, horizon_bars=1, seed=1, n_replicates=100,
        study_setup="t", wt_preset="t", split="TRAIN_VAL", test_category="B",
        feature="f", condition="c", horizon="1H",
    )
    assert result.status == "INSUFFICIENT_DATA"
    assert np.isnan(result.raw_p_value)


def test_rank_ic_detects_monotonic_relationship():
    rng = np.random.default_rng(7)
    n = 1000
    x = rng.normal(0, 1, n)
    y = x * 0.5 + rng.normal(0, 0.1, n)  # starke monotone Beziehung
    result = evaluate_rank_ic(
        pd.Series(x), pd.Series(y), horizon_bars=4, seed=1, n_replicates=300,
        study_setup="t", wt_preset="t", split="TRAIN_VAL", test_category="A",
        feature="f", horizon="1H",
    )
    assert result.status == "OK"
    assert result.observed_diff > 0.8  # hohe Rangkorrelation erwartet
    assert result.raw_p_value < 0.05


def test_bh_fdr_reduces_false_positives_under_pure_noise():
    rng = np.random.default_rng(3)
    cells = []
    for i in range(50):
        fr = pd.Series(rng.normal(0, 0.01, 500))
        condition = pd.Series(rng.random(500) < 0.3)
        cells.append(
            evaluate_condition_vs_complement(
                fr, condition, horizon_bars=1, seed=100 + i, n_replicates=200,
                study_setup="t", wt_preset="t", split="TRAIN_VAL", test_category="B",
                feature=f"noise_{i}", condition="c", horizon="1H",
            )
        )
    apply_bh_fdr(cells, alpha=0.05)
    n_raw_significant = sum(1 for c in cells if c.raw_p_value < 0.05)
    n_bh_significant = sum(1 for c in cells if c.bh_significant)
    # Unter reinem Rauschen (50 Zellen, kein echter Effekt) muss BH-FDR
    # mindestens so konservativ sein wie die unkorrigierten p-Werte.
    assert n_bh_significant <= n_raw_significant
