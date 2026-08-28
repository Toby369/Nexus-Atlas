"""Moving Block Bootstrap (MBB) for dependence-aware inference on daily
BTC/USDT time series.

Implements exactly the methodology fixed in
docs/research/PHASE-3.2-PROTOCOL-CORRECTION.md (Section 6a) for the
Nexus-Atlas confirmatory-test design:

  - Moving Block Bootstrap, chosen over Circular Block Bootstrap and
    Stationary Bootstrap, because the dependence length here (H=7 days,
    derived structurally from the 168h/7d forward-return construction) is
    a KNOWN, fixed constant, not something that needs to be estimated or
    treated as random -- which is what Stationary Bootstrap exists for.
    Circular Bootstrap remains a documented, not-chosen alternative for
    reducing edge effects, consistent with Phase 3.2's own text.
  - Fixed block length L=14 days (=2xH), a conservative margin above the
    theoretical dependence length, not an arbitrary placeholder.
  - Blocks are drawn from the FULL, contiguous calendar-time index range
    -- never from a pre-filtered/condition-matching subsequence. This
    matters: a condition-filtered series (e.g. "only BEARISH-classified
    days") loses the true calendar-time distance between kept
    observations, which is exactly what the dependence structure depends
    on (see src/selection/evaluate.py's module docstring for the same
    point in a different context). `moving_block_bootstrap` therefore
    resamples over `n_obs` (the full series length) and hands each
    replicate's resampled index array to `statistic_fn`, which is
    responsible for applying any condition/mask AFTER the block structure
    has been preserved -- not before.

CENTRAL, LOAD-BEARING STATEMENT (documented, not just implied, and
empirically demonstrated in tests/test_block_bootstrap.py::
TestCorrectsInferenceNotInformation): Block Bootstrap corrects the
INFERENCE for dependence; it does NOT create additional information. The
confidence intervals this module produces on genuinely autocorrelated data
are expected to be at least as wide as -- typically wider than -- the
(invalid) interval a naive iid-assuming calculation would report on the
same raw sample size. A narrower block-bootstrap interval than the naive
one would indicate a bug, not a methodological improvement.

Random seeds are REQUIRED (no implicit default) on every public function
here, for fully reproducible sampling across runs -- consistent with this
project's "no silent choices" convention.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

import numpy as np

__all__ = [
    "BlockBootstrapResult",
    "draw_moving_block_indices",
    "moving_block_bootstrap",
    "block_bootstrap_hit_rate_difference",
    "block_bootstrap_mean_difference",
    "block_bootstrap_sharpe_ratio",
    "compare_iid_vs_block_bootstrap_ci_width",
    "DEFAULT_BLOCK_LENGTH",
]

# L=14 days = 2x the H=7-day theoretical dependence length derived in
# docs/research/PHASE-3.2-PROTOCOL-CORRECTION.md Section 6a. Not an
# arbitrary default -- pass a different value only with an equally
# explicit, documented justification.
DEFAULT_BLOCK_LENGTH = 14


def _resolve_rng(seed: int | np.random.Generator) -> np.random.Generator:
    if isinstance(seed, np.random.Generator):
        return seed
    if isinstance(seed, (int, np.integer)) and not isinstance(seed, bool):
        return np.random.default_rng(seed)
    raise ValueError(
        f"seed must be an int or a numpy.random.Generator for deterministic, "
        f"reproducible sampling -- got {type(seed)!r}. This project requires "
        "explicit seed injection, never an implicit/None default."
    )


def draw_moving_block_indices(n: int, block_length: int, rng: np.random.Generator) -> np.ndarray:
    """One Moving Block Bootstrap resample of positional indices over [0, n).

    Draws ``ceil(n/block_length)`` block start positions uniformly at
    random, WITH replacement, from ``{0, ..., n-block_length}`` (so every
    drawn block is a fully in-bounds, contiguous run of ``block_length``
    consecutive calendar positions), concatenates them in draw order, and
    truncates to exactly ``n`` indices. Standard Moving Block Bootstrap
    construction (Kunsch, 1989).
    """
    if block_length <= 0:
        raise ValueError(f"block_length must be positive, got {block_length}")
    if block_length > n:
        raise ValueError(f"block_length ({block_length}) cannot exceed n ({n})")

    n_blocks_needed = int(np.ceil(n / block_length))
    max_start = n - block_length  # inclusive upper bound for a valid block start
    starts = rng.integers(0, max_start + 1, size=n_blocks_needed)
    indices = np.concatenate([np.arange(s, s + block_length) for s in starts])
    return indices[:n]


@dataclass
class BlockBootstrapResult:
    observed_statistic: float
    baseline: float
    difference: float
    bootstrap_distribution: np.ndarray
    ci_lower: float
    ci_upper: float
    ci_level: float
    p_value: float
    n_replicates: int
    n_valid_replicates: int
    block_length: int
    n_obs: int

    @property
    def ci_width(self) -> float:
        return self.ci_upper - self.ci_lower


def moving_block_bootstrap(
    n_obs: int,
    statistic_fn: Callable[[np.ndarray], float],
    baseline: float,
    seed: int | np.random.Generator,
    block_length: int = DEFAULT_BLOCK_LENGTH,
    n_replicates: int = 5000,
    ci_level: float = 0.95,
) -> BlockBootstrapResult:
    """Generic Moving Block Bootstrap inference engine.

    ``statistic_fn`` receives the resampled index array for one replicate
    (values in ``[0, n_obs)``, length ``n_obs``) and must return the
    statistic of interest computed from whatever aligned data arrays the
    caller closes over, indexed by that array -- e.g. a condition-masked
    hit rate. This keeps the resampling mechanism (which only needs
    ``n_obs``) fully decoupled from the statistic's own condition/masking
    logic; see ``block_bootstrap_hit_rate_difference`` for the concrete
    Phase-3.2 primary-test statistic built on top of this.

    ``statistic_fn`` may return NaN for a replicate whose resampled blocks
    happen to contain zero eligible (condition-matching) observations --
    e.g. a replicate built entirely from blocks with no BEARISH day. Such
    replicates are excluded from the bootstrap distribution and reported
    via ``n_valid_replicates`` (which can be less than ``n_replicates``);
    this is never silently hidden.

    Parameters
    ----------
    n_obs : int
        Total number of chronological observations in the FULL series
        (all states/conditions) that ``statistic_fn`` may index into.
    statistic_fn : Callable[[np.ndarray], float]
    baseline : float
        The FIXED reference value the observed statistic is tested
        against (e.g. an empirically-established Always-X hit rate from
        already-frozen historical data). Never resampled.
    seed : int | np.random.Generator
        Required -- no implicit default.
    block_length : int
        Fixed block length in calendar days. Default ``DEFAULT_BLOCK_LENGTH``
        (14, per Phase 3.2 Section 6a).
    n_replicates : int
        Number of bootstrap resamples. Default 5000.
    ci_level : float
        Confidence level for the percentile-method CI. Default 0.95.

    Returns
    -------
    BlockBootstrapResult
    """
    if n_obs <= 0:
        raise ValueError(f"n_obs must be positive, got {n_obs}")
    if n_replicates <= 0:
        raise ValueError(f"n_replicates must be positive, got {n_replicates}")
    if not (0.0 < ci_level < 1.0):
        raise ValueError(f"ci_level must be in (0, 1), got {ci_level}")

    rng = _resolve_rng(seed)

    observed_statistic = float(statistic_fn(np.arange(n_obs)))
    if np.isnan(observed_statistic):
        raise ValueError(
            "statistic_fn(identity indices) returned NaN -- the observed "
            "(non-resampled) statistic must be computable on the real data; "
            "a bootstrap cannot proceed without it."
        )

    replicates = np.empty(n_replicates, dtype=float)
    for b in range(n_replicates):
        idx = draw_moving_block_indices(n_obs, block_length, rng)
        replicates[b] = statistic_fn(idx)

    valid = replicates[~np.isnan(replicates)]
    n_valid = int(len(valid))
    if n_valid == 0:
        raise ValueError(
            "Every bootstrap replicate returned NaN -- no resample supported "
            "computing the statistic (e.g. the condition of interest never "
            "appeared in any resampled block). Cannot report a result."
        )

    alpha = 1.0 - ci_level
    ci_lower, ci_upper = np.percentile(valid, [100 * alpha / 2, 100 * (1 - alpha / 2)])

    # Pivot/centered bootstrap hypothesis test against the fixed baseline
    # (Efron & Tibshirani-style): under H0 (true statistic == baseline),
    # the observed deviation from baseline should look like a typical draw
    # from the bootstrap's own estimated sampling-error distribution
    # (replicate - observed), not from (replicate - baseline) -- centering
    # on the observed statistic is what makes this a valid test of H0
    # rather than a restatement of the CI.
    deviation_from_baseline = abs(observed_statistic - baseline)
    replicate_deviations = np.abs(valid - observed_statistic)
    p_value = float(np.mean(replicate_deviations >= deviation_from_baseline))

    return BlockBootstrapResult(
        observed_statistic=observed_statistic,
        baseline=float(baseline),
        difference=observed_statistic - float(baseline),
        bootstrap_distribution=valid,
        ci_lower=float(ci_lower),
        ci_upper=float(ci_upper),
        ci_level=ci_level,
        p_value=p_value,
        n_replicates=n_replicates,
        n_valid_replicates=n_valid,
        block_length=block_length,
        n_obs=n_obs,
    )


def block_bootstrap_hit_rate_difference(
    outcome: np.ndarray,
    condition_mask: np.ndarray,
    baseline: float,
    seed: int | np.random.Generator,
    block_length: int = DEFAULT_BLOCK_LENGTH,
    n_replicates: int = 5000,
    ci_level: float = 0.95,
) -> BlockBootstrapResult:
    """Condition-masked hit-rate difference against a fixed baseline,
    dependence-corrected via Moving Block Bootstrap.

    This is the concrete statistic Phase 3.2 Section 6a specifies for the
    primary confirmatory test: e.g. ``condition_mask`` = "Model B
    classified this day BEARISH", ``outcome`` = "price actually fell over
    the next 168h", ``baseline`` = the empirical Always-Bearish hit rate.
    Blocks are drawn from the full calendar series (length =
    ``len(outcome)``); within each resampled pseudo-series, the hit rate
    is computed only over the condition-matching rows -- exactly the
    "block on the full series, evaluate on the filtered subset" design.

    Parameters
    ----------
    outcome : array-like of bool
        Per-day realized outcome ("hit"), full calendar series.
    condition_mask : array-like of bool
        Per-day eligibility for the statistic (e.g. BEARISH-classified),
        same shape as ``outcome``.
    """
    outcome_arr = np.asarray(outcome, dtype=bool)
    mask_arr = np.asarray(condition_mask, dtype=bool)
    if outcome_arr.shape != mask_arr.shape:
        raise ValueError(
            f"outcome (shape {outcome_arr.shape}) and condition_mask "
            f"(shape {mask_arr.shape}) must have the same shape"
        )

    def statistic_fn(idx: np.ndarray) -> float:
        masked = mask_arr[idx]
        if not masked.any():
            return float("nan")
        return float(outcome_arr[idx][masked].mean())

    return moving_block_bootstrap(
        n_obs=len(outcome_arr),
        statistic_fn=statistic_fn,
        baseline=baseline,
        seed=seed,
        block_length=block_length,
        n_replicates=n_replicates,
        ci_level=ci_level,
    )


def block_bootstrap_mean_difference(
    returns: np.ndarray,
    condition_mask: np.ndarray,
    baseline: float,
    seed: int | np.random.Generator,
    block_length: int = DEFAULT_BLOCK_LENGTH,
    n_replicates: int = 5000,
    ci_level: float = 0.95,
) -> BlockBootstrapResult:
    """Condition-masked mean-return difference against a fixed baseline
    (e.g. 0, or an unconditioned mean return), dependence-corrected via
    Moving Block Bootstrap. Same block-on-full-series design as
    ``block_bootstrap_hit_rate_difference``.
    """
    returns_arr = np.asarray(returns, dtype=float)
    mask_arr = np.asarray(condition_mask, dtype=bool)
    if returns_arr.shape != mask_arr.shape:
        raise ValueError(
            f"returns (shape {returns_arr.shape}) and condition_mask "
            f"(shape {mask_arr.shape}) must have the same shape"
        )
    if np.isnan(returns_arr).any():
        raise ValueError(
            "returns contains NaN -- block bootstrap requires a fully "
            "populated calendar series (drop/fill NaNs before calling, "
            "outside this function, so the choice is explicit)."
        )

    def statistic_fn(idx: np.ndarray) -> float:
        masked_returns = returns_arr[idx][mask_arr[idx]]
        if masked_returns.size == 0:
            return float("nan")
        return float(masked_returns.mean())

    return moving_block_bootstrap(
        n_obs=len(returns_arr),
        statistic_fn=statistic_fn,
        baseline=baseline,
        seed=seed,
        block_length=block_length,
        n_replicates=n_replicates,
        ci_level=ci_level,
    )


def block_bootstrap_sharpe_ratio(
    returns: np.ndarray,
    condition_mask: np.ndarray,
    baseline: float,
    seed: int | np.random.Generator,
    block_length: int = DEFAULT_BLOCK_LENGTH,
    n_replicates: int = 5000,
    ci_level: float = 0.95,
    min_obs_for_std: int = 2,
) -> BlockBootstrapResult:
    """Condition-masked Sharpe-like ratio (mean/std of returns) against a
    fixed baseline, dependence-corrected via Moving Block Bootstrap.

    Explicitly UNANNUALIZED -- annualization is a presentation choice
    requiring a periods-per-year assumption this generic function does not
    make (consistent with ``volatility.garman_klass_volatility``'s
    ``annualize`` parameter elsewhere in this project); multiply the
    returned statistic by ``sqrt(periods_per_year)`` externally if needed.

    Returns NaN for a replicate with fewer than ``min_obs_for_std``
    condition-matching observations, or with (numerically) zero std --
    both cases where a Sharpe ratio is not a meaningful number, not
    silently reported as one.
    """
    returns_arr = np.asarray(returns, dtype=float)
    mask_arr = np.asarray(condition_mask, dtype=bool)
    if returns_arr.shape != mask_arr.shape:
        raise ValueError(
            f"returns (shape {returns_arr.shape}) and condition_mask "
            f"(shape {mask_arr.shape}) must have the same shape"
        )
    if np.isnan(returns_arr).any():
        raise ValueError(
            "returns contains NaN -- block bootstrap requires a fully "
            "populated calendar series (drop/fill NaNs before calling)."
        )

    def statistic_fn(idx: np.ndarray) -> float:
        masked_returns = returns_arr[idx][mask_arr[idx]]
        if masked_returns.size < min_obs_for_std:
            return float("nan")
        std = masked_returns.std(ddof=1)
        if np.isclose(std, 0.0):
            return float("nan")
        return float(masked_returns.mean() / std)

    return moving_block_bootstrap(
        n_obs=len(returns_arr),
        statistic_fn=statistic_fn,
        baseline=baseline,
        seed=seed,
        block_length=block_length,
        n_replicates=n_replicates,
        ci_level=ci_level,
    )


def compare_iid_vs_block_bootstrap_ci_width(
    n_condition_matching: int,
    p_hat: float,
    block_bootstrap_ci_width: float,
    z: float = 1.959963985,
) -> dict[str, float | bool]:
    """Diagnostic (not used internally by the functions above): compares
    the naive, INVALID Wald confidence-interval width for a proportion
    (assuming iid observations -- the assumption this whole module exists
    to avoid relying on) against the actual Moving Block Bootstrap CI
    width computed on the same conditioned sample.

    This is a reporting/sanity utility for whoever runs the primary
    confirmatory test -- not a correctness guarantee enforced at runtime.
    See ``tests/test_block_bootstrap.py::TestCorrectsInferenceNotInformation``
    for an empirical demonstration, on synthetic autocorrelated data, that
    the block-bootstrap interval is not narrower than the naive one.

    Parameters
    ----------
    n_condition_matching : int
        Raw count of condition-matching (e.g. BEARISH) observations used
        for ``p_hat``.
    p_hat : float
        The observed proportion (e.g. hit rate) in that sample.
    block_bootstrap_ci_width : float
        ``BlockBootstrapResult.ci_width`` from the corresponding block
        bootstrap run.
    z : float
        Two-sided normal critical value for the naive interval's
        confidence level (default 1.959963985 -> 95%).
    """
    naive_half_width = z * np.sqrt(p_hat * (1 - p_hat) / n_condition_matching)
    naive_width = 2 * naive_half_width
    return {
        "naive_iid_ci_width": float(naive_width),
        "block_bootstrap_ci_width": float(block_bootstrap_ci_width),
        "block_bootstrap_at_least_as_wide": bool(block_bootstrap_ci_width >= naive_width),
    }
