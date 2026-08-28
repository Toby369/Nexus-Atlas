"""Tests for src/validation/decision_framework.py.

Covers, per the work package's explicit requirement ("100% Determinismus,
feste Seeds, klare Assertions fuer alle Entscheidungs-Pfade"): a golden-value
cross-check of statistical_power/required_sample_size against the exact
required-n table published in docs/research/PHASE-3.2-PROTOCOL-CORRECTION.md
Section 8; PASS/INSUFFICIENT_DATA paths for Gate 1 and Gate 2;
PASS/FAIL/INSUFFICIENT_DATA paths for Gate 3 and Gate 4 (deterministic seeded
synthetic data throughout); and exhaustive combine_gate_results() coverage of
all combination rules (INSUFFICIENT_DATA priority, all-PASS -> MIGRATE,
mixed FAIL-only -> REJECT, malformed gate sets -> ValueError).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from src.validation.decision_framework import (
    CoverageGateConfig,
    GateResult,
    GateStatus,
    MigrationDecision,
    PerformanceGateConfig,
    PowerGateConfig,
    StabilityGateConfig,
    combine_gate_results,
    compute_feature_coverage,
    evaluate_gate_1_statistical_power,
    evaluate_gate_2_feature_coverage,
    evaluate_gate_3_performance,
    evaluate_gate_4_stability,
    required_sample_size,
    statistical_power,
)


# ---------------------------------------------------------------------------
# statistical_power / required_sample_size
# ---------------------------------------------------------------------------


class TestPowerMatchesPhase32:
    """Golden-value cross-check: docs/research/PHASE-3.2-PROTOCOL-CORRECTION.md
    Section 8's required-n table (baseline p0=0.535, alpha=0.05, target
    power=0.80) -- reimplemented independently here, not imported from the
    docs, exactly the same golden-value discipline used elsewhere in this
    project (e.g. test_legacy_factors.py's reference_factors_jsonb check)."""

    BASELINE = 0.535

    @pytest.mark.parametrize(
        "effect,expected_n",
        [
            (0.05, 776),
            (0.08, 301),
            (0.10, 192),
            (0.13, 112),
            (0.15, 84),
        ],
    )
    def test_required_n_matches_phase_3_2_table(self, effect, expected_n):
        assert required_sample_size(self.BASELINE, effect) == expected_n

    def test_power_at_required_n_meets_target(self):
        for effect in [0.05, 0.08, 0.10, 0.13, 0.15]:
            n = required_sample_size(self.BASELINE, effect)
            assert statistical_power(n, self.BASELINE, effect) >= 0.80

    def test_power_at_n_minus_one_below_target(self):
        # required_sample_size must return the SMALLEST n meeting target
        # power -- n-1 must fail it, else the binary search is off by one.
        for effect in [0.05, 0.08, 0.10, 0.13, 0.15]:
            n = required_sample_size(self.BASELINE, effect)
            assert statistical_power(n - 1, self.BASELINE, effect) < 0.80

    def test_power_increases_monotonically_with_n(self):
        powers = [statistical_power(n, self.BASELINE, 0.10) for n in [50, 100, 192, 400, 800]]
        assert all(a < b for a, b in zip(powers, powers[1:]))

    def test_power_increases_with_effect_size(self):
        powers = [statistical_power(200, self.BASELINE, e) for e in [0.05, 0.08, 0.10, 0.13, 0.15]]
        assert all(a < b for a, b in zip(powers, powers[1:]))

    def test_invalid_n_raises(self):
        with pytest.raises(ValueError):
            statistical_power(0, self.BASELINE, 0.10)
        with pytest.raises(ValueError):
            statistical_power(-5, self.BASELINE, 0.10)

    def test_invalid_baseline_raises(self):
        with pytest.raises(ValueError):
            statistical_power(100, 0.0, 0.10)
        with pytest.raises(ValueError):
            statistical_power(100, 1.0, 0.10)

    def test_baseline_plus_effect_out_of_bounds_raises(self):
        with pytest.raises(ValueError):
            statistical_power(100, 0.95, 0.10)

    def test_invalid_alpha_raises(self):
        with pytest.raises(ValueError):
            statistical_power(100, self.BASELINE, 0.10, alpha=0.0)
        with pytest.raises(ValueError):
            statistical_power(100, self.BASELINE, 0.10, alpha=1.0)

    def test_invalid_target_power_raises(self):
        with pytest.raises(ValueError):
            required_sample_size(self.BASELINE, 0.10, target_power=0.0)
        with pytest.raises(ValueError):
            required_sample_size(self.BASELINE, 0.10, target_power=1.0)

    def test_unreachable_target_power_raises(self):
        # An effect so tiny that even max_n cannot reach target_power.
        with pytest.raises(ValueError):
            required_sample_size(0.5, 0.0001, max_n=1000)


# ---------------------------------------------------------------------------
# Gate 1 -- Statistical Power
# ---------------------------------------------------------------------------


class TestGate1StatisticalPower:
    def test_pass_when_n_exceeds_required(self):
        config = PowerGateConfig(baseline=0.535, min_detectable_effect=0.15)
        result = evaluate_gate_1_statistical_power(n_obs=1000, config=config)
        assert result.status == GateStatus.PASS
        assert result.gate_number == 1
        assert result.details["required_n"] == 84

    def test_insufficient_data_when_n_below_required(self):
        config = PowerGateConfig(baseline=0.535, min_detectable_effect=0.05)
        result = evaluate_gate_1_statistical_power(n_obs=201, config=config)
        assert result.status == GateStatus.INSUFFICIENT_DATA
        assert result.details["required_n"] == 776

    def test_never_returns_fail(self):
        # Gate 1 has exactly two reachable statuses -- PASS or
        # INSUFFICIENT_DATA -- never FAIL (inadequate power is a statement
        # about the sample, not the candidate).
        for n_obs in [1, 10, 84, 201, 776, 5000]:
            config = PowerGateConfig(baseline=0.535, min_detectable_effect=0.10)
            result = evaluate_gate_1_statistical_power(n_obs=n_obs, config=config)
            assert result.status in (GateStatus.PASS, GateStatus.INSUFFICIENT_DATA)

    def test_boundary_at_exact_required_n_passes(self):
        config = PowerGateConfig(baseline=0.535, min_detectable_effect=0.15)
        required_n = result_required_n = 84
        result = evaluate_gate_1_statistical_power(n_obs=required_n, config=config)
        assert result.status == GateStatus.PASS


# ---------------------------------------------------------------------------
# Gate 2 -- Feature Coverage
# ---------------------------------------------------------------------------


class TestGate2FeatureCoverage:
    @classmethod
    @pytest.fixture(scope="class")
    def full_coverage_df(cls):
        return pd.DataFrame({"a": [1.0, 2.0, 3.0], "b": [1.0, 2.0, 3.0]})

    @classmethod
    @pytest.fixture(scope="class")
    def partial_coverage_df(cls):
        return pd.DataFrame({"a": [1.0, np.nan, 3.0], "b": [1.0, 2.0, 3.0]})

    def test_compute_feature_coverage_full(self, full_coverage_df):
        coverage = compute_feature_coverage(full_coverage_df)
        assert coverage["a"] == 1.0
        assert coverage["b"] == 1.0

    def test_compute_feature_coverage_partial(self, partial_coverage_df):
        coverage = compute_feature_coverage(partial_coverage_df)
        assert coverage["a"] == pytest.approx(2 / 3)

    def test_pass_when_all_required_features_meet_threshold(self, full_coverage_df):
        coverage = compute_feature_coverage(full_coverage_df)
        config = CoverageGateConfig(required_features=["a", "b"], min_coverage=1.0)
        result = evaluate_gate_2_feature_coverage(coverage, config)
        assert result.status == GateStatus.PASS
        assert result.gate_number == 2

    def test_insufficient_data_when_below_threshold(self, partial_coverage_df):
        coverage = compute_feature_coverage(partial_coverage_df)
        config = CoverageGateConfig(required_features=["a", "b"], min_coverage=1.0)
        result = evaluate_gate_2_feature_coverage(coverage, config)
        assert result.status == GateStatus.INSUFFICIENT_DATA
        assert "a" in result.details["below_threshold"]
        assert "b" not in result.details["below_threshold"]

    def test_insufficient_data_when_feature_missing_entirely(self, full_coverage_df):
        coverage = compute_feature_coverage(full_coverage_df)
        config = CoverageGateConfig(required_features=["a", "c"], min_coverage=1.0)
        result = evaluate_gate_2_feature_coverage(coverage, config)
        assert result.status == GateStatus.INSUFFICIENT_DATA
        assert result.details["missing_features"] == ["c"]

    def test_never_returns_fail(self, partial_coverage_df):
        coverage = compute_feature_coverage(partial_coverage_df)
        for min_cov in [0.0, 0.5, 0.9, 1.0]:
            config = CoverageGateConfig(required_features=["a", "b"], min_coverage=min_cov)
            result = evaluate_gate_2_feature_coverage(coverage, config)
            assert result.status in (GateStatus.PASS, GateStatus.INSUFFICIENT_DATA)

    def test_lenient_threshold_passes_partial_coverage(self, partial_coverage_df):
        coverage = compute_feature_coverage(partial_coverage_df)
        config = CoverageGateConfig(required_features=["a", "b"], min_coverage=0.5)
        result = evaluate_gate_2_feature_coverage(coverage, config)
        assert result.status == GateStatus.PASS


# ---------------------------------------------------------------------------
# Gate 3 -- Superior Out-of-Sample Performance & Inference
# ---------------------------------------------------------------------------


def _make_favorable_significant_series(n=400, p_true=0.75, seed=0):
    # condition_mask all True (every day eligible), outcome drawn well
    # above baseline -> should be both statistically significant and in
    # the favorable direction against a low baseline.
    rng = np.random.default_rng(seed)
    outcome = rng.random(n) < p_true
    condition_mask = np.ones(n, dtype=bool)
    return outcome, condition_mask


class TestGate3Performance:
    def test_pass_when_significant_relevant_and_favorable(self):
        outcome, mask = _make_favorable_significant_series(n=500, p_true=0.80, seed=1)
        config = PerformanceGateConfig(seed=1, min_practically_relevant_effect=0.05, n_replicates=500)
        result = evaluate_gate_3_performance(outcome, mask, baseline=0.50, config=config)
        assert result.status == GateStatus.PASS
        assert result.gate_number == 3
        assert result.details["favorable_direction"] is True
        assert result.details["statistically_significant"] is True
        assert result.details["practically_relevant"] is True

    def test_fail_when_unfavorable_direction(self):
        # Outcome deliberately drawn BELOW baseline -> significant but
        # wrong direction must be a genuine FAIL, not a pass.
        outcome, mask = _make_favorable_significant_series(n=500, p_true=0.20, seed=2)
        config = PerformanceGateConfig(seed=2, min_practically_relevant_effect=0.05, n_replicates=500)
        result = evaluate_gate_3_performance(outcome, mask, baseline=0.50, config=config)
        assert result.status == GateStatus.FAIL
        assert result.details["favorable_direction"] is False

    def test_fail_when_not_practically_relevant(self):
        # Small but consistent edge, deliberately below the practical
        # relevance threshold.
        rng = np.random.default_rng(3)
        n = 2000
        outcome = rng.random(n) < 0.515  # +1.5pp vs 0.50 baseline
        mask = np.ones(n, dtype=bool)
        config = PerformanceGateConfig(seed=3, min_practically_relevant_effect=0.05, n_replicates=500)
        result = evaluate_gate_3_performance(outcome, mask, baseline=0.50, config=config)
        assert result.details["practically_relevant"] is False
        assert result.status == GateStatus.FAIL

    def test_insufficient_data_when_condition_never_matches(self):
        n = 100
        outcome = np.zeros(n, dtype=bool)
        mask = np.zeros(n, dtype=bool)  # never eligible -> statistic_fn always NaN
        config = PerformanceGateConfig(seed=4, block_length=14, n_replicates=50)
        result = evaluate_gate_3_performance(outcome, mask, baseline=0.5, config=config)
        assert result.status == GateStatus.INSUFFICIENT_DATA
        assert "error" in result.details

    def test_deterministic_given_same_seed(self):
        outcome, mask = _make_favorable_significant_series(n=300, p_true=0.7, seed=5)
        config = PerformanceGateConfig(seed=99, n_replicates=300)
        r1 = evaluate_gate_3_performance(outcome, mask, baseline=0.5, config=config)
        r2 = evaluate_gate_3_performance(outcome, mask, baseline=0.5, config=config)
        assert r1.details["observed_difference"] == r2.details["observed_difference"]
        assert r1.details["p_value"] == r2.details["p_value"]
        assert r1.status == r2.status

    def test_never_raises_uncaught_valueerror(self):
        # The underlying block_bootstrap ValueError must always be caught
        # and reclassified as INSUFFICIENT_DATA, never propagated.
        n = 100
        outcome = np.zeros(n, dtype=bool)
        mask = np.zeros(n, dtype=bool)
        config = PerformanceGateConfig(seed=6, n_replicates=50)
        result = evaluate_gate_3_performance(outcome, mask, baseline=0.5, config=config)
        assert isinstance(result, GateResult)


# ---------------------------------------------------------------------------
# Gate 4 -- Systematic Stability & Overfitting Protection
# ---------------------------------------------------------------------------


class TestGate4Stability:
    def test_pass_when_both_metrics_meet_threshold(self):
        config = StabilityGateConfig(min_importance_stability=0.5, min_selection_frequency=0.5, min_n_folds=2)
        result = evaluate_gate_4_stability(
            importance_stability=0.8, selection_frequency=0.9, n_folds=5, config=config
        )
        assert result.status == GateStatus.PASS
        assert result.gate_number == 4

    def test_fail_when_importance_stability_below_threshold(self):
        config = StabilityGateConfig(min_importance_stability=0.5, min_selection_frequency=0.5, min_n_folds=2)
        result = evaluate_gate_4_stability(
            importance_stability=0.2, selection_frequency=0.9, n_folds=5, config=config
        )
        assert result.status == GateStatus.FAIL

    def test_fail_when_selection_frequency_below_threshold(self):
        config = StabilityGateConfig(min_importance_stability=0.5, min_selection_frequency=0.5, min_n_folds=2)
        result = evaluate_gate_4_stability(
            importance_stability=0.9, selection_frequency=0.1, n_folds=5, config=config
        )
        assert result.status == GateStatus.FAIL

    def test_insufficient_data_when_too_few_folds(self):
        config = StabilityGateConfig(min_n_folds=3)
        result = evaluate_gate_4_stability(importance_stability=0.9, selection_frequency=0.9, n_folds=2, config=config)
        assert result.status == GateStatus.INSUFFICIENT_DATA
        assert result.details["n_folds"] == 2

    def test_insufficient_data_when_importance_stability_nan(self):
        config = StabilityGateConfig(min_n_folds=2)
        result = evaluate_gate_4_stability(
            importance_stability=float("nan"), selection_frequency=0.9, n_folds=5, config=config
        )
        assert result.status == GateStatus.INSUFFICIENT_DATA

    def test_insufficient_data_when_selection_frequency_nan(self):
        config = StabilityGateConfig(min_n_folds=2)
        result = evaluate_gate_4_stability(
            importance_stability=0.9, selection_frequency=float("nan"), n_folds=5, config=config
        )
        assert result.status == GateStatus.INSUFFICIENT_DATA

    def test_boundary_exactly_at_threshold_passes(self):
        config = StabilityGateConfig(min_importance_stability=0.5, min_selection_frequency=0.5, min_n_folds=2)
        result = evaluate_gate_4_stability(
            importance_stability=0.5, selection_frequency=0.5, n_folds=2, config=config
        )
        assert result.status == GateStatus.PASS

    def test_boundary_exactly_at_min_n_folds_is_evaluable(self):
        config = StabilityGateConfig(min_n_folds=3)
        result = evaluate_gate_4_stability(importance_stability=0.9, selection_frequency=0.9, n_folds=3, config=config)
        assert result.status != GateStatus.INSUFFICIENT_DATA


# ---------------------------------------------------------------------------
# combine_gate_results
# ---------------------------------------------------------------------------


def _gate(number, status, name="gate"):
    return GateResult(gate_number=number, gate_name=name, status=status, rationale="", details={})


class TestCombineGateResults:
    def test_all_pass_yields_migrate(self):
        gates = [_gate(i, GateStatus.PASS) for i in [1, 2, 3, 4]]
        result = combine_gate_results(gates)
        assert result.decision == MigrationDecision.MIGRATE
        assert [g.gate_number for g in result.gates] == [1, 2, 3, 4]

    def test_any_insufficient_data_yields_insufficient_data(self):
        gates = [
            _gate(1, GateStatus.PASS),
            _gate(2, GateStatus.PASS),
            _gate(3, GateStatus.PASS),
            _gate(4, GateStatus.INSUFFICIENT_DATA),
        ]
        result = combine_gate_results(gates)
        assert result.decision == MigrationDecision.INSUFFICIENT_DATA

    def test_insufficient_data_takes_priority_over_fail(self):
        # A gate FAILs AND another is INSUFFICIENT_DATA -- must resolve to
        # INSUFFICIENT_DATA, never REJECT, per the documented priority rule.
        gates = [
            _gate(1, GateStatus.FAIL),
            _gate(2, GateStatus.PASS),
            _gate(3, GateStatus.PASS),
            _gate(4, GateStatus.INSUFFICIENT_DATA),
        ]
        result = combine_gate_results(gates)
        assert result.decision == MigrationDecision.INSUFFICIENT_DATA

    def test_any_fail_with_no_insufficient_data_yields_reject(self):
        gates = [
            _gate(1, GateStatus.PASS),
            _gate(2, GateStatus.PASS),
            _gate(3, GateStatus.FAIL),
            _gate(4, GateStatus.PASS),
        ]
        result = combine_gate_results(gates)
        assert result.decision == MigrationDecision.REJECT

    def test_all_fail_yields_reject(self):
        gates = [_gate(i, GateStatus.FAIL) for i in [1, 2, 3, 4]]
        result = combine_gate_results(gates)
        assert result.decision == MigrationDecision.REJECT

    def test_missing_gate_raises_value_error(self):
        gates = [_gate(i, GateStatus.PASS) for i in [1, 2, 3]]
        with pytest.raises(ValueError):
            combine_gate_results(gates)

    def test_duplicate_gate_raises_value_error(self):
        gates = [_gate(1, GateStatus.PASS), _gate(1, GateStatus.PASS), _gate(3, GateStatus.PASS), _gate(4, GateStatus.PASS)]
        with pytest.raises(ValueError):
            combine_gate_results(gates)

    def test_extra_gate_raises_value_error(self):
        gates = [_gate(i, GateStatus.PASS) for i in [1, 2, 3, 4, 5]]
        with pytest.raises(ValueError):
            combine_gate_results(gates)

    def test_result_gates_sorted_by_number_regardless_of_input_order(self):
        gates = [_gate(4, GateStatus.PASS), _gate(1, GateStatus.PASS), _gate(3, GateStatus.PASS), _gate(2, GateStatus.PASS)]
        result = combine_gate_results(gates)
        assert [g.gate_number for g in result.gates] == [1, 2, 3, 4]

    def test_rationale_mentions_insufficient_gates_by_name(self):
        gates = [
            _gate(1, GateStatus.PASS, name="Statistical Power"),
            _gate(2, GateStatus.INSUFFICIENT_DATA, name="Feature Coverage"),
            _gate(3, GateStatus.PASS),
            _gate(4, GateStatus.PASS),
        ]
        result = combine_gate_results(gates)
        assert "Feature Coverage" in result.rationale

    def test_rationale_mentions_failed_gates_by_name(self):
        gates = [
            _gate(1, GateStatus.PASS),
            _gate(2, GateStatus.PASS),
            _gate(3, GateStatus.FAIL, name="Performance"),
            _gate(4, GateStatus.PASS),
        ]
        result = combine_gate_results(gates)
        assert "Performance" in result.rationale


# ---------------------------------------------------------------------------
# End-to-end: full 4-gate pipeline on deterministic synthetic data
# ---------------------------------------------------------------------------


class TestEndToEndFourGatePipeline:
    def test_full_migrate_path(self):
        rng = np.random.default_rng(7)
        n = 1000
        df = pd.DataFrame({"f1": rng.random(n), "f2": rng.random(n)})

        gate1 = evaluate_gate_1_statistical_power(
            n_obs=n, config=PowerGateConfig(baseline=0.535, min_detectable_effect=0.15)
        )
        gate2 = evaluate_gate_2_feature_coverage(
            compute_feature_coverage(df), CoverageGateConfig(required_features=["f1", "f2"])
        )
        outcome = rng.random(n) < 0.80
        mask = np.ones(n, dtype=bool)
        gate3 = evaluate_gate_3_performance(
            outcome, mask, baseline=0.50, config=PerformanceGateConfig(seed=7, n_replicates=500)
        )
        gate4 = evaluate_gate_4_stability(
            importance_stability=0.9,
            selection_frequency=0.9,
            n_folds=6,
            config=StabilityGateConfig(),
        )

        result = combine_gate_results([gate1, gate2, gate3, gate4])
        assert all(g.status == GateStatus.PASS for g in result.gates)
        assert result.decision == MigrationDecision.MIGRATE

    def test_full_insufficient_data_path_realistic_n201(self):
        # Mirrors the actual current project state: n=201 (Phase 4
        # snapshot size) is insufficient for Gate 1 at the primary +5pp
        # effect -- this must propagate to overall INSUFFICIENT_DATA
        # regardless of the other three gates.
        rng = np.random.default_rng(8)
        n = 201
        df = pd.DataFrame({"f1": rng.random(n), "f2": rng.random(n)})

        gate1 = evaluate_gate_1_statistical_power(
            n_obs=n, config=PowerGateConfig(baseline=0.535, min_detectable_effect=0.05)
        )
        gate2 = evaluate_gate_2_feature_coverage(
            compute_feature_coverage(df), CoverageGateConfig(required_features=["f1", "f2"])
        )
        outcome = rng.random(n) < 0.80
        mask = np.ones(n, dtype=bool)
        gate3 = evaluate_gate_3_performance(
            outcome, mask, baseline=0.50, config=PerformanceGateConfig(seed=8, n_replicates=500)
        )
        gate4 = evaluate_gate_4_stability(
            importance_stability=0.9,
            selection_frequency=0.9,
            n_folds=6,
            config=StabilityGateConfig(),
        )

        assert gate1.status == GateStatus.INSUFFICIENT_DATA
        result = combine_gate_results([gate1, gate2, gate3, gate4])
        assert result.decision == MigrationDecision.INSUFFICIENT_DATA
