"""Fold-by-fold feature evaluation: importance stability, stationarity, and
Information Coefficient (IC) against forward returns, under Purged
Walk-Forward Cross-Validation.

Fold discipline (per task spec: "Fit/Selektion NUR auf Train-Set des
jeweiligen Folds, Transformation/Evaluierung auf Test-Set"), applied
consistently to every computation in this module, not just model fitting:

  - Feature importance (MDI, via RandomForest)  -> fit on TRAIN, per fold.
  - Stationarity (ADF)                          -> computed on TRAIN, per
    fold. Treated here as a *selection* diagnostic (does this feature look
    stationary enough using only information available at selection time),
    not an out-of-sample evaluation metric.
  - Correlation-based clustering (orthogonal.py) -> computed on TRAIN, per
    fold. Clustering decisions never see test data -- this matters as much
    as model-fitting discipline does: clustering on a leaked, test-inclusive
    correlation matrix is a classic, easy-to-miss feature-selection leakage
    source.
  - Information Coefficient / Rank IC            -> computed on TEST, per
    fold. This is the genuine out-of-sample "does this feature's
    relationship with forward returns actually hold on unseen data" check
    -- the entire point of using walk-forward CV here rather than a single
    in-sample correlation.

No Supabase/production imports. Depends on scikit-learn
(RandomForestRegressor), scipy (via orthogonal.py), and statsmodels
(adfuller).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from statsmodels.tsa.stattools import adfuller

from src.selection.orthogonal import cluster_features, select_cluster_representatives
from src.validation.walk_forward import PurgedWalkForwardCV

__all__ = [
    "information_coefficient",
    "adf_stationarity_test",
    "feature_importance_mdi",
    "evaluate_features",
    "StationarityResult",
    "FoldResult",
    "EvaluationReport",
]


def information_coefficient(
    feature: pd.Series, forward_return: pd.Series, method: str = "pearson"
) -> float:
    """Pearson or Spearman ("Rank IC") correlation between a feature and a
    forward-return series.

    Rows where either value is NaN are dropped before computing the
    correlation. Returns NaN (never a fabricated 0.0 "no relationship")
    if fewer than 3 valid paired observations remain.
    """
    if method not in ("pearson", "spearman"):
        raise ValueError(f"method must be 'pearson' or 'spearman', got {method!r}")

    paired = pd.concat([feature.rename("f"), forward_return.rename("r")], axis=1).dropna()
    if len(paired) < 3:
        return float("nan")
    return float(paired["f"].corr(paired["r"], method=method))


@dataclass
class StationarityResult:
    feature: str
    adf_statistic: float
    p_value: float
    is_stationary: bool
    n_obs: int
    insufficient_data: bool = False


def adf_stationarity_test(
    series: pd.Series, significance: float = 0.05, min_obs: int = 20
) -> StationarityResult:
    """Augmented Dickey-Fuller stationarity test.

    H0: the series has a unit root (non-stationary). Rejecting H0
    (p < significance) is evidence of stationarity.

    If fewer than ``min_obs`` valid (non-NaN) observations are available,
    returns a result with ``insufficient_data=True`` and NaN
    statistic/p_value -- consistent with this project's rule to never
    fabricate a numeric result when the data doesn't support one, rather
    than letting statsmodels run on a handful of points and reporting a
    meaningless number as if it were reliable.
    """
    clean = series.dropna()
    feature_name = series.name if series.name is not None else "unnamed"
    if len(clean) < min_obs:
        return StationarityResult(
            feature=feature_name,
            adf_statistic=float("nan"),
            p_value=float("nan"),
            is_stationary=False,
            n_obs=len(clean),
            insufficient_data=True,
        )
    statistic, p_value, *_ = adfuller(clean.to_numpy(), autolag="AIC", result_object=False)
    return StationarityResult(
        feature=feature_name,
        adf_statistic=float(statistic),
        p_value=float(p_value),
        is_stationary=bool(p_value < significance),
        n_obs=len(clean),
    )


def feature_importance_mdi(
    X_train: pd.DataFrame,
    y_train: pd.Series,
    random_state: int = 42,
    n_estimators: int = 200,
) -> pd.Series:
    """Mean Decrease Impurity feature importance from a RandomForestRegressor
    fit on ``(X_train, y_train)`` ONLY.

    This function does not know about folds -- the caller (``evaluate_features``)
    is responsible for ensuring these are already the train-fold slice.

    Rows with any NaN in ``X_train`` or ``y_train`` are dropped before
    fitting. Raises ``ValueError`` if fewer than 10 valid rows remain --
    fitting a forest on a handful of samples would produce an importance
    estimate that is noise, not signal, and is not silently returned as if
    it were meaningful.
    """
    combined = X_train.copy()
    combined["__target__"] = y_train.to_numpy()
    combined = combined.dropna()
    if len(combined) < 10:
        raise ValueError(
            f"feature_importance_mdi: only {len(combined)} valid rows after dropping "
            "NaNs -- too few to fit a meaningful RandomForest (need >= 10)."
        )
    X_clean = combined[X_train.columns]
    y_clean = combined["__target__"]

    model = RandomForestRegressor(n_estimators=n_estimators, random_state=random_state, n_jobs=-1)
    model.fit(X_clean, y_clean)
    return pd.Series(model.feature_importances_, index=X_train.columns, name="mdi_importance")


@dataclass
class FoldResult:
    fold_index: int
    train_size: int
    test_size: int
    importances: pd.Series
    adf_results: dict[str, StationarityResult]
    ic: dict[str, pd.Series]  # horizon -> Series[feature -> IC]
    rank_ic: dict[str, pd.Series]  # horizon -> Series[feature -> Rank IC]
    clusters: dict[int, list[str]]
    cluster_representatives: dict[int, str]


@dataclass
class EvaluationReport:
    fold_results: list[FoldResult]
    summary: pd.DataFrame  # per-feature aggregate table, indexed by feature name
    final_clusters: dict[int, list[str]]  # clustering on the last (largest) train fold
    selected_features: list[str]  # one representative per final cluster


def _coefficient_of_variation_stability(values: np.ndarray) -> float:
    """Stability score in [0, 1]: ``1 / (1 + CV)``, ``CV = std/|mean|``.

    Higher = more consistent across folds. Returns 0.0 (least stable, not
    NaN -- a feature we cannot establish any consistency for is treated as
    unstable, not silently excluded from ranking) if fewer than 2 valid
    values remain or the mean is (numerically) zero.
    """
    clean = values[~np.isnan(values)]
    if len(clean) < 2:
        return 0.0
    mean = float(np.mean(clean))
    if np.isclose(mean, 0.0):
        return 0.0
    cv = float(np.std(clean, ddof=1)) / abs(mean)
    return 1.0 / (1.0 + cv)


def _cluster_id_of(clusters: dict[int, list[str]], feature: str) -> int | None:
    for cluster_id, members in clusters.items():
        if feature in members:
            return cluster_id
    return None


def evaluate_features(
    X: pd.DataFrame,
    forward_returns: Mapping[str, pd.Series],
    cv: PurgedWalkForwardCV,
    corr_threshold: float = 0.65,
    cluster_method: str = "single",
    n_estimators: int = 200,
    random_state: int = 42,
) -> EvaluationReport:
    """Run the full fold-by-fold feature evaluation pipeline.

    For each fold produced by ``cv.split(X)``:
      1. Correlation matrix + hierarchical clustering on X_train (TRAIN only).
      2. ADF stationarity test on each feature's X_train column (TRAIN only).
      3. RandomForest MDI feature importance, fit on X_train against the
         *primary* horizon's forward return (TRAIN only; see note below on
         why one horizon is used for importance/clustering).
      4. Per-cluster "winner" for this fold (this fold's own importances
         used as the local tie-breaker -- the final, cross-fold selection
         uses the aggregated stability score instead, computed after all
         folds have run).
      5. IC and Rank IC of every feature against every horizon's forward
         return, computed on X_test / y_test (TEST only).

    After all folds: aggregates per-feature mean importance, a
    coefficient-of-variation-based importance stability score, mean ADF
    p-value / stationarity rate, per-horizon mean+std IC and Rank IC, and
    how often (across folds) each feature "won" its own fold's cluster
    (``selection_frequency``). Final feature selection clusters on the
    *last* (largest, expanding-window) fold's train correlation matrix --
    the richest train-only correlation estimate available without ever
    touching test data -- and picks one representative per final cluster
    using the aggregated cross-fold importance-stability score (not any
    single fold's snapshot).

    Note on ``primary_horizon``: MDI importance and clustering both need a
    single target to fit against per fold; the first key of
    ``forward_returns`` (insertion order) is used for this, documented here
    rather than silently picked. IC/Rank IC, by contrast, are computed for
    *every* horizon in ``forward_returns``, independent of this choice.

    Raises
    ------
    ValueError
        If ``X`` is entirely NaN, if any ``forward_returns`` series has a
        different length than ``X``, or if ``cv.split(X)`` yields no folds.
    """
    if X.isna().all(axis=None):
        raise ValueError("evaluate_features: X is entirely NaN")
    if not forward_returns:
        raise ValueError("evaluate_features: forward_returns must not be empty")
    for horizon, series in forward_returns.items():
        if len(series) != len(X):
            raise ValueError(
                f"forward_returns[{horizon!r}] has length {len(series)}, expected {len(X)}"
            )

    primary_horizon = next(iter(forward_returns))
    fold_results: list[FoldResult] = []

    for fold_index, (train_idx, test_idx) in enumerate(cv.split(X)):
        X_train, X_test = X.iloc[train_idx], X.iloc[test_idx]

        # --- selection-side diagnostics: TRAIN ONLY ---
        corr_train = X_train.corr()
        clusters = cluster_features(corr_train, corr_threshold=corr_threshold, method=cluster_method)

        adf_results = {col: adf_stationarity_test(X_train[col]) for col in X_train.columns}

        y_train_primary = forward_returns[primary_horizon].iloc[train_idx]
        importances = feature_importance_mdi(
            X_train, y_train_primary, random_state=random_state, n_estimators=n_estimators
        )
        cluster_representatives = select_cluster_representatives(clusters, importances)

        # --- evaluation-side metrics: TEST ONLY ---
        ic: dict[str, pd.Series] = {}
        rank_ic: dict[str, pd.Series] = {}
        for horizon, series in forward_returns.items():
            y_test = series.iloc[test_idx]
            ic[horizon] = pd.Series(
                {
                    col: information_coefficient(X_test[col], y_test, method="pearson")
                    for col in X_test.columns
                }
            )
            rank_ic[horizon] = pd.Series(
                {
                    col: information_coefficient(X_test[col], y_test, method="spearman")
                    for col in X_test.columns
                }
            )

        fold_results.append(
            FoldResult(
                fold_index=fold_index,
                train_size=len(train_idx),
                test_size=len(test_idx),
                importances=importances,
                adf_results=adf_results,
                ic=ic,
                rank_ic=rank_ic,
                clusters=clusters,
                cluster_representatives=cluster_representatives,
            )
        )

    if not fold_results:
        raise ValueError("evaluate_features: cv.split(X) produced no folds")

    feature_names = list(X.columns)
    horizons = list(forward_returns.keys())
    summary = _build_summary(fold_results, feature_names, horizons)

    final_clusters = fold_results[-1].clusters
    final_representatives = select_cluster_representatives(final_clusters, summary["importance_stability"])
    selected_features = sorted(set(final_representatives.values()))

    return EvaluationReport(
        fold_results=fold_results,
        summary=summary,
        final_clusters=final_clusters,
        selected_features=selected_features,
    )


def _build_summary(
    fold_results: list[FoldResult], feature_names: list[str], horizons: list[str]
) -> pd.DataFrame:
    rows = []
    for feature in feature_names:
        importance_values = np.array([fr.importances.get(feature, np.nan) for fr in fold_results])

        adf_p_values = np.array(
            [
                fr.adf_results[feature].p_value
                for fr in fold_results
                if not fr.adf_results[feature].insufficient_data
            ]
        )
        stationarity_flags = [
            fr.adf_results[feature].is_stationary
            for fr in fold_results
            if not fr.adf_results[feature].insufficient_data
        ]

        won_own_cluster = [
            fr.cluster_representatives.get(_cluster_id_of(fr.clusters, feature)) == feature
            for fr in fold_results
        ]

        row: dict[str, object] = {
            "feature": feature,
            "mean_importance": float(np.nanmean(importance_values)),
            "importance_stability": _coefficient_of_variation_stability(importance_values),
            "mean_adf_p_value": float(np.mean(adf_p_values)) if len(adf_p_values) else float("nan"),
            "stationarity_rate": float(np.mean(stationarity_flags)) if stationarity_flags else float("nan"),
            "selection_frequency": float(np.mean(won_own_cluster)),
        }

        for horizon in horizons:
            ic_values = np.array([fr.ic[horizon].get(feature, np.nan) for fr in fold_results])
            rank_ic_values = np.array([fr.rank_ic[horizon].get(feature, np.nan) for fr in fold_results])
            row[f"ic_mean_{horizon}"] = float(np.nanmean(ic_values))
            row[f"ic_std_{horizon}"] = (
                float(np.nanstd(ic_values, ddof=1)) if np.sum(~np.isnan(ic_values)) > 1 else float("nan")
            )
            row[f"rank_ic_mean_{horizon}"] = float(np.nanmean(rank_ic_values))
            row[f"rank_ic_std_{horizon}"] = (
                float(np.nanstd(rank_ic_values, ddof=1))
                if np.sum(~np.isnan(rank_ic_values)) > 1
                else float("nan")
            )

        rows.append(row)

    return pd.DataFrame(rows).set_index("feature")
