"""Tests for src/selection/orthogonal.py and src/selection/evaluate.py.

Includes the task-required synthetic benchmark (noise, a regime change, and
multicollinearity) demonstrating that walk-forward cross-fold evaluation
more reliably eliminates a collinear-and-noisier duplicate feature and a
spuriously-correlated feature than a naive single-window selection would.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.selection.evaluate import (
    adf_stationarity_test,
    evaluate_features,
    feature_importance_mdi,
    information_coefficient,
)
from src.selection.orthogonal import (
    cluster_features,
    clustered_feature_importance,
    correlation_distance,
    select_cluster_representatives,
)
from src.validation.walk_forward import PurgedWalkForwardCV

# ---------------------------------------------------------------------------
# orthogonal.py
# ---------------------------------------------------------------------------


class TestCorrelationDistance:
    def test_perfect_correlation_zero_distance(self):
        corr = pd.DataFrame([[1.0, 1.0], [1.0, 1.0]], index=["a", "b"], columns=["a", "b"])
        d = correlation_distance(corr)
        assert np.isclose(d.loc["a", "b"], 0.0)

    def test_perfect_anticorrelation_max_distance(self):
        corr = pd.DataFrame([[1.0, -1.0], [-1.0, 1.0]], index=["a", "b"], columns=["a", "b"])
        d = correlation_distance(corr)
        assert np.isclose(d.loc["a", "b"], 1.0)

    def test_zero_correlation_midpoint_distance(self):
        corr = pd.DataFrame([[1.0, 0.0], [0.0, 1.0]], index=["a", "b"], columns=["a", "b"])
        d = correlation_distance(corr)
        assert np.isclose(d.loc["a", "b"], np.sqrt(0.5))

    def test_rejects_asymmetric_matrix(self):
        corr = pd.DataFrame([[1.0, 0.5], [0.3, 1.0]], index=["a", "b"], columns=["a", "b"])
        with pytest.raises(ValueError):
            correlation_distance(corr)

    def test_handles_nan_from_constant_column(self):
        corr = pd.DataFrame(
            [[1.0, np.nan, 0.5], [np.nan, np.nan, np.nan], [0.5, np.nan, 1.0]],
            index=["a", "b", "c"],
            columns=["a", "b", "c"],
        )
        d = correlation_distance(corr)
        assert not d.isna().any().any()
        assert np.isclose(d.loc["b", "b"], 0.0)  # self-distance always 0


class TestClusterFeatures:
    def test_two_correlated_features_form_one_cluster(self):
        rng = np.random.default_rng(0)
        base = rng.normal(size=200)
        df = pd.DataFrame(
            {
                "a": base,
                "b": base + rng.normal(scale=0.05, size=200),  # near-duplicate, corr > 0.99
                "c": rng.normal(size=200),  # independent
            }
        )
        clusters = cluster_features(df.corr(), corr_threshold=0.65)
        cluster_of = {f: cid for cid, members in clusters.items() for f in members}
        assert cluster_of["a"] == cluster_of["b"]
        assert cluster_of["c"] != cluster_of["a"]

    def test_uncorrelated_features_each_singleton(self):
        rng = np.random.default_rng(1)
        df = pd.DataFrame({f"f{i}": rng.normal(size=200) for i in range(4)})
        clusters = cluster_features(df.corr(), corr_threshold=0.65)
        assert len(clusters) == 4
        assert all(len(members) == 1 for members in clusters.values())

    def test_single_feature(self):
        df = pd.DataFrame({"only": np.arange(10.0)})
        clusters = cluster_features(df.corr(), corr_threshold=0.65)
        assert list(clusters.values()) == [["only"]]

    def test_invalid_threshold_rejected(self):
        df = pd.DataFrame({"a": [1.0, 2.0], "b": [2.0, 1.0]})
        with pytest.raises(ValueError):
            cluster_features(df.corr(), corr_threshold=1.5)


class TestSelectClusterRepresentatives:
    def test_picks_highest_stability(self):
        clusters = {1: ["a", "b"], 2: ["c"]}
        stability = pd.Series({"a": 0.3, "b": 0.9, "c": 0.5})
        reps = select_cluster_representatives(clusters, stability)
        assert reps == {1: "b", 2: "c"}

    def test_missing_feature_raises(self):
        clusters = {1: ["a", "b"]}
        stability = pd.Series({"a": 0.3})
        with pytest.raises(KeyError):
            select_cluster_representatives(clusters, stability)

    def test_deterministic_tie_break(self):
        clusters = {1: ["b", "a"]}
        stability = pd.Series({"a": 0.5, "b": 0.5})
        reps = select_cluster_representatives(clusters, stability)
        assert reps[1] == "a"  # alphabetical tie-break


class TestClusteredFeatureImportance:
    def test_sums_within_cluster(self):
        clusters = {1: ["a", "b"], 2: ["c"]}
        importances = pd.Series({"a": 0.2, "b": 0.3, "c": 0.5})
        cfi = clustered_feature_importance(importances, clusters)
        assert np.isclose(cfi[1], 0.5)
        assert np.isclose(cfi[2], 0.5)

    def test_missing_feature_raises(self):
        clusters = {1: ["a", "b"]}
        importances = pd.Series({"a": 0.2})
        with pytest.raises(KeyError):
            clustered_feature_importance(importances, clusters)


# ---------------------------------------------------------------------------
# evaluate.py -- building blocks
# ---------------------------------------------------------------------------


class TestInformationCoefficient:
    def test_perfect_positive_correlation(self):
        f = pd.Series(np.arange(50.0))
        r = pd.Series(np.arange(50.0) * 2 + 1)
        assert np.isclose(information_coefficient(f, r), 1.0)

    def test_spearman_robust_to_monotonic_nonlinearity(self):
        f = pd.Series(np.arange(1, 51.0))
        r = f**3
        assert np.isclose(information_coefficient(f, r, method="spearman"), 1.0)

    def test_insufficient_data_returns_nan(self):
        f = pd.Series([1.0, np.nan])
        r = pd.Series([1.0, 2.0])
        assert np.isnan(information_coefficient(f, r))

    def test_invalid_method_raises(self):
        with pytest.raises(ValueError):
            information_coefficient(pd.Series([1.0]), pd.Series([1.0]), method="kendall")


class TestAdfStationarityTest:
    def test_white_noise_is_stationary(self):
        rng = np.random.default_rng(2)
        series = pd.Series(rng.normal(size=300), name="noise")
        result = adf_stationarity_test(series)
        assert result.is_stationary
        assert not result.insufficient_data

    def test_random_walk_is_not_stationary(self):
        rng = np.random.default_rng(3)
        series = pd.Series(np.cumsum(rng.normal(size=300)), name="rw")
        result = adf_stationarity_test(series)
        assert not result.is_stationary

    def test_insufficient_data_flagged_not_fabricated(self):
        series = pd.Series([1.0, 2.0, 3.0], name="short")
        result = adf_stationarity_test(series, min_obs=20)
        assert result.insufficient_data
        assert np.isnan(result.p_value)


class TestFeatureImportanceMdi:
    def test_informative_feature_ranked_above_noise(self):
        rng = np.random.default_rng(4)
        n = 300
        signal = rng.normal(size=n)
        X = pd.DataFrame({"informative": signal, "noise": rng.normal(size=n)})
        y = pd.Series(signal * 2 + rng.normal(scale=0.1, size=n))
        importances = feature_importance_mdi(X, y, n_estimators=50)
        assert importances["informative"] > importances["noise"]

    def test_too_few_rows_raises(self):
        X = pd.DataFrame({"a": [1.0, 2.0, 3.0]})
        y = pd.Series([1.0, 2.0, 3.0])
        with pytest.raises(ValueError):
            feature_importance_mdi(X, y)


def _make_toy_dataset(n: int, seed: int) -> tuple[pd.DataFrame, dict[str, pd.Series]]:
    rng = np.random.default_rng(seed)
    idx = pd.date_range("2024-01-01", periods=n, freq="h")
    signal = rng.normal(size=n)
    X = pd.DataFrame({"informative": signal, "noise": rng.normal(size=n)}, index=idx)
    forward_return = pd.Series(signal * 1.5 + rng.normal(scale=0.5, size=n), index=idx)
    return X, {"1h": forward_return}


# ---------------------------------------------------------------------------
# Fold discipline: the task's core methodology rule, verified directly
# ---------------------------------------------------------------------------


class TestFoldDiscipline:
    def test_clustering_uses_train_only_correlation(self, monkeypatch):
        """Independently recomputes what the train-only correlation matrix
        SHOULD be for every fold (calling cv.split(X) a second time,
        outside evaluate_features) and asserts the matrices actually passed
        to cluster_features() inside evaluate_features() are byte-for-byte
        identical -- i.e. clustering never sees a matrix computed on
        anything but that exact fold's train rows."""
        import src.selection.evaluate as evaluate_module

        captured: list[pd.DataFrame] = []
        original = evaluate_module.cluster_features

        def spy(corr, **kwargs):
            captured.append(corr)
            return original(corr, **kwargs)

        monkeypatch.setattr(evaluate_module, "cluster_features", spy)

        X, forward_returns = _make_toy_dataset(n=400, seed=5)
        cv = PurgedWalkForwardCV(n_splits=3, train_size=100, test_size=50, purge_window=5, embargo_window=5)
        expected_corrs = [X.iloc[train_idx].corr() for train_idx, _ in cv.split(X)]

        evaluate_features(X, forward_returns, cv, n_estimators=20)

        assert len(captured) == len(expected_corrs) == cv.n_splits
        for captured_corr, expected_corr in zip(captured, expected_corrs):
            pd.testing.assert_frame_equal(captured_corr, expected_corr)

    def test_importance_fit_only_on_train_rows(self, monkeypatch):
        import src.selection.evaluate as evaluate_module

        seen_lengths: list[int] = []
        original = evaluate_module.feature_importance_mdi

        def spy(X_train, y_train, **kwargs):
            seen_lengths.append(len(X_train))
            return original(X_train, y_train, **kwargs)

        monkeypatch.setattr(evaluate_module, "feature_importance_mdi", spy)

        X, forward_returns = _make_toy_dataset(n=400, seed=6)
        cv = PurgedWalkForwardCV(n_splits=3, train_size=100, test_size=50, purge_window=5, embargo_window=5)

        report = evaluate_features(X, forward_returns, cv, n_estimators=20)

        assert seen_lengths == [fr.train_size for fr in report.fold_results]

    def test_ic_uses_test_only_rows(self):
        """IC should differ from a hypothetical train-computed IC whenever
        train and test rows have a different relationship -- verified here
        by directly recomputing IC on the test slice ourselves and
        comparing to the report."""
        X, forward_returns = _make_toy_dataset(n=400, seed=7)
        cv = PurgedWalkForwardCV(n_splits=3, train_size=100, test_size=50, purge_window=5, embargo_window=5)

        report = evaluate_features(X, forward_returns, cv, n_estimators=20)

        for fold_result, (_, test_idx) in zip(report.fold_results, cv.split(X)):
            expected_ic = information_coefficient(
                X["informative"].iloc[test_idx], forward_returns["1h"].iloc[test_idx]
            )
            assert np.isclose(fold_result.ic["1h"]["informative"], expected_ic, equal_nan=True)


# ---------------------------------------------------------------------------
# evaluate_features: basic validation
# ---------------------------------------------------------------------------


class TestEvaluateFeaturesValidation:
    def test_mismatched_forward_return_length_raises(self):
        X, forward_returns = _make_toy_dataset(n=400, seed=8)
        forward_returns["1h"] = forward_returns["1h"].iloc[:-1]
        cv = PurgedWalkForwardCV(n_splits=3, train_size=100, test_size=50, purge_window=5, embargo_window=5)
        with pytest.raises(ValueError, match="length"):
            evaluate_features(X, forward_returns, cv)

    def test_empty_forward_returns_raises(self):
        X, _ = _make_toy_dataset(n=400, seed=9)
        cv = PurgedWalkForwardCV(n_splits=3, train_size=100, test_size=50, purge_window=5, embargo_window=5)
        with pytest.raises(ValueError, match="forward_returns"):
            evaluate_features(X, {}, cv)

    def test_all_nan_x_raises(self):
        idx = pd.date_range("2024-01-01", periods=100, freq="h")
        X = pd.DataFrame({"a": [np.nan] * 100}, index=idx)
        y = pd.Series(np.zeros(100), index=idx)
        cv = PurgedWalkForwardCV(n_splits=2, test_size=20, purge_window=2, embargo_window=2)
        with pytest.raises(ValueError, match="NaN"):
            evaluate_features(X, {"1h": y}, cv)


# ---------------------------------------------------------------------------
# Full synthetic benchmark: noise, regime change, multicollinearity
# ---------------------------------------------------------------------------


def _build_synthetic_benchmark(seed: int = 123, n: int = 1000):
    """Deterministic synthetic dataset with:

      - feature_A: a clean, consistently-informative proxy for latent_1,
        one of two independent latent drivers of forward_return.
      - feature_B: a collinear, strictly-noisier duplicate of feature_A
        (corr(A, B) ~= 0.75, above the 0.65 threshold) -- exercises
        multicollinearity elimination: A should survive, B should not.
      - feature_C: engineered to track forward_return closely ONLY in bars
        [0, 150) -- a deterministic, constructed stand-in for "looked great
        on a naive single-window check" (not reliant on random luck: the
        alignment is built directly, not hoped for from a random draw).
        This window is placed entirely *before* every walk-forward test
        block (see CV parameters below), so it can never leak into any
        fold's out-of-sample IC evaluation -- purely noise everywhere else.
      - feature_D: a second, independent informative feature (driven by
        latent_2), weakly correlated with A/B -- should survive as its own
        cluster.
      - Regime change: the noise magnitude on forward_return doubles after
        bar 500 (a volatility regime shift) while the sign/direction of the
        true relationship (to latent_1, latent_2) stays constant throughout,
        so A/D remain identifiably informative across the whole series
        despite the regime change affecting different folds differently.
    """
    rng = np.random.default_rng(seed)

    latent_1 = rng.normal(size=n)
    latent_2 = rng.normal(size=n)

    noise_scale = np.where(np.arange(n) < 500, 0.3, 0.6)  # regime change at bar 500
    forward_return = pd.Series(
        0.8 * latent_1 + 0.5 * latent_2 + rng.normal(scale=1.0, size=n) * noise_scale
    )

    feature_A = latent_1 + rng.normal(scale=0.15, size=n)
    feature_B = feature_A + rng.normal(scale=0.9, size=n)  # collinear w/ A, much noisier
    feature_D = latent_2 + rng.normal(scale=0.2, size=n)

    feature_C = rng.normal(size=n)
    engineered_window = slice(0, 150)
    feature_C[engineered_window] = (
        forward_return.to_numpy()[engineered_window] + rng.normal(scale=0.2, size=150)
    )

    X = pd.DataFrame(
        {"feature_A": feature_A, "feature_B": feature_B, "feature_C": feature_C, "feature_D": feature_D}
    )
    return X, {"1h": forward_return}


class TestSyntheticBenchmark:
    N_SPLITS = 4
    TRAIN_SIZE = 250
    TEST_SIZE = 100
    PURGE = 5
    EMBARGO = 5

    @classmethod
    @pytest.fixture(scope="class")
    def benchmark(cls):
        X, forward_returns = _build_synthetic_benchmark()
        cv = PurgedWalkForwardCV(
            n_splits=cls.N_SPLITS,
            train_size=cls.TRAIN_SIZE,
            test_size=cls.TEST_SIZE,
            purge_window=cls.PURGE,
            embargo_window=cls.EMBARGO,
            expanding=True,
        )
        report = evaluate_features(X, forward_returns, cv, corr_threshold=0.65, n_estimators=100)
        return X, forward_returns, report, cv

    def test_engineered_window_never_appears_in_any_test_fold(self, benchmark):
        """Sanity check on the benchmark's own construction: the first test
        block must start after bar 150, so feature_C's engineered alignment
        is guaranteed to never be evaluated as if it were genuine
        out-of-sample signal."""
        X, _, _, cv = benchmark
        for _, test_idx in cv.split(X):
            assert test_idx.min() >= 150

    def test_a_and_b_are_clustered_together(self, benchmark):
        _, _, report, _ = benchmark
        cluster_of = {f: cid for cid, members in report.final_clusters.items() for f in members}
        assert cluster_of["feature_A"] == cluster_of["feature_B"]

    def test_d_forms_its_own_cluster(self, benchmark):
        _, _, report, _ = benchmark
        cluster_of = {f: cid for cid, members in report.final_clusters.items() for f in members}
        assert cluster_of["feature_D"] != cluster_of["feature_A"]

    def test_a_selected_over_noisier_duplicate_b(self, benchmark):
        _, _, report, _ = benchmark
        assert "feature_A" in report.selected_features
        assert "feature_B" not in report.selected_features

    def test_d_survives_selection(self, benchmark):
        _, _, report, _ = benchmark
        assert "feature_D" in report.selected_features

    def test_a_has_higher_cross_fold_selection_frequency_than_b(self, benchmark):
        _, _, report, _ = benchmark
        summary = report.summary
        assert summary.loc["feature_A", "selection_frequency"] >= summary.loc["feature_B", "selection_frequency"]

    def test_a_more_importance_stable_than_b(self, benchmark):
        _, _, report, _ = benchmark
        summary = report.summary
        assert summary.loc["feature_A", "importance_stability"] > summary.loc["feature_B", "importance_stability"]

    def test_walk_forward_ic_correctly_flags_feature_c_as_unreliable(self, benchmark):
        """The core 'more reliable than naive selection' demonstration: a
        naive check restricted to the first (engineered) window rates
        feature_C very favorably, while the genuine walk-forward,
        all-out-of-sample-folds IC average correctly shows it is not a
        reliable predictor."""
        X, forward_returns, report, _ = benchmark

        naive_ic = information_coefficient(
            X["feature_C"].iloc[:150], forward_returns["1h"].iloc[:150], method="pearson"
        )
        walk_forward_ic = report.summary.loc["feature_C", "ic_mean_1h"]

        assert abs(naive_ic) > 0.5, "sanity check: the engineered early window really does look predictive"
        assert abs(walk_forward_ic) < abs(naive_ic) / 2, (
            f"walk-forward cross-fold IC ({walk_forward_ic:.3f}) should be much smaller in "
            f"magnitude than the naive single-window IC ({naive_ic:.3f}), demonstrating that "
            "cross-fold evaluation is not fooled by the engineered early alignment"
        )

    def test_feature_c_ic_much_weaker_than_genuinely_informative_features(self, benchmark):
        _, _, report, _ = benchmark
        summary = report.summary
        assert abs(summary.loc["feature_C", "ic_mean_1h"]) < abs(summary.loc["feature_A", "ic_mean_1h"])
        assert abs(summary.loc["feature_C", "ic_mean_1h"]) < abs(summary.loc["feature_D", "ic_mean_1h"])

    def test_all_folds_ran_and_report_is_well_formed(self, benchmark):
        _, _, report, _ = benchmark
        assert len(report.fold_results) == self.N_SPLITS
        assert set(report.summary.index) == {"feature_A", "feature_B", "feature_C", "feature_D"}
        assert not report.summary["mean_importance"].isna().any()

    def test_expanding_train_sizes_grow_across_folds(self, benchmark):
        _, _, report, _ = benchmark
        sizes = [fr.train_size for fr in report.fold_results]
        assert sizes == sorted(sizes)
        assert sizes[0] >= self.TRAIN_SIZE
