"""Tests for src/validation/block_bootstrap.py.

Includes TestCorrectsInferenceNotInformation, which empirically
demonstrates the module's central methodological claim (documented in its
docstring): Block Bootstrap corrects inference for dependence, it does not
create additional information -- on genuinely autocorrelated synthetic
data, the block-bootstrap CI must not be narrower than the (invalid) naive
iid Wald CI computed on the same raw sample size.
"""

from __future__ import annotations

import numpy as np
import pytest

from src.validation.block_bootstrap import (
    DEFAULT_BLOCK_LENGTH,
    BlockBootstrapResult,
    block_bootstrap_hit_rate_difference,
    block_bootstrap_mean_difference,
    block_bootstrap_sharpe_ratio,
    compare_iid_vs_block_bootstrap_ci_width,
    draw_moving_block_indices,
    moving_block_bootstrap,
)


# ---------------------------------------------------------------------------
# draw_moving_block_indices
# ---------------------------------------------------------------------------


class TestDrawMovingBlockIndices:
    def test_output_length_always_equals_n(self):
        # n must be >= block_length by construction (see
        # test_block_length_exceeding_n_raises for the n < block_length case).
        rng = np.random.default_rng(0)
        for n in [14, 15, 28, 29, 100, 201]:
            idx = draw_moving_block_indices(n, block_length=14, rng=rng)
            assert len(idx) == n

    def test_indices_within_bounds(self):
        rng = np.random.default_rng(1)
        idx = draw_moving_block_indices(100, block_length=14, rng=rng)
        assert idx.min() >= 0
        assert idx.max() < 100

    def test_blocks_are_contiguous_when_evenly_divisible(self):
        # n=28, block_length=14 -> exactly 2 full blocks, no truncation,
        # so contiguity can be checked cleanly across the whole output.
        rng = np.random.default_rng(2)
        idx = draw_moving_block_indices(28, block_length=14, rng=rng)
        block1, block2 = idx[:14], idx[14:]
        assert np.all(np.diff(block1) == 1)
        assert np.all(np.diff(block2) == 1)

    def test_deterministic_given_same_rng_state(self):
        idx1 = draw_moving_block_indices(50, block_length=14, rng=np.random.default_rng(42))
        idx2 = draw_moving_block_indices(50, block_length=14, rng=np.random.default_rng(42))
        np.testing.assert_array_equal(idx1, idx2)

    def test_block_length_exceeding_n_raises(self):
        with pytest.raises(ValueError, match="cannot exceed"):
            draw_moving_block_indices(10, block_length=20, rng=np.random.default_rng(0))

    def test_non_positive_block_length_raises(self):
        with pytest.raises(ValueError, match="positive"):
            draw_moving_block_indices(10, block_length=0, rng=np.random.default_rng(0))


# ---------------------------------------------------------------------------
# moving_block_bootstrap (generic engine)
# ---------------------------------------------------------------------------


class TestMovingBlockBootstrapValidation:
    def test_seed_required_rejects_none(self):
        with pytest.raises(ValueError, match="seed"):
            moving_block_bootstrap(
                n_obs=50, statistic_fn=lambda idx: 0.5, baseline=0.5, seed=None
            )

    def test_seed_rejects_wrong_type(self):
        with pytest.raises(ValueError, match="seed"):
            moving_block_bootstrap(
                n_obs=50, statistic_fn=lambda idx: 0.5, baseline=0.5, seed="not-a-seed"
            )

    def test_seed_accepts_int(self):
        result = moving_block_bootstrap(
            n_obs=50, statistic_fn=lambda idx: float(len(idx)), baseline=50.0, seed=0, n_replicates=10
        )
        assert isinstance(result, BlockBootstrapResult)

    def test_seed_accepts_generator(self):
        result = moving_block_bootstrap(
            n_obs=50,
            statistic_fn=lambda idx: float(len(idx)),
            baseline=50.0,
            seed=np.random.default_rng(1),
            n_replicates=10,
        )
        assert isinstance(result, BlockBootstrapResult)

    def test_non_positive_n_obs_raises(self):
        with pytest.raises(ValueError, match="n_obs"):
            moving_block_bootstrap(n_obs=0, statistic_fn=lambda idx: 0.0, baseline=0.0, seed=0)

    def test_non_positive_n_replicates_raises(self):
        with pytest.raises(ValueError, match="n_replicates"):
            moving_block_bootstrap(
                n_obs=50, statistic_fn=lambda idx: 0.0, baseline=0.0, seed=0, n_replicates=0
            )

    def test_ci_level_out_of_range_raises(self):
        with pytest.raises(ValueError, match="ci_level"):
            moving_block_bootstrap(
                n_obs=50, statistic_fn=lambda idx: 0.0, baseline=0.0, seed=0, ci_level=1.5
            )

    def test_nan_observed_statistic_raises(self):
        with pytest.raises(ValueError, match="observed"):
            moving_block_bootstrap(
                n_obs=50, statistic_fn=lambda idx: float("nan"), baseline=0.0, seed=0
            )

    def test_all_nan_replicates_raises(self):
        # observed statistic (identity indices) is fine, but every resampled
        # replicate is NaN -- must fail loudly, not silently report garbage.
        def statistic_fn(idx):
            is_identity = np.array_equal(idx, np.arange(len(idx)))
            return 1.0 if is_identity else float("nan")

        with pytest.raises(ValueError, match="Every bootstrap replicate"):
            moving_block_bootstrap(
                n_obs=50, statistic_fn=statistic_fn, baseline=1.0, seed=0, n_replicates=20
            )


class TestMovingBlockBootstrapDeterminism:
    def test_same_seed_same_result(self):
        rng_data = np.random.default_rng(5)
        values = rng_data.normal(size=100)

        def stat(idx):
            return float(values[idx].mean())

        r1 = moving_block_bootstrap(100, stat, baseline=0.0, seed=7, n_replicates=200)
        r2 = moving_block_bootstrap(100, stat, baseline=0.0, seed=7, n_replicates=200)
        np.testing.assert_array_equal(r1.bootstrap_distribution, r2.bootstrap_distribution)
        assert r1.p_value == r2.p_value
        assert r1.ci_lower == r2.ci_lower and r1.ci_upper == r2.ci_upper

    def test_different_seed_different_result(self):
        rng_data = np.random.default_rng(6)
        values = rng_data.normal(size=100)

        def stat(idx):
            return float(values[idx].mean())

        r1 = moving_block_bootstrap(100, stat, baseline=0.0, seed=1, n_replicates=200)
        r2 = moving_block_bootstrap(100, stat, baseline=0.0, seed=2, n_replicates=200)
        assert not np.array_equal(r1.bootstrap_distribution, r2.bootstrap_distribution)


class TestMovingBlockBootstrapNanHandling:
    def test_partial_nan_replicates_excluded_and_counted(self):
        rng_data = np.random.default_rng(8)
        values = rng_data.normal(size=100)

        def stat(idx):
            # NaN whenever index 0 happens not to be included in this replicate.
            if 0 not in idx:
                return float("nan")
            return float(values[idx].mean())

        result = moving_block_bootstrap(100, stat, baseline=0.0, seed=3, n_replicates=500)
        assert result.n_valid_replicates <= result.n_replicates
        assert result.n_valid_replicates == len(result.bootstrap_distribution)
        assert result.n_valid_replicates > 0


class TestMovingBlockBootstrapStatisticalSanity:
    def test_ci_brackets_true_mean_on_iid_data(self):
        rng_data = np.random.default_rng(9)
        true_mean = 2.0
        values = rng_data.normal(loc=true_mean, scale=1.0, size=500)

        def stat(idx):
            return float(values[idx].mean())

        result = moving_block_bootstrap(
            500, stat, baseline=true_mean, seed=10, block_length=14, n_replicates=3000
        )
        assert result.ci_lower < true_mean < result.ci_upper

    def test_p_value_large_when_baseline_matches_observed(self):
        rng_data = np.random.default_rng(11)
        values = rng_data.normal(loc=0.0, scale=1.0, size=500)

        def stat(idx):
            return float(values[idx].mean())

        observed = float(values.mean())
        result = moving_block_bootstrap(
            500, stat, baseline=observed, seed=12, block_length=14, n_replicates=2000
        )
        # baseline == observed -> deviation_from_baseline == 0 -> every
        # replicate deviation is >= 0 -> p-value must be exactly 1.0
        assert result.p_value == 1.0

    def test_p_value_small_for_far_off_baseline(self):
        rng_data = np.random.default_rng(13)
        values = rng_data.normal(loc=0.0, scale=1.0, size=500)

        def stat(idx):
            return float(values[idx].mean())

        result = moving_block_bootstrap(
            500, stat, baseline=50.0, seed=14, block_length=14, n_replicates=2000
        )
        assert result.p_value < 0.01

    def test_ci_width_property(self):
        rng_data = np.random.default_rng(15)
        values = rng_data.normal(size=200)

        def stat(idx):
            return float(values[idx].mean())

        result = moving_block_bootstrap(200, stat, baseline=0.0, seed=16, n_replicates=500)
        assert result.ci_width == pytest.approx(result.ci_upper - result.ci_lower)
        assert result.ci_width > 0


# ---------------------------------------------------------------------------
# Convenience wrappers
# ---------------------------------------------------------------------------


class TestBlockBootstrapHitRateDifference:
    def test_shape_mismatch_raises(self):
        with pytest.raises(ValueError, match="shape"):
            block_bootstrap_hit_rate_difference(
                outcome=np.array([True, False, True]),
                condition_mask=np.array([True, True]),
                baseline=0.5,
                seed=0,
            )

    def test_matches_manual_hit_rate_on_full_mask(self):
        rng = np.random.default_rng(20)
        n = 300
        outcome = rng.uniform(size=n) < 0.6  # true hit rate 0.6
        condition_mask = np.ones(n, dtype=bool)

        result = block_bootstrap_hit_rate_difference(
            outcome, condition_mask, baseline=0.5, seed=21, block_length=14, n_replicates=100
        )
        assert result.observed_statistic == pytest.approx(outcome.mean())

    def test_condition_mask_restricts_computation(self):
        n = 200
        outcome = np.array([True] * 100 + [False] * 100)
        condition_mask = np.array([True] * 50 + [False] * 150)  # only first 50 (all True outcomes)

        result = block_bootstrap_hit_rate_difference(
            outcome, condition_mask, baseline=0.5, seed=22, block_length=10, n_replicates=50
        )
        assert result.observed_statistic == 1.0  # only True outcomes in the masked region

    def test_default_block_length_matches_phase_3_2(self):
        rng = np.random.default_rng(23)
        n = 300
        outcome = rng.uniform(size=n) < 0.5
        condition_mask = np.ones(n, dtype=bool)
        result = block_bootstrap_hit_rate_difference(outcome, condition_mask, baseline=0.5, seed=24, n_replicates=50)
        assert result.block_length == DEFAULT_BLOCK_LENGTH == 14

    def test_some_replicates_have_no_masked_observations(self):
        # A single True near one end, with a large n and small block_length
        # relative to n: many block resamples will simply never include it,
        # exercising the inner "not masked.any()" NaN branch.
        n = 300
        outcome = np.zeros(n, dtype=bool)
        condition_mask = np.zeros(n, dtype=bool)
        condition_mask[0] = True
        outcome[0] = True

        result = block_bootstrap_hit_rate_difference(
            outcome, condition_mask, baseline=0.5, seed=31, block_length=14, n_replicates=500
        )
        assert result.n_valid_replicates < result.n_replicates
        assert result.observed_statistic == 1.0  # identity indices always include index 0


class TestBlockBootstrapMeanDifference:
    def test_shape_mismatch_raises(self):
        with pytest.raises(ValueError, match="shape"):
            block_bootstrap_mean_difference(
                returns=np.array([0.1, 0.2, 0.3]),
                condition_mask=np.array([True, True]),
                baseline=0.0,
                seed=0,
            )

    def test_nan_returns_raises(self):
        with pytest.raises(ValueError, match="NaN"):
            block_bootstrap_mean_difference(
                returns=np.array([0.1, np.nan, 0.3]),
                condition_mask=np.array([True, True, True]),
                baseline=0.0,
                seed=0,
            )

    def test_matches_manual_mean_on_full_mask(self):
        rng = np.random.default_rng(25)
        n = 200
        returns = rng.normal(loc=0.001, scale=0.02, size=n)
        mask = np.ones(n, dtype=bool)
        result = block_bootstrap_mean_difference(returns, mask, baseline=0.0, seed=26, n_replicates=50)
        assert result.observed_statistic == pytest.approx(returns.mean())

    def test_some_replicates_have_no_masked_observations(self):
        n = 300
        returns = np.zeros(n)
        mask = np.zeros(n, dtype=bool)
        returns[0] = 0.05
        mask[0] = True

        result = block_bootstrap_mean_difference(
            returns, mask, baseline=0.0, seed=32, block_length=14, n_replicates=500
        )
        assert result.n_valid_replicates < result.n_replicates
        assert result.observed_statistic == pytest.approx(0.05)


class TestBlockBootstrapSharpeRatio:
    def test_shape_mismatch_raises(self):
        with pytest.raises(ValueError, match="shape"):
            block_bootstrap_sharpe_ratio(
                returns=np.array([0.1, 0.2, 0.3]),
                condition_mask=np.array([True, True]),
                baseline=0.0,
                seed=0,
            )

    def test_nan_returns_raises(self):
        with pytest.raises(ValueError, match="NaN"):
            block_bootstrap_sharpe_ratio(
                returns=np.array([0.1, np.nan, 0.3]),
                condition_mask=np.array([True, True, True]),
                baseline=0.0,
                seed=0,
            )

    def test_too_few_masked_obs_yields_nan_replicates_but_valid_observed(self):
        n = 200
        returns = np.concatenate([np.array([0.01, 0.02]), np.zeros(n - 2)])
        mask = np.array([True, True] + [False] * (n - 2))
        # Observed (identity indices) has exactly 2 masked obs -- enough for std.
        result = block_bootstrap_sharpe_ratio(
            returns, mask, baseline=0.0, seed=27, block_length=14, n_replicates=200, min_obs_for_std=2
        )
        assert not np.isnan(result.observed_statistic)

    def test_zero_std_yields_nan_for_that_replicate(self):
        n = 100
        returns = np.full(n, 0.01)  # constant -> std=0 everywhere
        mask = np.ones(n, dtype=bool)
        with pytest.raises(ValueError, match="observed"):
            # observed_statistic itself will be NaN (std=0), correctly raising
            block_bootstrap_sharpe_ratio(returns, mask, baseline=0.0, seed=28, n_replicates=50)

    def test_unannualized_matches_manual_computation(self):
        rng = np.random.default_rng(29)
        n = 300
        returns = rng.normal(loc=0.002, scale=0.03, size=n)
        mask = np.ones(n, dtype=bool)
        result = block_bootstrap_sharpe_ratio(returns, mask, baseline=0.0, seed=30, n_replicates=50)
        expected = returns.mean() / returns.std(ddof=1)
        assert result.observed_statistic == pytest.approx(expected)


# ---------------------------------------------------------------------------
# The central methodological claim, empirically demonstrated
# ---------------------------------------------------------------------------


class TestCorrectsInferenceNotInformation:
    """Block Bootstrap corrects the inference for dependence; it does not
    create additional information. On genuinely autocorrelated data, the
    block-bootstrap CI must not be narrower than the (invalid) naive iid
    Wald CI computed on the same raw n -- if it were narrower, that would
    indicate a bug (fabricated precision), not a methodological virtue."""

    @staticmethod
    def _make_persistent_binary_series(n: int, p_stay: float, hit_rate: float, seed: int) -> np.ndarray:
        """Markov-chain-generated binary series with strong persistence
        (long same-value runs) -- a deliberately, strongly autocorrelated
        process, unlike iid coin flips."""
        rng = np.random.default_rng(seed)
        series = np.empty(n, dtype=bool)
        series[0] = rng.uniform() < hit_rate
        for t in range(1, n):
            if rng.uniform() < p_stay:
                series[t] = series[t - 1]
            else:
                series[t] = rng.uniform() < hit_rate
        return series

    def test_block_bootstrap_ci_not_narrower_than_naive_on_autocorrelated_data(self):
        n = 400
        outcome = self._make_persistent_binary_series(n, p_stay=0.85, hit_rate=0.55, seed=100)
        mask = np.ones(n, dtype=bool)

        result = block_bootstrap_hit_rate_difference(
            outcome, mask, baseline=0.5, seed=101, block_length=14, n_replicates=3000
        )
        comparison = compare_iid_vs_block_bootstrap_ci_width(
            n_condition_matching=n, p_hat=result.observed_statistic, block_bootstrap_ci_width=result.ci_width
        )
        assert comparison["block_bootstrap_at_least_as_wide"], (
            f"block-bootstrap CI width ({comparison['block_bootstrap_ci_width']:.4f}) was narrower "
            f"than the naive iid CI width ({comparison['naive_iid_ci_width']:.4f}) on strongly "
            "autocorrelated data -- this would mean the method fabricates precision, contradicting "
            "its documented purpose."
        )
        # Not just "at least as wide" -- on data this persistent, expect a
        # clearly, substantially wider interval, not a marginal difference.
        assert comparison["block_bootstrap_ci_width"] > 1.3 * comparison["naive_iid_ci_width"]

    def test_block_bootstrap_ci_reasonably_close_to_naive_on_truly_iid_data(self):
        """Sanity check in the other direction: with no real dependence,
        the method should not wildly over-inflate uncertainty either."""
        rng = np.random.default_rng(102)
        n = 400
        outcome = rng.uniform(size=n) < 0.55
        mask = np.ones(n, dtype=bool)

        result = block_bootstrap_hit_rate_difference(
            outcome, mask, baseline=0.5, seed=103, block_length=14, n_replicates=3000
        )
        comparison = compare_iid_vs_block_bootstrap_ci_width(
            n_condition_matching=n, p_hat=result.observed_statistic, block_bootstrap_ci_width=result.ci_width
        )
        ratio = comparison["block_bootstrap_ci_width"] / comparison["naive_iid_ci_width"]
        assert 0.6 < ratio < 1.8, f"unexpectedly extreme width ratio on iid data: {ratio:.2f}"


class TestCompareIidVsBlockBootstrapCiWidth:
    def test_wider_is_flagged_true(self):
        result = compare_iid_vs_block_bootstrap_ci_width(
            n_condition_matching=100, p_hat=0.5, block_bootstrap_ci_width=0.5
        )
        assert result["block_bootstrap_at_least_as_wide"] is True

    def test_narrower_is_flagged_false(self):
        result = compare_iid_vs_block_bootstrap_ci_width(
            n_condition_matching=100, p_hat=0.5, block_bootstrap_ci_width=0.001
        )
        assert result["block_bootstrap_at_least_as_wide"] is False
