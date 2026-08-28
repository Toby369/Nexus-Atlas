"""Hierarchical clustering & orthogonalization of correlated features.

Implements the HRP-style correlation-distance metric (Lopez de Prado,
"Building Diversified Portfolios that Outperform Out-of-Sample", 2016) and
a Clustered Feature Importance (CFI) aggregation on top of it, to identify
groups of highly collinear features and select a single representative per
group -- rather than letting importance/IC credit be silently split (or
double-counted) across near-duplicate features.

Fold discipline: every function here operates on whatever DataFrame/Series
it is given -- it is the *caller's* responsibility to pass only train-fold
data when used inside a walk-forward loop (see evaluate.py, which does
exactly that, and tests/test_selection.py, which explicitly verifies it).
This module doesn't know about folds and clusters on whatever it's handed.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.cluster.hierarchy import fcluster, linkage
from scipy.spatial.distance import squareform

__all__ = [
    "correlation_distance",
    "hierarchical_linkage",
    "cluster_features",
    "select_cluster_representatives",
    "clustered_feature_importance",
]


def correlation_distance(corr: pd.DataFrame) -> pd.DataFrame:
    """HRP-style correlation distance: ``d_ij = sqrt(0.5 * (1 - rho_ij))``.

    Maps correlation in [-1, 1] to a proper metric distance in [0, 1]:
    d=0 for perfectly correlated (rho=1), d=1 for perfectly anti-correlated
    (rho=-1), d=sqrt(0.5)~=0.707 for uncorrelated (rho=0). This is the
    distance metric used in Hierarchical Risk Parity (Lopez de Prado,
    2016) -- chosen here (rather than a simpler ``1 - abs(rho)``) because
    it is a true metric (satisfies the triangle inequality), which
    ``1 - abs(rho)`` is not guaranteed to.

    A NaN correlation (which arises from a zero-variance/constant column in
    the fold's data -- there is no defined linear relationship to report)
    is treated as uncorrelated (filled with rho=0, i.e. distance=sqrt(0.5))
    rather than silently dropped or left as NaN, which would break the
    downstream linkage computation. The diagonal is always forced back to
    self-distance=0 after that fill, since a feature is never "uncorrelated
    with itself" even if its own variance happens to be zero.
    """
    values = corr.to_numpy()
    if not np.allclose(values, values.T, atol=1e-8, equal_nan=True):
        raise ValueError("correlation_distance: input must be a symmetric correlation matrix")

    clipped = corr.clip(-1.0, 1.0)
    if clipped.isna().any().any():
        filled = clipped.fillna(0.0).to_numpy(copy=True)
        np.fill_diagonal(filled, 1.0)
        clipped = pd.DataFrame(filled, index=corr.index, columns=corr.columns)

    return np.sqrt(0.5 * (1.0 - clipped))


def hierarchical_linkage(corr: pd.DataFrame, method: str = "single") -> np.ndarray:
    """Hierarchical clustering linkage matrix from a correlation matrix.

    Uses the HRP correlation distance (`correlation_distance`) and scipy's
    `linkage` on the condensed distance form. ``method="single"``
    (nearest-neighbor linkage) is the standard choice in the HRP
    literature -- pinned explicitly here rather than relying on scipy's
    own default (which happens to also be "single", but that coincidence
    is not a substitute for stating the choice).
    """
    dist = correlation_distance(corr)
    condensed = squareform(dist.to_numpy(), checks=False)
    return linkage(condensed, method=method)


def cluster_features(
    corr: pd.DataFrame, corr_threshold: float = 0.65, method: str = "single"
) -> dict[int, list[str]]:
    """Group features such that features within a cluster have pairwise
    correlation approximately >= ``corr_threshold``.

    ``corr_threshold`` is converted to the equivalent HRP distance
    (`correlation_distance`) and used to cut the dendrogram
    (``fcluster(..., criterion="distance")``) -- directly implementing the
    "Identifikation von stark korrelierten Faktorgruppen (z.B. Correlation
    > 0.65)" requirement.

    Parameters
    ----------
    corr : pd.DataFrame
        Square, symmetric correlation matrix (e.g. ``X_train.corr()``).
    corr_threshold : float
        Minimum pairwise correlation for two features to be considered
        part of the same group (must be in [0, 1]).
    method : str
        Linkage method, passed to `hierarchical_linkage`.

    Returns
    -------
    dict[int, list[str]]
        Cluster id -> list of feature names in that cluster. Singleton
        clusters (a feature correlated with nothing above the threshold)
        are included too, as clusters of size 1.
    """
    if not (0.0 <= corr_threshold <= 1.0):
        raise ValueError(f"corr_threshold must be in [0, 1], got {corr_threshold}")

    features = list(corr.columns)
    if len(features) == 1:
        return {1: features}

    Z = hierarchical_linkage(corr, method=method)
    distance_threshold = float(np.sqrt(0.5 * (1.0 - corr_threshold)))
    labels = fcluster(Z, t=distance_threshold, criterion="distance")

    clusters: dict[int, list[str]] = {}
    for feature, label in zip(features, labels):
        clusters.setdefault(int(label), []).append(feature)
    return clusters


def select_cluster_representatives(
    clusters: dict[int, list[str]], stability_scores: pd.Series
) -> dict[int, str]:
    """Pick the single most stable feature from each cluster.

    ``stability_scores`` must be indexed by feature name, higher = more
    stable/preferred (see evaluate.py for how cross-fold stability is
    computed there). Ties are broken alphabetically by feature name, for
    determinism.

    Raises
    ------
    KeyError
        If a cluster contains a feature missing from ``stability_scores``
        -- intentionally not silently defaulted to e.g. 0, since a missing
        score almost always means the caller mismatched the feature set
        between clustering and evaluation, which should fail loudly.
    """
    representatives: dict[int, str] = {}
    for cluster_id, members in clusters.items():
        missing = [m for m in members if m not in stability_scores.index]
        if missing:
            raise KeyError(f"cluster {cluster_id}: stability_scores missing for {missing}")
        best = sorted(members, key=lambda f: (-stability_scores[f], f))[0]
        representatives[cluster_id] = best
    return representatives


def clustered_feature_importance(
    importances: pd.Series, clusters: dict[int, list[str]]
) -> pd.Series:
    """Clustered Feature Importance (CFI): sum the individual (e.g. MDI)
    importances of the features within each cluster into one cluster-level
    importance.

    Rationale: standard impurity-based importance splits credit among
    correlated features (two near-duplicate features each get roughly half
    the "true" combined importance they would have as a single feature) --
    summing within a cluster recovers an estimate of the cluster's total
    explanatory contribution, avoiding the illusion that collinear features
    are individually unimportant just because they share credit.

    Returns
    -------
    pd.Series indexed by cluster id.
    """
    out: dict[int, float] = {}
    for cluster_id, members in clusters.items():
        missing = [m for m in members if m not in importances.index]
        if missing:
            raise KeyError(f"cluster {cluster_id}: importances missing for {missing}")
        out[cluster_id] = float(importances[members].sum())
    return pd.Series(out, name="clustered_importance")
