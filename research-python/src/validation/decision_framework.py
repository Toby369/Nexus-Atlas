"""Migration Decision Framework: formalizes the 4 Decision Gates from
BENCHMARK_RESULTS.md Section 8 into an automated, fully testable module.

Each gate is evaluated independently by its own function and returns a
``GateResult`` with one of three statuses -- never just pass/fail:

  - ``PASS``: evaluable, and the gate's criterion is met.
  - ``FAIL``: evaluable, and the gate's criterion is NOT met -- a genuine,
    informative negative finding.
  - ``INSUFFICIENT_DATA``: not evaluable with what's available (too few
    observations, missing coverage, a bootstrap that could not be
    computed). This is explicitly NOT the same as FAIL -- consistent with
    this project's consistent distinction (Phase 0-3.2, ROADMAP.md)
    between "no evidence of an edge" and "evidence of no edge". Concluding
    REJECT from missing data would be exactly as premature as concluding
    MIGRATE from it.

``combine_gate_results`` applies a strict, conservative rule (documented
below, not just implied) to turn the four gate results into one overall
``MigrationDecisionResult``:

  1. If ANY gate is INSUFFICIENT_DATA -> overall INSUFFICIENT_DATA.
  2. Else if ALL FOUR gates PASS -> overall MIGRATE.
  3. Else -> overall REJECT (at least one evaluable gate failed).

This module does not import anything from ``benchmark_production.py`` or
``evaluate.py`` -- each gate function takes plain, well-typed inputs
(arrays, floats, a pandas Series) so it can be tested and reused
independently of any particular calling pipeline. It reuses
``src/validation/block_bootstrap.py`` for Gate 3's dependence-aware
inference, per the approved work package -- no other existing module is
modified.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

import numpy as np
import pandas as pd
from scipy.stats import norm

from src.validation.block_bootstrap import (
    DEFAULT_BLOCK_LENGTH,
    BlockBootstrapResult,
    block_bootstrap_hit_rate_difference,
)

__all__ = [
    "GateStatus",
    "MigrationDecision",
    "GateResult",
    "MigrationDecisionResult",
    "statistical_power",
    "required_sample_size",
    "PowerGateConfig",
    "evaluate_gate_1_statistical_power",
    "CoverageGateConfig",
    "compute_feature_coverage",
    "evaluate_gate_2_feature_coverage",
    "PerformanceGateConfig",
    "evaluate_gate_3_performance",
    "StabilityGateConfig",
    "evaluate_gate_4_stability",
    "combine_gate_results",
]


class GateStatus(str, Enum):
    PASS = "PASS"
    FAIL = "FAIL"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"


class MigrationDecision(str, Enum):
    MIGRATE = "MIGRATE"
    REJECT = "REJECT"
    INSUFFICIENT_DATA = "INSUFFICIENT_DATA"


@dataclass
class GateResult:
    gate_number: int
    gate_name: str
    status: GateStatus
    rationale: str
    details: dict = field(default_factory=dict)


@dataclass
class MigrationDecisionResult:
    decision: MigrationDecision
    gates: list[GateResult]
    rationale: str


# ---------------------------------------------------------------------------
# Gate 1 -- Statistical Power & Minimum Sample Size
# ---------------------------------------------------------------------------


def statistical_power(n: int, baseline: float, effect: float, alpha: float = 0.05) -> float:
    """Two-sided one-sample proportion z-test power.

    Exactly the formula used throughout docs/research/PHASE-0..3.2 (H0:
    p=baseline, true p=baseline+effect, n observations). This is the same
    calculation, reimplemented independently in Python -- see
    ``tests/test_decision_framework.py::TestPowerMatchesPhase32`` for a
    golden-value cross-check against the exact required-n table published
    in ``docs/research/PHASE-3.2-PROTOCOL-CORRECTION.md`` Section 8.
    """
    if n <= 0:
        raise ValueError(f"n must be positive, got {n}")
    if not (0.0 < baseline < 1.0):
        raise ValueError(f"baseline must be in (0, 1), got {baseline}")
    if not (0.0 < alpha < 1.0):
        raise ValueError(f"alpha must be in (0, 1), got {alpha}")

    p0 = baseline
    p1 = baseline + effect
    if not (0.0 < p1 < 1.0):
        raise ValueError(f"baseline+effect ({p1}) must be in (0, 1)")

    z_crit = norm.ppf(1 - alpha / 2)
    se0 = np.sqrt(p0 * (1 - p0) / n)
    se1 = np.sqrt(p1 * (1 - p1) / n)
    crit_hi = p0 + z_crit * se0
    crit_lo = p0 - z_crit * se0
    power = 1 - norm.cdf((crit_hi - p1) / se1) + norm.cdf((crit_lo - p1) / se1)
    return float(power)


def required_sample_size(
    baseline: float, effect: float, alpha: float = 0.05, target_power: float = 0.80, max_n: int = 1_000_000
) -> int:
    """Smallest n achieving >= target_power for the given baseline/effect/alpha.

    Binary search over ``statistical_power`` (monotonically increasing in
    n), matching the exact approach used to produce Phase 3.2's required-n
    table.
    """
    if not (0.0 < target_power < 1.0):
        raise ValueError(f"target_power must be in (0, 1), got {target_power}")
    if statistical_power(max_n, baseline, effect, alpha) < target_power:
        raise ValueError(
            f"target_power={target_power} is not reachable for effect={effect} "
            f"even at n={max_n} -- the effect size may be too small to ever "
            "detect at a realistic sample size."
        )
    lo, hi = 2, max_n
    while lo < hi:
        mid = (lo + hi) // 2
        if statistical_power(mid, baseline, effect, alpha) < target_power:
            lo = mid + 1
        else:
            hi = mid
    return lo


@dataclass
class PowerGateConfig:
    baseline: float
    min_detectable_effect: float
    alpha: float = 0.05
    target_power: float = 0.80


def evaluate_gate_1_statistical_power(n_obs: int, config: PowerGateConfig) -> GateResult:
    """Gate 1: does the available sample size give adequate power to detect
    ``config.min_detectable_effect`` against ``config.baseline``?

    Status is PASS if achieved power >= target_power, else
    INSUFFICIENT_DATA (never FAIL -- inadequate power is a statement about
    the sample, not about the candidate factor set)."""
    achieved_power = statistical_power(n_obs, config.baseline, config.min_detectable_effect, config.alpha)
    required_n = required_sample_size(config.baseline, config.min_detectable_effect, config.alpha, config.target_power)
    passed = achieved_power >= config.target_power

    rationale = (
        f"n={n_obs}: achieved power={achieved_power:.3f} for effect="
        f"{config.min_detectable_effect:+.2%} against baseline={config.baseline:.3f} "
        f"({'>=' if passed else '<'} target {config.target_power:.2f}). "
        f"Required n for target power: {required_n}."
    )
    return GateResult(
        gate_number=1,
        gate_name="Statistical Power & Minimum Sample Size",
        status=GateStatus.PASS if passed else GateStatus.INSUFFICIENT_DATA,
        rationale=rationale,
        details={
            "n_obs": n_obs,
            "achieved_power": achieved_power,
            "required_n": required_n,
            "baseline": config.baseline,
            "min_detectable_effect": config.min_detectable_effect,
            "alpha": config.alpha,
            "target_power": config.target_power,
        },
    )


# ---------------------------------------------------------------------------
# Gate 2 -- Feature Coverage & Data Quality
# ---------------------------------------------------------------------------


@dataclass
class CoverageGateConfig:
    required_features: list[str]
    min_coverage: float = 1.0


def compute_feature_coverage(df: pd.DataFrame) -> pd.Series:
    """Fraction of non-null rows per column -- the same notion of
    "coverage" used throughout this project (Phase 6 audit,
    benchmark_production.py's LEGACY_EVALUABLE/NOT_EVALUABLE split)."""
    return df.notna().mean()


def evaluate_gate_2_feature_coverage(coverage: pd.Series, config: CoverageGateConfig) -> GateResult:
    """Gate 2: do all of ``config.required_features`` meet
    ``config.min_coverage`` in ``coverage``?

    Status is INSUFFICIENT_DATA (not FAIL) if any required feature is
    missing from ``coverage`` or below the threshold -- matching
    benchmark_production.py's own "NOT EVALUABLE is a data-availability
    finding, not a redundancy finding" distinction.
    """
    missing_features = [f for f in config.required_features if f not in coverage.index]
    below_threshold = {
        f: float(coverage[f])
        for f in config.required_features
        if f in coverage.index and coverage[f] < config.min_coverage
    }

    passed = not missing_features and not below_threshold
    if passed:
        rationale = (
            f"All {len(config.required_features)} required features meet the "
            f"{config.min_coverage:.0%} coverage threshold."
        )
        status = GateStatus.PASS
    else:
        parts = []
        if missing_features:
            parts.append(f"missing entirely: {missing_features}")
        if below_threshold:
            parts.append(
                "below threshold: "
                + ", ".join(f"{f}={cov:.1%}" for f, cov in below_threshold.items())
            )
        rationale = f"Coverage gate not met ({'; '.join(parts)}) -- data availability issue, not a redundancy finding."
        status = GateStatus.INSUFFICIENT_DATA

    return GateResult(
        gate_number=2,
        gate_name="Feature Coverage & Data Quality",
        status=status,
        rationale=rationale,
        details={
            "required_features": config.required_features,
            "min_coverage": config.min_coverage,
            "missing_features": missing_features,
            "below_threshold": below_threshold,
            "coverage": coverage.to_dict(),
        },
    )


# ---------------------------------------------------------------------------
# Gate 3 -- Superior Out-of-Sample Performance & Inference
# ---------------------------------------------------------------------------


@dataclass
class PerformanceGateConfig:
    seed: int | np.random.Generator
    alpha: float = 0.05
    # +5pp per docs/research/PHASE-3-RESEARCH-PROTOCOL.md Section 6.2 --
    # an explicitly NOT-yet-finalized discussion placeholder there, carried
    # over here unchanged rather than silently treated as settled.
    min_practically_relevant_effect: float = 0.05
    block_length: int = DEFAULT_BLOCK_LENGTH
    n_replicates: int = 5000


def evaluate_gate_3_performance(
    outcome: np.ndarray, condition_mask: np.ndarray, baseline: float, config: PerformanceGateConfig
) -> GateResult:
    """Gate 3: is the condition-masked hit rate both statistically
    significant AND practically relevant, dependence-corrected via
    ``block_bootstrap_hit_rate_difference``?

    PASS requires all three: p_value < alpha, |difference| >=
    min_practically_relevant_effect, AND the difference favors the
    candidate (positive -- higher hit rate than baseline). A
    statistically significant result in the WRONG direction is a genuine
    FAIL, not a pass.

    Status is INSUFFICIENT_DATA if the bootstrap itself cannot be computed
    (e.g. every resample lacks condition-matching observations, or the
    observed statistic itself is undefined) -- the underlying
    ``ValueError`` from block_bootstrap.py is caught and reclassified here
    rather than propagated as a crash.
    """
    try:
        boot: BlockBootstrapResult = block_bootstrap_hit_rate_difference(
            outcome=outcome,
            condition_mask=condition_mask,
            baseline=baseline,
            seed=config.seed,
            block_length=config.block_length,
            n_replicates=config.n_replicates,
        )
    except ValueError as exc:
        return GateResult(
            gate_number=3,
            gate_name="Superior Out-of-Sample Performance & Inference",
            status=GateStatus.INSUFFICIENT_DATA,
            rationale=f"Block bootstrap could not be computed: {exc}",
            details={"error": str(exc)},
        )

    statistically_significant = boot.p_value < config.alpha
    practically_relevant = abs(boot.difference) >= config.min_practically_relevant_effect
    favorable_direction = boot.difference > 0
    passed = statistically_significant and practically_relevant and favorable_direction

    rationale = (
        f"observed hit-rate difference={boot.difference:+.3f} vs baseline={baseline:.3f} "
        f"(95% CI [{boot.ci_lower:.3f}, {boot.ci_upper:.3f}], p={boot.p_value:.4f}, "
        f"n_valid_replicates={boot.n_valid_replicates}/{boot.n_replicates}). "
        f"Statistically significant: {statistically_significant} (alpha={config.alpha}). "
        f"Practically relevant: {practically_relevant} (threshold={config.min_practically_relevant_effect:+.2%}, "
        "NOT yet finalized -- see PowerGateConfig docstring / Phase 3 Section 6.2). "
        f"Favorable direction: {favorable_direction}."
    )
    return GateResult(
        gate_number=3,
        gate_name="Superior Out-of-Sample Performance & Inference",
        status=GateStatus.PASS if passed else GateStatus.FAIL,
        rationale=rationale,
        details={
            "observed_difference": boot.difference,
            "ci_lower": boot.ci_lower,
            "ci_upper": boot.ci_upper,
            "p_value": boot.p_value,
            "n_valid_replicates": boot.n_valid_replicates,
            "n_replicates": boot.n_replicates,
            "statistically_significant": statistically_significant,
            "practically_relevant": practically_relevant,
            "favorable_direction": favorable_direction,
        },
    )


# ---------------------------------------------------------------------------
# Gate 4 -- Systematic Stability & Overfitting Protection
# ---------------------------------------------------------------------------


@dataclass
class StabilityGateConfig:
    min_importance_stability: float = 0.5
    min_selection_frequency: float = 0.5
    min_n_folds: int = 2


def evaluate_gate_4_stability(
    importance_stability: float, selection_frequency: float, n_folds: int, config: StabilityGateConfig
) -> GateResult:
    """Gate 4: is the candidate feature consistently important and
    consistently selected across walk-forward folds -- i.e. not just a
    lucky single-fold result?

    ``importance_stability`` and ``selection_frequency`` are the same
    cross-fold metrics ``src/selection/evaluate.py``'s ``evaluate_features``
    already computes per feature (its ``summary`` DataFrame's
    ``importance_stability`` and ``selection_frequency`` columns) -- this
    function does not recompute them, it only judges them against a
    threshold, keeping this module decoupled from ``evaluate.py``'s types.

    Status is INSUFFICIENT_DATA if fewer than ``config.min_n_folds`` folds
    were available (a cross-fold consistency claim needs multiple folds by
    definition) or if either metric is NaN.
    """
    if n_folds < config.min_n_folds:
        return GateResult(
            gate_number=4,
            gate_name="Systematic Stability & Overfitting Protection",
            status=GateStatus.INSUFFICIENT_DATA,
            rationale=(
                f"Only {n_folds} fold(s) available, need >= {config.min_n_folds} to "
                "make any cross-fold consistency claim."
            ),
            details={"n_folds": n_folds, "min_n_folds": config.min_n_folds},
        )
    if np.isnan(importance_stability) or np.isnan(selection_frequency):
        return GateResult(
            gate_number=4,
            gate_name="Systematic Stability & Overfitting Protection",
            status=GateStatus.INSUFFICIENT_DATA,
            rationale="importance_stability or selection_frequency is NaN -- cannot evaluate.",
            details={"importance_stability": importance_stability, "selection_frequency": selection_frequency},
        )

    stable_importance = importance_stability >= config.min_importance_stability
    frequent_selection = selection_frequency >= config.min_selection_frequency
    passed = stable_importance and frequent_selection

    rationale = (
        f"importance_stability={importance_stability:.3f} "
        f"({'>=' if stable_importance else '<'} {config.min_importance_stability}), "
        f"selection_frequency={selection_frequency:.3f} "
        f"({'>=' if frequent_selection else '<'} {config.min_selection_frequency}), "
        f"across {n_folds} folds."
    )
    return GateResult(
        gate_number=4,
        gate_name="Systematic Stability & Overfitting Protection",
        status=GateStatus.PASS if passed else GateStatus.FAIL,
        rationale=rationale,
        details={
            "importance_stability": importance_stability,
            "selection_frequency": selection_frequency,
            "n_folds": n_folds,
            "min_importance_stability": config.min_importance_stability,
            "min_selection_frequency": config.min_selection_frequency,
        },
    )


# ---------------------------------------------------------------------------
# Combination
# ---------------------------------------------------------------------------


def combine_gate_results(gates: list[GateResult]) -> MigrationDecisionResult:
    """Combine the four gate results into one overall decision.

    Rule (strict, conservative, documented -- see module docstring):
      1. Any gate INSUFFICIENT_DATA -> overall INSUFFICIENT_DATA.
      2. All four gates PASS -> overall MIGRATE.
      3. Otherwise -> REJECT.

    Raises ValueError if ``gates`` does not contain exactly the four
    expected gate numbers {1, 2, 3, 4} -- a partial or duplicated gate set
    must not silently produce a decision.
    """
    gate_numbers = sorted(g.gate_number for g in gates)
    if gate_numbers != [1, 2, 3, 4]:
        raise ValueError(f"combine_gate_results requires exactly gates [1,2,3,4], got {gate_numbers}")

    insufficient = [g for g in gates if g.status == GateStatus.INSUFFICIENT_DATA]
    failed = [g for g in gates if g.status == GateStatus.FAIL]

    if insufficient:
        decision = MigrationDecision.INSUFFICIENT_DATA
        names = ", ".join(f"Gate {g.gate_number} ({g.gate_name})" for g in insufficient)
        rationale = (
            f"Cannot reach a conclusion: {names} could not be evaluated with "
            "available data. INSUFFICIENT_DATA takes priority over any FAIL among "
            "the other gates -- concluding REJECT here would be exactly as "
            "premature as concluding MIGRATE."
        )
    elif not failed:
        decision = MigrationDecision.MIGRATE
        rationale = "All four gates PASS."
    else:
        decision = MigrationDecision.REJECT
        names = ", ".join(f"Gate {g.gate_number} ({g.gate_name})" for g in failed)
        rationale = f"{names} evaluable and did not meet its criterion."

    return MigrationDecisionResult(decision=decision, gates=sorted(gates, key=lambda g: g.gate_number), rationale=rationale)
