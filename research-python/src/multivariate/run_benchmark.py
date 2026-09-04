"""Runner: trains and purged-walk-forward-evaluates a logistic-regression
candidate model on the 24h-direction label, in two feature variants
("core": price/derivatives only; "core_onchain": core + on-chain metrics),
and puts both through the existing Gates 1-3 from
``src/validation/decision_framework.py`` (Gate 4 is intentionally not run
in its original HRP/MDI-importance-stability form -- that gate answers a
different question, "which of many candidate features are consistently
selected", not relevant to this fixed, small, pre-specified feature set;
a simplified per-fold sign-consistency check is reported instead, labeled
as such, not presented as the real Gate 4).

Not test-covered itself (it is a script, not a library function) -- the
library pieces it calls (``build_features``, ``PurgedWalkForwardCV``,
``block_bootstrap_hit_rate_difference``, the decision-framework gates) all
have their own unit tests already. Run with:
    python -m src.multivariate.run_benchmark
"""

from __future__ import annotations

import json
import warnings
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.exceptions import ConvergenceWarning
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler

from src.multivariate.features import CORE_FEATURE_COLUMNS, ONCHAIN_FEATURE_COLUMNS, build_features
from src.validation.block_bootstrap import block_bootstrap_hit_rate_difference
from src.validation.decision_framework import (
    CoverageGateConfig,
    PerformanceGateConfig,
    PowerGateConfig,
    compute_feature_coverage,
    evaluate_gate_1_statistical_power,
    evaluate_gate_2_feature_coverage,
    evaluate_gate_3_performance,
)
from src.validation.walk_forward import PurgedWalkForwardCV

SEED = 20260904  # fixed, pre-registered -- not tuned after seeing results
N_SPLITS = 5
TEST_SIZE_FRACTION = 0.12
PURGE_WINDOW = 1  # bars; 24h label = 1 daily bar
EMBARGO_WINDOW = 1
MIN_PRACTICALLY_RELEVANT_EFFECT = 0.05  # +5pp, same threshold Gate 3 uses project-wide


def _prepare_variant(features: pd.DataFrame, columns: list[str]) -> pd.DataFrame:
    required = columns + ["label_up"]
    clean = features.dropna(subset=required).reset_index(drop=True)
    return clean


def _run_walk_forward(clean: pd.DataFrame, columns: list[str], seed: int) -> dict:
    X = clean[columns].to_numpy(dtype=float)
    y = clean["label_up"].to_numpy(dtype=float)
    n = len(clean)

    cv = PurgedWalkForwardCV(
        n_splits=N_SPLITS,
        train_size=0.3,  # floor for fold 0's train window; later folds grow past it
        test_size=TEST_SIZE_FRACTION,
        purge_window=PURGE_WINDOW,
        embargo_window=EMBARGO_WINDOW,
        expanding=True,
    )

    oos_pred = np.full(n, np.nan)
    oos_mask = np.zeros(n, dtype=bool)
    fold_hit_rates: list[float] = []
    fold_n: list[int] = []

    with warnings.catch_warnings():
        warnings.simplefilter("ignore", category=ConvergenceWarning)
        for train_idx, test_idx in cv.split(X):
            scaler = StandardScaler()
            X_train = scaler.fit_transform(X[train_idx])
            X_test = scaler.transform(X[test_idx])
            model = LogisticRegression(C=1.0, max_iter=2000, random_state=seed)
            model.fit(X_train, y[train_idx])
            preds = model.predict(X_test)
            oos_pred[test_idx] = preds
            oos_mask[test_idx] = True
            hits = (preds == y[test_idx]).mean()
            fold_hit_rates.append(float(hits))
            fold_n.append(len(test_idx))

    y_actual_bool = y.astype(bool)
    pred_bool = np.where(np.isnan(oos_pred), False, oos_pred.astype(bool))
    outcome = pred_bool == y_actual_bool  # per-row: was the OOS prediction correct?

    n_oos = int(oos_mask.sum())
    oos_hit_rate = float(outcome[oos_mask].mean()) if n_oos > 0 else float("nan")
    up_rate_oos = float(y[oos_mask].mean()) if n_oos > 0 else float("nan")
    majority_baseline = max(up_rate_oos, 1.0 - up_rate_oos) if n_oos > 0 else float("nan")

    return {
        "n_total_rows": n,
        "n_oos": n_oos,
        "fold_n": fold_n,
        "fold_hit_rates": fold_hit_rates,
        "oos_hit_rate": oos_hit_rate,
        "majority_baseline": majority_baseline,
        "up_rate_oos": up_rate_oos,
        "outcome": outcome,
        "oos_mask": oos_mask,
    }


def _evaluate_variant(name: str, clean: pd.DataFrame, columns: list[str]) -> dict:
    wf = _run_walk_forward(clean, columns, SEED)

    coverage = compute_feature_coverage(clean[columns])
    gate2 = evaluate_gate_2_feature_coverage(coverage, CoverageGateConfig(required_features=columns, min_coverage=1.0))

    gate1 = evaluate_gate_1_statistical_power(
        n_obs=wf["n_oos"],
        config=PowerGateConfig(baseline=wf["majority_baseline"], min_detectable_effect=MIN_PRACTICALLY_RELEVANT_EFFECT),
    )

    bootstrap_result = block_bootstrap_hit_rate_difference(
        outcome=wf["outcome"],
        condition_mask=wf["oos_mask"],
        baseline=wf["majority_baseline"],
        seed=SEED,
    )
    gate3 = evaluate_gate_3_performance(
        outcome=wf["outcome"],
        condition_mask=wf["oos_mask"],
        baseline=wf["majority_baseline"],
        config=PerformanceGateConfig(seed=SEED, min_practically_relevant_effect=MIN_PRACTICALLY_RELEVANT_EFFECT),
    )

    # Simplified fold-consistency check (explicitly NOT the real Gate 4 --
    # see module docstring): does every individual fold beat its own
    # majority baseline, i.e. is the aggregate result driven by one lucky
    # fold or is it consistent across folds?
    folds_above_baseline = sum(1 for h in wf["fold_hit_rates"] if h > wf["majority_baseline"])

    return {
        "variant": name,
        "n_features": len(columns),
        "features": columns,
        "n_total_rows": wf["n_total_rows"],
        "n_oos": wf["n_oos"],
        "fold_n": wf["fold_n"],
        "fold_hit_rates": [round(h, 4) for h in wf["fold_hit_rates"]],
        "folds_above_majority_baseline": f"{folds_above_baseline}/{len(wf['fold_hit_rates'])}",
        "oos_hit_rate": round(wf["oos_hit_rate"], 4),
        "majority_baseline": round(wf["majority_baseline"], 4),
        "bootstrap_difference_pp": round(bootstrap_result.difference * 100, 2),
        "bootstrap_p_value": round(bootstrap_result.p_value, 4),
        "bootstrap_ci_95": [round(bootstrap_result.ci_lower, 4), round(bootstrap_result.ci_upper, 4)],
        "gate1_power": gate1.status.value,
        "gate1_rationale": gate1.rationale,
        "gate2_coverage": gate2.status.value,
        "gate2_rationale": gate2.rationale,
        "gate3_performance": gate3.status.value,
        "gate3_rationale": gate3.rationale,
    }


def main() -> None:
    data_path = Path(__file__).resolve().parents[2] / "data" / "multivariate_1d_snapshot.csv"
    raw = pd.read_csv(data_path, parse_dates=["candle_open_time"]).sort_values("candle_open_time").reset_index(drop=True)
    features = build_features(raw)

    core_clean = _prepare_variant(features, CORE_FEATURE_COLUMNS)
    onchain_clean = _prepare_variant(features, CORE_FEATURE_COLUMNS + ONCHAIN_FEATURE_COLUMNS)

    results = {
        "core": _evaluate_variant("core (price/derivatives only, 12 features)", core_clean, CORE_FEATURE_COLUMNS),
        "core_onchain": _evaluate_variant(
            "core_onchain (12 core + 5 on-chain features)",
            onchain_clean,
            CORE_FEATURE_COLUMNS + ONCHAIN_FEATURE_COLUMNS,
        ),
    }

    out_path = Path(__file__).resolve().parents[2] / "BENCHMARK_MULTIVARIATE_RESULTS.json"
    with open(out_path, "w") as f:
        json.dump(results, f, indent=2)

    for variant, r in results.items():
        print(f"\n=== {r['variant']} ===")
        print(f"n_total_rows={r['n_total_rows']} n_oos={r['n_oos']} folds_n={r['fold_n']}")
        print(f"fold_hit_rates={r['fold_hit_rates']} (above baseline: {r['folds_above_majority_baseline']})")
        print(f"OOS hit rate={r['oos_hit_rate']} vs majority baseline={r['majority_baseline']}")
        print(f"Block-bootstrap diff={r['bootstrap_difference_pp']}pp p={r['bootstrap_p_value']} CI95={r['bootstrap_ci_95']}")
        print(f"Gate 1 (power): {r['gate1_power']} -- {r['gate1_rationale']}")
        print(f"Gate 2 (coverage): {r['gate2_coverage']} -- {r['gate2_rationale']}")
        print(f"Gate 3 (performance): {r['gate3_performance']} -- {r['gate3_rationale']}")

    print(f"\nFull results written to {out_path}")


if __name__ == "__main__":
    main()
