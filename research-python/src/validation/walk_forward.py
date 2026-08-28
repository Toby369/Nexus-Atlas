"""Purged & embargoed walk-forward cross-validation for the BTC/USDT factor pipeline.

Two split generators are provided:

- ``PurgedWalkForwardCV``: sequential (expanding or rolling) walk-forward
  splits, purged and embargoed. Train always precedes test in time.
- ``generate_combinatorial_splits``: Combinatorial Purged Cross-Validation
  (CPCV) split generator, per Lopez de Prado's "Advances in Financial
  Machine Learning" (ch. 12) -- the split-generation primitive a
  Probability-of-Backtest-Overfitting (PBO) analysis is built on. This
  function only generates (train, test) index pairs; aggregating
  out-of-sample performance across paths into an actual PBO statistic is a
  further step, NOT implemented here (out of scope for this module).

Design intent: mirrors the purge/embargo *concept* already implemented and
validated on the Supabase/SQL side of this project (see
docs/research/PHASE-1-VALIDATION-INTEGRITY.md and
docs/research/PHASE-3.2-PROTOCOL-CORRECTION.md) -- purging removes training
observations whose label window could overlap into the test period; embargo
additionally excludes a buffer of observations right after a test period
(their *features* may have been computed by processes that look back across
the test/train boundary). It is not a new, independently-invented
definition of purging/embargo.

This module is entirely self-contained: no Supabase/production imports, no
network access, no `app`/`lib` imports from the Next.js side of the repo.
"""

from __future__ import annotations

from itertools import combinations
from typing import Iterator, Sequence, Sized

import numpy as np

__all__ = ["PurgedWalkForwardCV", "generate_combinatorial_splits"]


def _resolve_size(value: int | float | None, n_samples: int, name: str) -> int | None:
    """Resolve a train_size/test_size argument to an absolute bar count.

    Accepts either an absolute integer bar count, or a float in (0, 1]
    interpreted as a fraction of `n_samples`. `None` is passed through
    unchanged (caller decides what "not specified" means for that
    parameter). Anything else raises -- no silent coercion.
    """
    if value is None:
        return None
    if isinstance(value, bool):  # bool is a subclass of int -- reject explicitly
        raise ValueError(f"{name} must be an int or float, not bool")
    if isinstance(value, float) and 0 < value <= 1:
        resolved = max(1, int(round(value * n_samples)))
        return resolved
    if isinstance(value, int) and value > 0:
        return value
    raise ValueError(
        f"{name} must be a positive int (absolute bars) or a float in (0, 1] "
        f"(fraction of n_samples={n_samples}); got {value!r}"
    )


class PurgedWalkForwardCV:
    """Sequential purged & embargoed walk-forward cross-validator.

    Lays out ``n_splits`` non-overlapping test blocks in chronological order.
    For each fold, ``train`` is strictly *before* that fold's test block in
    time (this is what makes it "walk-forward" rather than k-fold: a model is
    never evaluated against data that could have informed training that
    hasn't happened "yet" in a live-deployment sense).

    Purge: the ``purge_window`` bars immediately before a fold's own test
    block are removed from that fold's train set (their label/feature
    window could overlap forward into the test period).

    Embargo: the ``embargo_window`` bars immediately after a fold's test
    block are removed specifically from the *next* fold's train set (their
    features could have been computed looking back across the test/train
    boundary) -- this mirrors the task spec's own wording ("... die NACH dem
    Test-Set fuer das NAECHSTE Train-Set gesperrt werden", i.e. blocked for
    *the next* train set specifically). Concretely this is implemented as:
    for fold i > 0, the entire test block *and* embargo tail of fold i-1 are
    excluded from fold i's train set -- a deliberately conservative choice
    (excluding the whole adjacent test block too, not just its embargo
    tail) that keeps the guarantee simple to state and to verify, rather
    than relying on purge/embargo window sizes happening to line up exactly
    at the boundary.

    Parameters
    ----------
    n_splits : int
        Number of walk-forward folds. Default 5.
    train_size : int | float | None
        Absolute bar count, or fraction of the data (0, 1]. Required when
        ``expanding=False`` (rolling window), where it is the fixed window
        size used for every fold. Optional when ``expanding=True``: if
        given, it sets a *minimum floor* for the first fold's train window
        (train still grows past it in later folds) -- useful when a
        meaningfully-sized first fold is needed (e.g. to fit a model on
        it); if ``None`` (default), the first fold starts as small as
        ``purge_window`` allows.
    test_size : int | float
        Absolute bar count, or fraction of the data (0, 1]. Required --
        deliberately no implicit default, to avoid a silently-chosen test
        window size.
    purge_window : int
        Bars removed from a fold's own train set immediately before that
        fold's test block. Default 0.
    embargo_window : int
        Bars removed from the *next* fold's train set immediately after a
        test block. Default 0.
    expanding : bool
        True (default): train grows across folds (starts at index 0 every
        time). False: train is a fixed-size rolling window of ``train_size``
        bars immediately preceding the purge boundary.
    """

    def __init__(
        self,
        n_splits: int = 5,
        train_size: int | float | None = None,
        test_size: int | float | None = None,
        purge_window: int = 0,
        embargo_window: int = 0,
        expanding: bool = True,
    ) -> None:
        if n_splits < 1:
            raise ValueError(f"n_splits must be >= 1, got {n_splits}")
        if purge_window < 0:
            raise ValueError(f"purge_window must be >= 0, got {purge_window}")
        if embargo_window < 0:
            raise ValueError(f"embargo_window must be >= 0, got {embargo_window}")
        if test_size is None:
            raise ValueError(
                "test_size must be specified explicitly (absolute bars or a "
                "fraction in (0, 1]) -- there is no implicit default."
            )
        if not expanding and train_size is None:
            raise ValueError(
                "train_size must be specified explicitly when expanding=False "
                "(rolling-window mode)."
            )

        self.n_splits = n_splits
        self.train_size_raw = train_size
        self.test_size_raw = test_size
        self.purge_window = purge_window
        self.embargo_window = embargo_window
        self.expanding = expanding

    def get_n_splits(self) -> int:
        return self.n_splits

    def split(self, X: Sized) -> Iterator[tuple[np.ndarray, np.ndarray]]:
        """Yield (train_indices, test_indices) as positional integer arrays.

        ``X`` only needs to support ``len()`` (a DataFrame, Series, ndarray,
        or plain list all work) -- indices are positional, 0-based, in
        chronological order (the caller is responsible for ensuring ``X`` is
        chronologically sorted; this splitter does not re-sort anything).
        """
        n_samples = len(X)
        test_size = _resolve_size(self.test_size_raw, n_samples, "test_size")
        train_size = _resolve_size(self.train_size_raw, n_samples, "train_size")

        if self.expanding:
            # train_size is optional in expanding mode: if given, it sets a
            # minimum floor for the *first* fold's train window (train still
            # grows past it in later folds); if omitted (None), the first
            # fold starts as small as purge_window allows, as before.
            initial_offset = self.purge_window + (train_size if train_size is not None else 1)
        else:
            initial_offset = self.purge_window + train_size

        required = initial_offset + self.n_splits * test_size + (self.n_splits - 1) * self.embargo_window
        if required > n_samples:
            raise ValueError(
                f"n_splits={self.n_splits} does not fit in n_samples={n_samples} "
                f"with test_size={test_size}, purge_window={self.purge_window}, "
                f"embargo_window={self.embargo_window}"
                + (f", train_size={train_size}" if not self.expanding else "")
                + f" -- would require at least {required} samples."
            )

        prev_test_start: int | None = None
        prev_test_end: int | None = None
        test_start = initial_offset

        for i in range(self.n_splits):
            test_end = test_start + test_size
            test_indices = np.arange(test_start, test_end)

            candidate_train_end = test_start - self.purge_window
            candidate_train_start = 0 if self.expanding else candidate_train_end - train_size
            candidate_train_start = max(0, candidate_train_start)
            candidate_train_end = max(candidate_train_start, candidate_train_end)

            train_indices = np.arange(candidate_train_start, candidate_train_end)

            if prev_test_start is not None:
                exclude_start = prev_test_start
                exclude_end = prev_test_end + self.embargo_window
                train_indices = train_indices[
                    (train_indices < exclude_start) | (train_indices >= exclude_end)
                ]

            if len(train_indices) == 0:
                raise ValueError(
                    f"Fold {i}: computed train set is empty with these parameters "
                    "(purge_window/embargo_window likely too large relative to "
                    "the available data for this fold)."
                )

            yield train_indices, test_indices

            prev_test_start, prev_test_end = test_start, test_end
            test_start = test_end + self.embargo_window


def generate_combinatorial_splits(
    n_samples: int,
    n_groups: int,
    n_test_groups: int,
    purge_window: int = 0,
    embargo_window: int = 0,
) -> Iterator[tuple[np.ndarray, np.ndarray, tuple[int, ...]]]:
    """Combinatorial Purged Cross-Validation (CPCV) split generator.

    Divides ``n_samples`` positional indices into ``n_groups`` contiguous,
    (approximately) equal-sized chronological groups. Yields one
    ``(train_indices, test_indices, test_group_ids)`` triple for *every*
    C(n_groups, n_test_groups) combination of groups chosen as the test set.

    Unlike sequential walk-forward, a given train group can sit chronologically
    either *before or after* a test group (since test groups are chosen
    combinatorially, not just "the next block in time") -- so purge/embargo
    must be applied symmetrically at *every* boundary between a kept
    (train) group and an excluded (test) group, in both directions:

    - If train group g is immediately followed by a test group (g+1 is a
      test group): trim ``purge_window`` bars off the *end* of group g.
    - If train group g is immediately preceded by a test group (g-1 is a
      test group): trim ``embargo_window`` bars off the *start* of group g.

    This is the split-generation primitive a Probability-of-Backtest-
    Overfitting (PBO) analysis needs (Lopez de Prado, "Advances in Financial
    Machine Learning", ch. 12). Computing the actual PBO statistic requires
    aggregating out-of-sample performance across the generated combinations
    into reconstructed "paths" -- that aggregation is NOT implemented here;
    this function only produces correctly purged/embargoed splits.

    Parameters
    ----------
    n_samples : int
        Total number of chronologically-ordered positional indices.
    n_groups : int
        Number of contiguous groups to divide the timeline into (>= 2).
    n_test_groups : int
        Number of groups selected as "test" per combination (1 <= n_test_groups < n_groups).
    purge_window, embargo_window : int
        Bars trimmed from a train group's boundary adjacent to a test group,
        applied per the direction rules above.

    Yields
    ------
    (train_indices, test_indices, test_group_ids) for every combination,
    where test_group_ids is the tuple of group indices (0-based, chronological
    order) chosen as test for that combination.
    """
    if n_samples < 1:
        raise ValueError(f"n_samples must be >= 1, got {n_samples}")
    if n_groups < 2:
        raise ValueError(f"n_groups must be >= 2, got {n_groups}")
    if not (0 < n_test_groups < n_groups):
        raise ValueError(
            f"n_test_groups must satisfy 0 < n_test_groups < n_groups (n_groups={n_groups}), "
            f"got {n_test_groups}"
        )
    if purge_window < 0 or embargo_window < 0:
        raise ValueError("purge_window and embargo_window must be >= 0")

    group_bounds = np.linspace(0, n_samples, n_groups + 1, dtype=int)
    group_ranges = [(int(group_bounds[i]), int(group_bounds[i + 1])) for i in range(n_groups)]

    min_group_size = min(end - start for start, end in group_ranges)
    if min_group_size <= purge_window + embargo_window:
        raise ValueError(
            f"Smallest group has {min_group_size} bars, which does not leave room "
            f"for purge_window={purge_window} + embargo_window={embargo_window} at "
            "both of its boundaries -- reduce n_groups, purge_window, or embargo_window."
        )

    for test_group_ids in combinations(range(n_groups), n_test_groups):
        test_group_set = set(test_group_ids)
        test_indices = np.concatenate(
            [np.arange(*group_ranges[g]) for g in sorted(test_group_set)]
        )

        train_parts = []
        for g in range(n_groups):
            if g in test_group_set:
                continue
            start, end = group_ranges[g]
            if (g + 1) in test_group_set:
                end = max(start, end - purge_window)
            if (g - 1) in test_group_set:
                start = min(end, start + embargo_window)
            if end > start:
                train_parts.append(np.arange(start, end))

        train_indices = (
            np.concatenate(train_parts) if train_parts else np.array([], dtype=int)
        )
        if len(train_indices) == 0:
            raise ValueError(
                f"Test-group combination {test_group_ids} leaves an empty train set "
                "-- reduce n_test_groups, purge_window, or embargo_window."
            )

        yield train_indices, test_indices, test_group_ids
